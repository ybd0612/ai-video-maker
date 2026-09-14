// ────────────────────────────────────────────────────────────────────────────
// src/services/scriptService.ts
// Generates structured shots + extracted characters from a user prompt.
// Unified prompt — no mode branching. AI auto-detects characters in content.
// ────────────────────────────────────────────────────────────────────────────

import type { Shot, Asset } from "@/stores/projectStore";
import { createAIService } from "@/services/ai/factory";
import {
  buildSystemPrompt as buildTaskSystemPrompt,
  getActiveRules,
} from "@/lib/promptRules";

interface GenerateScriptOptions {
  apiKey: string;
  baseUrl: string;
  prompt: string;
  language: "zh" | "en";
  aspectRatio: string;
  /** 项目统一资产（角色/场景/产品），用于构建一致性提示词 */
  assets?: Asset[];
}

interface RawShot {
  scriptText: string;
  visualPrompt: string;
  motionPrompt: string;
  duration: number;
  dialogues?: Array<{ characterId: string | null; text: string; delivery?: string }>;
  activeCharacterIds?: string[];
  activeSceneId?: string;
  activeProductIds?: string[];
  activePropIds?: string[];
  subjectDesc?: string;
  sceneDesc?: string;
  detailDesc?: string;
  lightingDesc?: string;
  styleDesc?: string;
  negativePrompt?: string;
  actionDesc?: string;
  cameraDesc?: string;
  envChangeDesc?: string;
  motionSpeedDesc?: string;
  negativeMotionPrompt?: string;
  useDualFrame?: boolean;
}

interface RawCharacter {
  name: string;
  description: string;
  appearancePrompt: string;
}

/** 产品资产（模型输出格式，与角色同构） */
interface RawProduct {
  name: string;
  description: string;
  appearancePrompt: string;
}

/** 道具 / 关键物件资产（模型输出格式，与产品同构） */
interface RawProp {
  name: string;
  description: string;
  appearancePrompt: string;
}

/** 场景资产（模型输出格式，与产品同构；appearancePrompt 为英文场景描述） */
interface RawScene {
  name: string;
  description: string;
  appearancePrompt: string;
}

/** 风格资产（模型输出格式；仅 name+description，中文风格描述为 L1 用户事实源，
 *  英文 stylePrompt 由运行期懒派生，不落库在模型输出里） */
export interface RawStyle {
  name: string;
  description: string;
}

export interface GenerateScriptResult {
  shots: Omit<Shot, "id" | "index" | "status">[];
  characters: RawCharacter[];
  products: RawProduct[];
  props: RawProp[];
  scenes: RawScene[];
  styles: RawStyle[];
}

/* ── Motion translation ─────────────────────────────────────────────────── */

/**
 * 注：曾存在 translateToMotion（用单镜头 scriptText 重新翻译 visualPrompt/motionPrompt 并覆盖）。
 * 该步骤已移除：generateScript 输出的分镜已含 AI 生成的完整英文双提示词，
 * 二次翻译在 JSON 解析失败时用 "Camera slowly pans, gentle movement" 等兜底文案
 * 覆盖完整提示词，导致视频请求体 prompt 内容缺失（实测问题）。
 */

/**
 * Extract JSON object from a model response that may contain markdown fences,
 * preamble text, or trailing commentary.
 */
function extractJsonFromResponse(content: string): string | null {
  const fenced = content.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenced) {
    const inner = fenced[1].trim();
    if (inner.startsWith("{")) return inner;
  }

  const start = content.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  for (let i = start; i < content.length; i++) {
    if (content[i] === "{") depth++;
    if (content[i] === "}") depth--;
    if (depth === 0) {
      return content.slice(start, i + 1);
    }
  }

  const fallback = content.match(/\{[\s\S]*\}/);
  return fallback ? fallback[0] : null;
}

const MAX_SCRIPT_RETRIES = 2;

/* ── Unified system prompt ───────────────────────────────────────────────── */

function buildSystemPrompt(
  language: "zh" | "en",
  assets?: Asset[],
): string {
  // 规则注册表渲染：骨架（JSON 格式）+ BUILTIN_RULES + 用户覆盖条目
  const base = buildTaskSystemPrompt("storyboard", language, getActiveRules());
  // 资产上下文段是动态数据，不入条目，函数内拼装后注入 {{assets}} 槽
  return base.replace("{{assets}}", () => buildAssetsContext(language, assets));
}

/** 资产上下文段（动态数据：已有角色/场景/产品列表，供模型复用 ID 与保持一致性） */
function buildAssetsContext(language: "zh" | "en", assets?: Asset[]): string {
  const characters = (assets ?? []).filter((a) => a.type === "character");
  const scenes = (assets ?? []).filter((a) => a.type === "scene");
  const products = (assets ?? []).filter((a) => a.type === "product");
  const props = (assets ?? []).filter((a) => a.type === "prop");

  if (language === "en") {
    let charSection = "";
    if (characters.length > 0) {
      charSection =
        "\nExisting characters (use corresponding IDs if content involves them):\n" +
        characters
          .map((c) => `- ${c.name} (ID: ${c.id}): ${c.description || "No description"}`)
          .join("\n") +
        "\n";
    }

    let sceneSection = "";
    if (scenes.length > 0) {
      sceneSection =
        "\nAvailable scene references (use these scenes, keep sceneDesc consistent with scene names):\n" +
        scenes
          .map((s) => `- ${s.name}: ${s.description}`)
          .join("\n") +
        "\n";
    }

    let productSection = "";
    if (products.length > 0) {
      productSection =
        "\nExisting product subjects (if content involves these products, keep the subject consistent across shots):\n" +
        products
          .map((p) => `- ${p.name}: ${p.description}`)
          .join("\n") +
        "\n";
    }

    let propSection = "";
    if (props.length > 0) {
      propSection =
        "\nExisting props / key objects (use IDs when they appear in a shot):\n" +
        props
          .map((p) => `- ${p.name} (ID: ${p.id}): ${p.description}`)
          .join("\n") +
        "\n";
    }

    return `${charSection}${sceneSection}${productSection}${propSection}`;
  }

  let charSection = "";
  if (characters.length > 0) {
    charSection =
      "\n已有角色（如内容涉及这些角色，请使用对应 ID）：\n" +
      characters
        .map((c) => `- ${c.name}（ID: ${c.id}）：${c.description || "无描述"}`)
        .join("\n") +
      "\n";
  }

  let sceneSection = "";
  if (scenes.length > 0) {
    sceneSection =
      "\n已有场景参考（请在分镜中使用这些场景，保持 sceneDesc 与场景名称一致）：\n" +
      scenes
        .map((s) => `- ${s.name}：${s.description}`)
        .join("\n") +
      "\n";
  }

  let productSection = "";
  if (products.length > 0) {
    productSection =
      "\n已有产品主体（如内容涉及这些产品，请确保镜头主体保持一致）：\n" +
      products
        .map((p) => `- ${p.name}：${p.description}`)
        .join("\n") +
      "\n";
  }

  let propSection = "";
  if (props.length > 0) {
    propSection =
      "\n已有道具 / 关键物件（出现在镜头中时请使用对应 ID）：\n" +
      props
        .map((p) => `- ${p.name}（ID: ${p.id}）：${p.description}`)
        .join("\n") +
      "\n";
  }

  return `${charSection}${sceneSection}${productSection}${propSection}`;
}

/* ── Main function ───────────────────────────────────────────────────────── */

/**
 * Generate structured shots + extracted characters from a user prompt.
 * Returns both shots and characters — characters may be empty if content has no人物.
 */
export async function generateScript(
  opts: GenerateScriptOptions,
): Promise<GenerateScriptResult> {
  const systemPrompt = buildSystemPrompt(opts.language, opts.assets);

  const service = createAIService({
    provider: "openai",
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl,
  });

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_SCRIPT_RETRIES; attempt++) {
    const result = await service.chatCompletion({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: opts.prompt },
      ],
      temperature: 0.7,
      // 输出预算走 MAX_OUTPUT_TOKENS（65536，效果优先不做 token 精打细算）
      enableThinking: false,
    });
    const content = result.content;

    const jsonStr = extractJsonFromResponse(content);
    if (!jsonStr) {
      // Unified chatCompletion already validates non-empty content. Keep
      // diagnostics focused on malformed JSON and preserve retry behavior.
      const detail = content.trim().length === 0
        ? "模型返回了空内容，可能触发了内容安全过滤或模型拒绝"
        : `模型返回的内容不是有效 JSON。响应内容：${content.slice(0, 200)}`;
      lastError = new Error(
        `无法从模型响应中提取 JSON（第 ${attempt + 1} 次尝试）。${detail}`,
      );
      if (attempt < MAX_SCRIPT_RETRIES) continue;
      throw lastError;
    }

    try {
      const parsed = JSON.parse(jsonStr) as {
        shots: RawShot[];
        characters?: RawCharacter[];
        products?: RawProduct[];
        props?: RawProp[];
        scenes?: RawScene[];
        styles?: RawStyle[];
      };
      if (!Array.isArray(parsed.shots) || parsed.shots.length === 0) {
        throw new Error("Model returned empty or invalid shots array.");
      }

      const shots = parsed.shots.map((s) => ({
        scriptText: s.scriptText ?? "",
        visualPrompt: s.visualPrompt ?? "",
        motionPrompt: s.motionPrompt ?? "",
        dialogues: (s.dialogues ?? []).map((d) => ({
          id: `dlg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          characterId: d.characterId ?? null,
          text: d.text ?? "",
          delivery: d.delivery,
        })),
        activeCharacterIds: s.activeCharacterIds ?? [],
        activeSceneId: s.activeSceneId,
        activeProductIds: s.activeProductIds ?? [],
        activePropIds: s.activePropIds ?? [],
        subjectDesc: s.subjectDesc ?? "",
        sceneDesc: s.sceneDesc ?? "",
        detailDesc: s.detailDesc ?? "",
        lightingDesc: s.lightingDesc ?? "",
        styleDesc: s.styleDesc ?? "",
        negativePrompt: s.negativePrompt ?? "",
        actionDesc: s.actionDesc ?? "",
        cameraDesc: s.cameraDesc ?? "",
        envChangeDesc: s.envChangeDesc ?? "",
        motionSpeedDesc: s.motionSpeedDesc ?? "",
        negativeMotionPrompt: s.negativeMotionPrompt ?? "",
        duration: [4, 5, 8].includes(s.duration) ? s.duration : 5,
        useDualFrame: s.useDualFrame ?? false,
      }));

      // Fallback for empty prompts
      for (const shot of shots) {
        if (!shot.visualPrompt.trim() && shot.scriptText.trim()) {
          shot.visualPrompt = `Cinematic shot: ${shot.scriptText.trim()}, professional lighting, high quality, detailed composition, photorealistic, 8k`;
        }
        if (!shot.motionPrompt.trim() && shot.scriptText.trim()) {
          shot.motionPrompt = `Slow cinematic camera movement, gentle ambient motion, subtle environmental changes, natural physics`;
        }
      }

      const hasEmpty = shots.some((s) => !s.visualPrompt.trim() || !s.motionPrompt.trim());
      if (hasEmpty && attempt < MAX_SCRIPT_RETRIES) {
        lastError = new Error("部分分镜缺少提示词，自动重试...");
        continue;
      }

      // Merge extracted characters with existing ones
      // New characters from AI get prefixed IDs to avoid collision with existing ones
      const extractedCharacters: RawCharacter[] = Array.isArray(parsed.characters)
        ? parsed.characters.map((c) => ({
            name: c.name ?? "",
            description: c.description ?? "",
            appearancePrompt: c.appearancePrompt ?? "",
          }))
        : [];

      // 产品主体提取（与角色同构，供步骤 2 生成产品参考图）
      const extractedProducts: RawProduct[] = Array.isArray(parsed.products)
        ? parsed.products.map((c) => ({
            name: c.name ?? "",
            description: c.description ?? "",
            appearancePrompt: c.appearancePrompt ?? "",
          }))
        : [];

      // 道具提取（供步骤 2 生成道具参考图）
      const extractedProps: RawProp[] = Array.isArray(parsed.props)
        ? parsed.props.map((c) => ({
            name: c.name ?? "",
            description: c.description ?? "",
            appearancePrompt: c.appearancePrompt ?? "",
          }))
        : [];

      // 场景提取（供步骤 2 生成场景参考图）
      const extractedScenes: RawScene[] = Array.isArray(parsed.scenes)
        ? parsed.scenes.map((c) => ({
            name: c.name ?? "",
            description: c.description ?? "",
            appearancePrompt: c.appearancePrompt ?? "",
          }))
        : [];

      // 风格提取（仅中文描述；英文 stylePrompt 运行期懒派生）
      const extractedStyles: RawStyle[] = Array.isArray(parsed.styles)
        ? parsed.styles
            .slice(0, 1) // 最多 1 个整体风格
            .map((s) => ({
              name: s.name ?? "",
              description: s.description ?? "",
            }))
        : [];

      // Update activeCharacterIds in shots to reference existing characters by name match
      // (AI may generate new IDs that don't match existing store IDs)
      const existingCharacters = (opts.assets ?? []).filter((a) => a.type === "character");
      if (existingCharacters.length > 0) {
        const nameToId = new Map(
          existingCharacters.map((c) => [c.name.toLowerCase(), c.id]),
        );
        for (const shot of shots) {
          shot.activeCharacterIds = shot.activeCharacterIds.map((refId) => {
            // If this ID matches an existing character, keep it
            if (existingCharacters.some((c) => c.id === refId)) return refId;
            // Otherwise try to match by name (the AI may have used name as ID)
            return nameToId.get(refId.toLowerCase()) ?? refId;
          });
          // 对白同样按名字匹配回填；匹配不到的置 null（归为旁白），避免残留无效角色 ID
          for (const line of shot.dialogues ?? []) {
            if (line.characterId && !existingCharacters.some((c) => c.id === line.characterId)) {
              line.characterId = nameToId.get(line.characterId.toLowerCase()) ?? null;
            }
          }
        }
      }

      return {
        shots,
        characters: extractedCharacters,
        products: extractedProducts,
        props: extractedProps,
        scenes: extractedScenes,
        styles: extractedStyles,
      };
    } catch (parseErr) {
      lastError = new Error(
        `JSON 解析失败（第 ${attempt + 1} 次尝试）：${parseErr instanceof Error ? parseErr.message : String(parseErr)}。提取内容：${jsonStr.slice(0, 200)}`,
      );
      if (attempt < MAX_SCRIPT_RETRIES) continue;
      throw lastError;
    }
  }

  throw lastError ?? new Error("Script generation failed after retries.");
}

/* ── 轻量资产提取（步骤 1 使用，不生成分镜，节省 token） ──────────────────── */

/** 资产提取上下文段（动态数据：已有角色/场景/产品/道具/风格名单） */
function buildExtractAssetsContext(language: "zh" | "en", assets?: Asset[]): string {
  const allAssets = assets ?? [];
  const names = (type: Asset["type"]) =>
    allAssets.filter((asset) => asset.type === type).map((asset) => `- ${asset.name}`).join("\n");
  const section = (title: string, type: Asset["type"]): string => {
    const content = names(type);
    return content ? `\n${title}:\n${content}\n` : "";
  };

  if (language === "en") {
    return [
      section("Existing characters", "character"),
      section("Existing scenes", "scene"),
      section("Existing products", "product"),
      section("Existing props / key objects", "prop"),
      section("Existing visual styles", "style"),
    ].join("");
  }

  return [
    section("已有角色", "character"),
    section("已有场景", "scene"),
    section("已有产品", "product"),
    section("已有道具 / 关键物件", "prop"),
    section("已有视觉风格", "style"),
  ].join("");
}

/**
 * 轻量资产提取：只返回 characters/products/scenes，不生成分镜。
 * 供步骤 1「AI 提取角色/产品并继续」使用，避免完整分镜生成（8192 tokens）的浪费。
 */
export async function extractAssetsFromIdea(
  opts: GenerateScriptOptions,
): Promise<{ characters: RawCharacter[]; products: RawProduct[]; props: RawProp[]; scenes: RawScene[]; styles: RawStyle[] }> {
  const systemPrompt = buildTaskSystemPrompt(
    "extractAssets",
    opts.language,
    getActiveRules(),
  ).replace("{{assets}}", () => buildExtractAssetsContext(opts.language, opts.assets));

  const service = createAIService({
    provider: "openai",
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl,
  });

  const result = await service.chatCompletion({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: opts.prompt },
    ],
    temperature: 0.3,
    // 输出预算走 MAX_OUTPUT_TOKENS（65536），9 行角色描述 + 多资产不再有触顶风险
    enableThinking: false,
  });

  const content = result.content;

  // DEV-ONLY 取证留痕：把提取的模型原始响应写入 debug-dump/extract-logs/，
  // 用于事后分析 LLM 间歇性异常输出（如某次提取缺失角色）。best-effort 不影响主流程。
  if (import.meta.env.DEV) {
    void import("@/lib/devDump").then((m) =>
      m.dumpExtractLog({
        idea: opts.prompt.slice(0, 400),
        raw: content,
        usage: {
          promptTokens: result.usage?.promptTokens,
          completionTokens: result.usage?.completionTokens,
        },
      }),
    );
  }

  const jsonStr = extractJsonFromResponse(content);
  if (!jsonStr) {
    throw new Error("无法从模型响应中提取资产 JSON。");
  }

  const parsed = JSON.parse(jsonStr) as {
    characters?: RawCharacter[];
    products?: RawProduct[];
    props?: RawProp[];
    scenes?: RawScene[];
    styles?: RawStyle[];
  };

  const map = (arr: RawCharacter[] | undefined) =>
    Array.isArray(arr)
      ? arr.map((c) => ({
          name: c.name ?? "",
          description: c.description ?? "",
          appearancePrompt: c.appearancePrompt ?? "",
        }))
      : [];

  const mapStyles = (arr: RawStyle[] | undefined) =>
    Array.isArray(arr)
      ? arr.slice(0, 1).map((s) => ({
          name: s.name ?? "",
          description: s.description ?? "",
        }))
      : [];

  return {
    characters: map(parsed.characters),
    products: map(parsed.products),
    props: map(parsed.props),
    scenes: map(parsed.scenes),
    styles: mapStyles(parsed.styles),
  };
}
