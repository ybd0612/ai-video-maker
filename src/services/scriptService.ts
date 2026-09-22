// ────────────────────────────────────────────────────────────────────────────
// src/services/scriptService.ts
// Generates structured shots + extracted characters from a user prompt.
// Unified prompt — no mode branching. AI auto-detects characters in content.
// ────────────────────────────────────────────────────────────────────────────

import type { Shot, Asset, AssetDetails } from "@/stores/projectStore";
import { createAIService } from "@/services/ai/factory";
import {
  buildSystemPrompt as buildTaskSystemPrompt,
  getActiveRules,
  SYSTEM_PROMPT_SHOT_EDIT_EN,
  SYSTEM_PROMPT_SHOT_EDIT_ZH,
} from "@/lib/promptRules";
import { extractJsonFromResponse, parseJsonFromResponse } from "@/lib/jsonResponse";
import { getTranslation } from "@/i18n";
import { resolveGenerationParams } from "@/lib/generationParams";
import { composeAssetDescription } from "@/lib/assetDetails";
import { toIdRef, toIdRefList } from "@/lib/shotReferences";
import type { AuditOutcome } from "@/lib/refineContent";

interface GenerateScriptOptions {
  apiKey: string;
  baseUrl: string;
  prompt: string;
  language: "zh" | "en";
  aspectRatio: string;
  /** 项目统一资产（角色/场景/产品），用于构建一致性提示词 */
  assets?: Asset[];
}

export interface RawShot {
  scriptText: string;
  visualPrompt: string;
  motionPrompt: string;
  duration: number;
  dialogues?: Array<{ characterId: string | null; text: string; delivery?: string }>;
  activeCharacterIds?: unknown;
  activeSceneId?: unknown;
  activeProductIds?: unknown;
  activePropIds?: unknown;
  sceneDesc?: string;
  detailDesc?: string;
  lightingDesc?: string;
  styleDesc?: string;
  actionDesc?: string;
  cameraDesc?: string;
  envChangeDesc?: string;
  motionSpeedDesc?: string;
  useDualFrame?: boolean;
}

export interface RawCharacter {
  name: string;
  description: string;
  details?: Extract<AssetDetails, { kind: "character" }>;
  appearancePrompt: string;
}

/** 产品资产（模型输出格式，与角色同构） */
interface RawProduct {
  name: string;
  description: string;
  details?: Extract<AssetDetails, { kind: "product" }>;
  appearancePrompt: string;
}

/** 道具 / 关键物件资产（模型输出格式，与产品同构） */
interface RawProp {
  name: string;
  description: string;
  details?: Extract<AssetDetails, { kind: "prop" }>;
  appearancePrompt: string;
}

/** 场景资产（模型输出格式，与产品同构；appearancePrompt 为英文场景描述） */
interface RawScene {
  name: string;
  description: string;
  details?: Extract<AssetDetails, { kind: "scene" }>;
  appearancePrompt: string;
}

/** 风格资产（模型输出格式；仅 name+description，中文风格描述为 L1 用户事实源，
 *  英文 stylePrompt 由运行期懒派生，不落库在模型输出里） */
export interface RawStyle {
  name: string;
  description: string;
  /** 六个结构化视觉维度（v14 起为结构化事实源） */
  details?: Extract<AssetDetails, { kind: "style" }>;
  mediumMaterial?: string;
  colorPalette?: string;
  lightingMood?: string;
  cameraTexture?: string;
  composition?: string;
  emotion?: string;
}

/** 视觉方向提取结果：details 恒存在（模型缺字段时以空串补齐），可直接写回项目。 */
export interface RawVisualDirection extends RawStyle {
  details: Extract<AssetDetails, { kind: "style" }>;
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

const MAX_SCRIPT_RETRIES = 2;


/** 资产上下文段（动态数据：已有角色/场景/产品列表，供模型复用 ID 与保持一致性） */
function buildAssetsContext(language: "zh" | "en", assets?: Asset[]): string {
  const characters = (assets ?? []).filter((a) => a.type === "character");
  const scenes = (assets ?? []).filter((a) => a.type === "scene");
  const products = (assets ?? []).filter((a) => a.type === "product");
  const props = (assets ?? []).filter((a) => a.type === "prop");

  // 取资产的英文外观提示词（appearancePrompt）：角色存于专属字段 appearancePrompt，
  // 场景/产品/道具存于 prompt（extractAssets 提取时同源拷贝），这里兼容两种落库位置。
  const firstNonEmpty = (...values: unknown[]): string =>
    values.find((value): value is string => typeof value === "string" && value.trim() !== "")?.trim() ?? "";
  const assetAppearancePrompt = (a: Asset): string =>
    firstNonEmpty(a.appearancePrompt, a.prompt);

  // 每个资产条目显式注入英文外观提示词（appearancePrompt），同时保留 composeAssetDescription
  // 的 details；storyboardShot 骨架明确要求「主体外观直接沿用所给资产的英文外观描述」，
  // 缺了这段，模型就只能凭空捏造外观，破坏跨镜头一致性。
  const withAppearance = (line: string, ap: string): string =>
    ap ? `${line}\n  appearancePrompt: ${ap}` : line;

  if (language === "en") {
    let charSection = "";
    if (characters.length > 0) {
      charSection =
        "\nExisting characters (use corresponding IDs if content involves them). Reuse the character's English appearancePrompt verbatim in visualPrompt:\n" +
        characters
          .map((c) =>
            withAppearance(
              `- ${c.name} (ID: ${c.id}): ${composeAssetDescription(c) || "No description"}`,
              assetAppearancePrompt(c),
            ),
          )
          .join("\n") +
        "\n";
    }

    let sceneSection = "";
    if (scenes.length > 0) {
      sceneSection =
        "\nAvailable scene references (use these scenes, keep sceneDesc consistent with scene names). Reuse the scene's English appearancePrompt verbatim in visualPrompt:\n" +
        scenes
          .map((s) =>
            withAppearance(`- ${s.name} (ID: ${s.id}): ${composeAssetDescription(s)}`, assetAppearancePrompt(s)),
          )
          .join("\n") +
        "\n";
    }

    let productSection = "";
    if (products.length > 0) {
      productSection =
        "\nExisting product subjects (if content involves these products, keep the subject consistent across shots). Reuse the product's English appearancePrompt verbatim in visualPrompt:\n" +
        products
          .map((p) =>
            withAppearance(`- ${p.name} (ID: ${p.id}): ${composeAssetDescription(p)}`, assetAppearancePrompt(p)),
          )
          .join("\n") +
        "\n";
    }

    let propSection = "";
    if (props.length > 0) {
      propSection =
        "\nExisting props / key objects (use IDs when they appear in a shot). Reuse the prop's English appearancePrompt verbatim in visualPrompt:\n" +
        props
          .map((p) =>
            withAppearance(
              `- ${p.name} (ID: ${p.id}): ${composeAssetDescription(p)}`,
              assetAppearancePrompt(p),
            ),
          )
          .join("\n") +
        "\n";
    }

    return `${charSection}${sceneSection}${productSection}${propSection}`;
  }

  let charSection = "";
  if (characters.length > 0) {
    charSection =
      "\n已有角色（如内容涉及这些角色，请使用对应 ID）。visualPrompt 中的主体外观请直接沿用该角色的英文 appearancePrompt：\n" +
      characters
        .map((c) =>
          withAppearance(
            `- ${c.name}（ID: ${c.id}）：${composeAssetDescription(c) || "无描述"}`,
            assetAppearancePrompt(c),
          ),
        )
        .join("\n") +
      "\n";
  }

  let sceneSection = "";
  if (scenes.length > 0) {
    sceneSection =
      "\n已有场景参考（请在分镜中使用这些场景，保持 sceneDesc 与场景名称一致）。visualPrompt 请直接沿用该场景的英文 appearancePrompt：\n" +
      scenes
        .map((s) =>
          withAppearance(`- ${s.name}（ID: ${s.id}）：${composeAssetDescription(s)}`, assetAppearancePrompt(s)),
        )
        .join("\n") +
      "\n";
  }

  let productSection = "";
  if (products.length > 0) {
    productSection =
      "\n已有产品主体（如内容涉及这些产品，请确保镜头主体保持一致）。visualPrompt 请直接沿用该产品的英文 appearancePrompt：\n" +
      products
        .map((p) =>
          withAppearance(`- ${p.name}（ID: ${p.id}）：${composeAssetDescription(p)}`, assetAppearancePrompt(p)),
        )
        .join("\n") +
      "\n";
  }

  let propSection = "";
  if (props.length > 0) {
    propSection =
      "\n已有道具 / 关键物件（出现在镜头中时请使用对应 ID）。visualPrompt 请直接沿用该道具的英文 appearancePrompt：\n" +
      props
        .map((p) =>
          withAppearance(
            `- ${p.name}（ID: ${p.id}）：${composeAssetDescription(p)}`,
            assetAppearancePrompt(p),
          ),
        )
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
/**
 * 两阶段分镜（2026-09-15 重构）：
 *   阶段 1 大纲 —— 一次轻量调用规划全部镜头（标题 + 一句话内容 + 涉及资产名）；
 *   阶段 2 逐镜头 —— 每个镜头独立请求填充完整字段（并发受编排层控制），
 *   单请求输出从数千 token 降到数百，规避超时线并支持渐进式 UI。
 * 连贯性由大纲锁定：逐镜头请求都携带大纲全文作上下文。
 */
export interface StoryboardOutlineItem {
  title: string;
  summary: string;
  characterNames: string[];
  sceneName?: string;
}

export interface StoryboardOutlineResult {
  shots: StoryboardOutlineItem[];
  /** 想法需要但项目里还没有的新资产（编排层先补建入库，再发逐镜头请求） */
  newCharacters: RawCharacter[];
  newScenes: RawScene[];
}

export async function generateStoryboardOutline(
  opts: GenerateScriptOptions,
): Promise<StoryboardOutlineResult> {
  const systemPrompt = buildTaskSystemPrompt("storyboardOutline", opts.language, getActiveRules())
    .replace("{{assets}}", () => buildAssetsContext(opts.language, opts.assets));

  const service = createAIService({
    provider: "openai",
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl,
  });

  const params = await resolveGenerationParams({
    purpose: "storyboardOutline",
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl,
    context: [
      "Task: plan a shot breakdown (titles + one-sentence summaries + involved asset names) as strict JSON.",
      `Language: ${opts.language}`,
    ].join("\n"),
  });

  const result = await service.chatCompletion({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: opts.prompt },
    ],
    temperature: params.temperature,
    ...(params.topP === undefined ? {} : { topP: params.topP }),
    enableThinking: params.enableThinking,
  });

  const parsed = parseJsonFromResponse<{
    shots?: Array<{ title?: string; summary?: string; characterNames?: string[]; sceneName?: string }>;
    characters?: RawCharacter[];
    scenes?: RawScene[];
  }>(result.content);
  if (!parsed || !Array.isArray(parsed.shots) || parsed.shots.length === 0) {
    throw new Error(getTranslation("error.shotsInvalid"));
  }

  return {
    shots: parsed.shots.map((s) => ({
      title: s.title ?? "",
      summary: s.summary ?? "",
      characterNames: Array.isArray(s.characterNames) ? s.characterNames : [],
      sceneName: s.sceneName ?? undefined,
    })),
    newCharacters: Array.isArray(parsed.characters) ? parsed.characters : [],
    newScenes: Array.isArray(parsed.scenes) ? parsed.scenes : [],
  };
}

/**
 * 单镜头输出归一化：字段补默认、引用容错 + 空 prompt 兜底（跨阶段共享，导出供单测）。
 * 空 prompt 兜底为「不注入任何风格词」的最小安全兜底：只沿用原 scriptText（或空串），
 * 视觉风格交由模型生成，代码绝不判断/硬编码 photorealistic、8k、Slow cinematic 之类效果词。
 */
export function normalizeRawShot(s: RawShot): RawShot {
  const dialogues = Array.isArray(s.dialogues) ? s.dialogues : [];
  const shot: RawShot = {
    ...s,
    scriptText: typeof s.scriptText === "string" ? s.scriptText : "",
    visualPrompt: typeof s.visualPrompt === "string" ? s.visualPrompt : "",
    motionPrompt: typeof s.motionPrompt === "string" ? s.motionPrompt : "",
    dialogues: dialogues.map((d) => ({
      characterId: toIdRef(d.characterId) ?? null,
      text: typeof d.text === "string" ? d.text : "",
      delivery: typeof d.delivery === "string" ? d.delivery : undefined,
    })),
    activeCharacterIds: toIdRefList(s.activeCharacterIds),
    activeSceneId: toIdRefList(s.activeSceneId)[0],
    activeProductIds: toIdRefList(s.activeProductIds),
    activePropIds: toIdRefList(s.activePropIds),
    sceneDesc: s.sceneDesc ?? "",
    detailDesc: s.detailDesc ?? "",
    lightingDesc: s.lightingDesc ?? "",
    styleDesc: s.styleDesc ?? "",
    actionDesc: s.actionDesc ?? "",
    cameraDesc: s.cameraDesc ?? "",
    envChangeDesc: s.envChangeDesc ?? "",
    motionSpeedDesc: s.motionSpeedDesc ?? "",
    duration: [4, 5, 8].includes(s.duration) ? s.duration : 5,
    useDualFrame: s.useDualFrame ?? false,
  };
  // 最小安全兜底：不注入任何风格词（严禁 photorealistic/8k/Slow cinematic 等硬编码），
  // 仅沿用脚本原文，视觉效果交由模型生成；原文为空则保留空串（由上层重试让模型补全）。
  // 缺失时保持为空，让调用方的重试/失败处理识别为无效结果；不能把叙事脚本伪装成 API 提示词。
  if (!shot.visualPrompt.trim()) shot.visualPrompt = "";
  if (!shot.motionPrompt.trim()) shot.motionPrompt = "";
  return shot;
}

/**
 * 阶段 2：为单个镜头生成完整字段。
 * 输入携带大纲全文（保持镜头间连贯）与该镜头计划；输出单镜头结构。
 */
export async function generateStoryboardShot(
  opts: GenerateScriptOptions & {
    /** 大纲 JSON 字符串（全部镜头的计划），供模型保持叙事连贯 */
    outline: string;
    item: StoryboardOutlineItem;
    index: number;
    total: number;
    /** 重摇场景：给出该镜头上一版内容，要求变化出新一版 */
    variationOf?: { scriptText: string; visualPrompt: string };
  },
): Promise<RawShot> {
  const systemPrompt = buildTaskSystemPrompt("storyboardShot", opts.language, getActiveRules())
    .replace("{{assets}}", () => buildAssetsContext(opts.language, opts.assets));

  const service = createAIService({
    provider: "openai",
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl,
  });

  const params = await resolveGenerationParams({
    purpose: "storyboard",
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl,
    context: [
      "Task: write ONE complete storyboard shot (script + English visual/motion prompts) as strict JSON.",
      `Language: ${opts.language}`,
      `Aspect ratio: ${opts.aspectRatio}`,
      `Shot ${opts.index + 1}/${opts.total}`,
    ].join("\n"),
  });

  const userContent = [
    `Storyboard outline (for continuity, do not repeat other shots):\n${opts.outline}`,
    `Now write ONLY shot ${opts.index + 1}/${opts.total}:`,
    `Title: ${opts.item.title}`,
    `Plan: ${opts.item.summary}`,
    opts.item.characterNames.length > 0
      ? `Characters appearing in this shot (use these names): ${opts.item.characterNames.join(", ")}`
      : "",
    opts.item.sceneName ? `Scene: ${opts.item.sceneName}` : "",
    opts.variationOf
      ? `Variation request — improve on this previous version of the same shot (keep its intent, change the execution):\nscript: ${opts.variationOf.scriptText}\nvisual: ${opts.variationOf.visualPrompt}`
      : "",
    "Output the complete shot as strict JSON (single object, no array).",
  ].filter(Boolean).join("\n\n");

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_SCRIPT_RETRIES; attempt++) {
    const result = await service.chatCompletion({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      temperature: params.temperature,
      ...(params.topP === undefined ? {} : { topP: params.topP }),
      enableThinking: params.enableThinking,
    });

    const jsonStr = extractJsonFromResponse(result.content);
    if (!jsonStr) {
      lastError = new Error(
        `${getTranslation("error.scriptJsonExtractFailed", { attempt: attempt + 1 })} ${getTranslation("error.scriptNotJson", { body: result.content.slice(0, 200) })}`,
      );
      if (attempt < MAX_SCRIPT_RETRIES) continue;
      throw lastError;
    }

    try {
      const parsed = parseJsonFromResponse<RawShot>(result.content);
      if (!parsed) throw new Error(getTranslation("error.shotsInvalid"));
      const shot = normalizeRawShot(parsed);
      if (!shot.visualPrompt.trim() || !shot.motionPrompt.trim()) {
        throw new Error(getTranslation("error.shotMissingPromptRetry"));
      }
      return shot;
    } catch (parseErr) {
      lastError = parseErr instanceof Error ? parseErr : new Error(String(parseErr));
      if (attempt < MAX_SCRIPT_RETRIES) continue;
      throw lastError;
    }
  }
  throw lastError ?? new Error("Shot generation failed after retries.");
}

/* ── 单镜头指令改写（步骤 3 详情页，AI 修改的唯一入口） ─────────────────── */

/**
 * 交给模型的镜头载荷：只含内容字段，不含 id / status / imageUrl / videoUrl 等运行时数据。
 * 资产引用统一转成资产名称（模型更容易把名称写对，且与 {{assets}} 上下文一致）。
 */
function buildShotEditPayload(shot: Shot, assets: Asset[]): Record<string, unknown> {
  const nameOf = (id: string | undefined, type: Asset["type"]): string | undefined => {
    if (!id) return undefined;
    return assets.find((asset) => asset.id === id && asset.type === type)?.name ?? id;
  };
  return {
    scriptText: shot.scriptText,
    visualPrompt: shot.visualPrompt,
    motionPrompt: shot.motionPrompt,
    sceneDesc: shot.sceneDesc ?? "",
    detailDesc: shot.detailDesc ?? "",
    lightingDesc: shot.lightingDesc ?? "",
    styleDesc: shot.styleDesc ?? "",
    actionDesc: shot.actionDesc ?? "",
    cameraDesc: shot.cameraDesc ?? "",
    envChangeDesc: shot.envChangeDesc ?? "",
    motionSpeedDesc: shot.motionSpeedDesc ?? "",
    duration: shot.duration,
    dialogues: shot.dialogues.map((line) => ({
      characterName: nameOf(line.characterId ?? undefined, "character") ?? "",
      text: line.text,
      ...(line.delivery ? { delivery: line.delivery } : {}),
    })),
    activeCharacterNames: shot.activeCharacterIds
      .map((id) => nameOf(id, "character"))
      .filter((name): name is string => !!name),
    activeSceneName: nameOf(shot.activeSceneId, "scene"),
    activeProductNames: shot.activeProductIds
      .map((id) => nameOf(id, "product"))
      .filter((name): name is string => !!name),
    activePropNames: shot.activePropIds
      .map((id) => nameOf(id, "prop"))
      .filter((name): name is string => !!name),
  };
}

/**
 * 单镜头指令改写：把已有镜头 + 用户修改要求交给文本模型，返回重写后的完整镜头。
 * 字段规格复用 storyboardShot 骨架（避免两处规格漂移），重试策略与逐镜头生成一致。
 */
export async function reviseShotWithInstruction(opts: {
  apiKey: string;
  baseUrl: string;
  language: "zh" | "en";
  aspectRatio: string;
  assets?: Asset[];
  shot: Shot;
  instruction: string;
}): Promise<RawShot> {
  const spec = buildTaskSystemPrompt("storyboardShot", opts.language, getActiveRules())
    .replace("{{assets}}", () => buildAssetsContext(opts.language, opts.assets));
  const editIntro =
    opts.language === "en" ? SYSTEM_PROMPT_SHOT_EDIT_EN : SYSTEM_PROMPT_SHOT_EDIT_ZH;
  const systemPrompt = `${editIntro}\n\n---\n\n${spec}`;

  const service = createAIService({
    provider: "openai",
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl,
  });

  const params = await resolveGenerationParams({
    purpose: "shotEdit",
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl,
    context: [
      "Task: revise ONE existing storyboard shot per the user's instruction and return the complete updated shot as strict JSON.",
      `Language: ${opts.language}`,
      `Aspect ratio: ${opts.aspectRatio}`,
    ].join("\n"),
  });

  const userContent = [
    `Current shot (complete JSON):\n${JSON.stringify(buildShotEditPayload(opts.shot, opts.assets ?? []), null, 2)}`,
    `Revision request:\n${opts.instruction.trim() || "Improve this shot's script and prompts while keeping its intent."}`,
    "Return the complete updated shot as strict JSON (single object, no array).",
  ].join("\n\n");

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_SCRIPT_RETRIES; attempt++) {
    const result = await service.chatCompletion({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      temperature: params.temperature,
      ...(params.topP === undefined ? {} : { topP: params.topP }),
      enableThinking: params.enableThinking,
    });

    const jsonStr = extractJsonFromResponse(result.content);
    if (!jsonStr) {
      lastError = new Error(
        `${getTranslation("error.scriptJsonExtractFailed", { attempt: attempt + 1 })} ${getTranslation("error.scriptNotJson", { body: result.content.slice(0, 200) })}`,
      );
      if (attempt < MAX_SCRIPT_RETRIES) continue;
      throw lastError;
    }

    try {
      const parsed = parseJsonFromResponse<RawShot>(result.content);
      if (!parsed) throw new Error(getTranslation("error.shotsInvalid"));
      const shot = normalizeRawShot(parsed);
      if (!shot.visualPrompt.trim() || !shot.motionPrompt.trim()) {
        throw new Error(getTranslation("error.shotMissingPromptRetry"));
      }
      return shot;
    } catch (parseErr) {
      lastError = parseErr instanceof Error ? parseErr : new Error(String(parseErr));
      if (attempt < MAX_SCRIPT_RETRIES) continue;
      throw lastError;
    }
  }
  throw lastError ?? new Error("Shot revision failed after retries.");
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
 * 把模型返回的视觉方向 JSON 规范化为 RawVisualDirection：
 * details 恒存在（缺字段以空串补齐），旧平铺 6 字段写法同时兼容。
 */
export function parseVisualDirection(content: string): RawVisualDirection | null {
  const parsed = parseJsonFromResponse<Partial<RawStyle>>(content);
  if (!parsed) return null;
  // 模型不会返回内部判别字段 kind，这里统一补齐；
  // 同时兼容它把六个维度写在 details 或平铺在顶层两种写法。
  const raw = parsed.details;
  const pick = (key: keyof Omit<Extract<AssetDetails, { kind: "style" }>, "kind">): string =>
    (raw?.[key] ?? parsed[key] ?? "").trim();
  const details: Extract<AssetDetails, { kind: "style" }> = {
    kind: "style",
    mediumMaterial: pick("mediumMaterial"),
    colorPalette: pick("colorPalette"),
    lightingMood: pick("lightingMood"),
    cameraTexture: pick("cameraTexture"),
    composition: pick("composition"),
    emotion: pick("emotion"),
  };
  return {
    name: parsed.name ?? "",
    description: parsed.description ?? parsed.name ?? "",
    details,
    mediumMaterial: details.mediumMaterial,
    colorPalette: details.colorPalette,
    lightingMood: details.lightingMood,
    cameraTexture: details.cameraTexture,
    composition: details.composition,
    emotion: details.emotion,
  };
}

/**
 * 用模型给出的重写结果替换原视觉方向：逐字段采用非空重写值，其余保持原值。
 * 空重写字段不覆盖原值（避免模型只改一处时把其他维度抹空）。
 */
export function applyVisualDirectionRewrite(
  base: RawVisualDirection,
  rewritten: Partial<RawStyle>,
): RawVisualDirection {
  const pick = (next: unknown, fallback: string): string =>
    typeof next === "string" && next.trim() ? next.trim() : fallback;

  const incoming = rewritten.details;
  const details: Extract<AssetDetails, { kind: "style" }> = {
    kind: "style",
    mediumMaterial: pick(incoming?.mediumMaterial ?? rewritten.mediumMaterial, base.details.mediumMaterial),
    colorPalette: pick(incoming?.colorPalette ?? rewritten.colorPalette, base.details.colorPalette),
    lightingMood: pick(incoming?.lightingMood ?? rewritten.lightingMood, base.details.lightingMood),
    cameraTexture: pick(incoming?.cameraTexture ?? rewritten.cameraTexture, base.details.cameraTexture),
    composition: pick(incoming?.composition ?? rewritten.composition, base.details.composition),
    emotion: pick(incoming?.emotion ?? rewritten.emotion, base.details.emotion),
  };

  return {
    name: pick(rewritten.name, base.name),
    description: pick(rewritten.description, base.description),
    details,
    mediumMaterial: details.mediumMaterial,
    colorPalette: details.colorPalette,
    lightingMood: details.lightingMood,
    cameraTexture: details.cameraTexture,
    composition: details.composition,
    emotion: details.emotion,
  };
}

/** 视觉方向自检：把方向与项目自身主体清单交给模型，判断是否越界并重写。 */
export async function auditVisualDirection(opts: {
  apiKey: string;
  baseUrl: string;
  language: "zh" | "en";
  direction: RawVisualDirection;
  /** 项目自身非风格资产名（数据驱动，代码不硬编码任何主体词） */
  forbiddenSubjects: string[];
}): Promise<AuditOutcome<RawVisualDirection>> {
  const keep = { clean: true as const, value: opts.direction };
  try {
    const params = await resolveGenerationParams({
      purpose: "visualDirectionAudit",
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl,
      context: [
        "Task: audit a project-level visual direction and rewrite it when it overreaches into concrete subjects or narrative.",
        `Language: ${opts.language}`,
      ].join("\n"),
    });
    const service = createAIService({
      provider: "openai",
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl,
    });
    const result = await service.chatCompletion({
      messages: [
        {
          role: "system",
          content: buildTaskSystemPrompt("visualDirectionAudit", opts.language, getActiveRules()),
        },
        {
          role: "user",
          content: [
            `Visual direction:\n${JSON.stringify({
              name: opts.direction.name,
              description: opts.direction.description,
              details: opts.direction.details,
            })}`,
            opts.forbiddenSubjects.length > 0
              ? `Forbidden subject list: ${opts.forbiddenSubjects.join(", ")}`
              : "Forbidden subject list: (none provided)",
          ].join("\n"),
        },
      ],
      temperature: params.temperature,
      ...(params.topP === undefined ? {} : { topP: params.topP }),
      enableThinking: params.enableThinking,
    });

    const parsed = parseJsonFromResponse<{ clean?: boolean; rewritten?: Partial<RawStyle> }>(
      result.content,
    );
    if (!parsed || parsed.clean !== false) return keep;

    const rewritten = parsed.rewritten;
    if (!rewritten || typeof rewritten !== "object" || Array.isArray(rewritten)) return keep;
    return { clean: false, value: applyVisualDirectionRewrite(opts.direction, rewritten) };
  } catch (err) {
    console.warn("Visual direction audit failed, keeping extracted direction:", err);
    return keep;
  }
}

/** 主体忠实自检的修正条目（字段一律按 unknown 接收后再校验，不信任模型输出形状） */
export interface CharacterFidelityFix {
  name?: unknown;
  description?: unknown;
}

/**
 * 按角色名回填忠实修正：只覆盖非空字符串的 description。
 * 名字对不上、字段缺失或内容没变化都原样返回 —— 宁可保留提取结果，
 * 也不引入半截设定（description 是 9 行结构的唯一载体，被清空会连带丢物种；
 * 外观提示词由代码从它拼装，因此修 description 就等于修了生图输入）。
 */
export function applyCharacterFidelityFixes(
  characters: RawCharacter[],
  fixes: Map<string, CharacterFidelityFix>,
): RawCharacter[] {
  return characters.map((c) => {
    const fix = fixes.get(String(c.name ?? "").trim().toLocaleLowerCase());
    if (!fix) return c;
    const description =
      typeof fix.description === "string" && fix.description.trim() ? fix.description : c.description;
    return description === c.description ? c : { ...c, description };
  });
}

/**
 * 角色主体忠实自检：把想法原文与已提取角色交给模型，只审「主体身份是否被换掉」
 * 与「同一角色中英文物种是否打架」，越界时按角色名回填修正后的设定。
 *
 * 提取阶段已有 extract.subject-fidelity 条目约束，但条目只是"要求"；
 * 这里是事后核对，两者共用同一判据（想法原文写明的身份不可替换）。
 * 审计或解析失败一律保留原提取结果，绝不阻塞提取主链路。
 */
export async function auditCharacterFidelity(opts: {
  apiKey: string;
  baseUrl: string;
  language: "zh" | "en";
  idea: string;
  characters: RawCharacter[];
}): Promise<AuditOutcome<RawCharacter[]>> {
  const keep = { clean: true as const, value: opts.characters };
  if (opts.characters.length === 0) return keep;
  try {
    const params = await resolveGenerationParams({
      purpose: "characterFidelityAudit",
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl,
      context: [
        "Task: audit extracted characters against the original idea text and fix only swapped subject identities.",
        `Characters: ${opts.characters.length}`,
        `Language: ${opts.language}`,
      ].join("\n"),
    });
    const service = createAIService({
      provider: "openai",
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl,
    });
    const result = await service.chatCompletion({
      messages: [
        {
          role: "system",
          content: buildTaskSystemPrompt("characterFidelityAudit", opts.language, getActiveRules()),
        },
        {
          role: "user",
          content: [
            `Idea text:\n${opts.idea}`,
            `Extracted characters:\n${JSON.stringify(
              opts.characters.map((c) => ({
                name: c.name,
                description: c.description,
                species: c.details?.species,
              })),
              null,
              2,
            )}`,
          ].join("\n\n"),
        },
      ],
      temperature: params.temperature,
      ...(params.topP === undefined ? {} : { topP: params.topP }),
      enableThinking: params.enableThinking,
    });

    const parsed = parseJsonFromResponse<{ clean?: boolean; fixes?: CharacterFidelityFix[] }>(
      result.content,
    );
    if (!parsed || parsed.clean !== false || !Array.isArray(parsed.fixes)) return keep;

    const fixesByName = new Map<string, CharacterFidelityFix>();
    for (const fix of parsed.fixes) {
      if (fix && typeof fix.name === "string" && fix.name.trim()) {
        fixesByName.set(fix.name.trim().toLocaleLowerCase(), fix);
      }
    }
    if (fixesByName.size === 0) return keep;
    return { clean: false, value: applyCharacterFidelityFixes(opts.characters, fixesByName) };
  } catch (err) {
    console.warn("Character fidelity audit failed, keeping extracted characters:", err);
    return keep;
  }
}

/**
 * 轻量资产提取：只返回 characters/products/scenes，不生成分镜。
 * 供步骤 1「AI 提取角色/产品并继续」使用，避免完整分镜生成（8192 tokens）的浪费。
 */
export async function extractVisualDirectionFromIdea(
  opts: GenerateScriptOptions,
): Promise<RawVisualDirection> {
  const systemPrompt = buildTaskSystemPrompt("visualDirection", opts.language, getActiveRules());
  const service = createAIService({ provider: "openai", apiKey: opts.apiKey, baseUrl: opts.baseUrl });
  const params = await resolveGenerationParams({
    purpose: "visualDirection",
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl,
    context: [
      "Task: extract a reusable, subject-free visual direction (medium, color, lighting, camera texture, composition, atmosphere) from a story idea.",
      `Language: ${opts.language}`,
      `Aspect ratio: ${opts.aspectRatio}`,
    ].join("\n"),
  });
  const result = await service.chatCompletion({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: opts.prompt },
    ],
    temperature: params.temperature,
    ...(params.topP === undefined ? {} : { topP: params.topP }),
    enableThinking: params.enableThinking,
  });
  const direction = parseVisualDirection(result.content);
  if (!direction)
    throw new Error(getTranslation("error.visualDirectionParseFailed"));
  return direction;
}

export type ExtractableAssetType = "character" | "scene" | "product" | "prop" | "style";

/**
 * 分类型资产提取（2026-09-15 重构）：每次只请求一类资产，编排层并行发多个
 * 请求并逐类写回 —— 单请求输出变小（不再贴超时线），且资产卡片可逐类蹦出。
 * 复用同一 extractAssets 规格，类型过滤通过 user 指令约束。
 */
export async function extractAssetsByType(
  opts: GenerateScriptOptions,
  type: ExtractableAssetType,
  visualDirection?: RawStyle,
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

  const params = await resolveGenerationParams({
    purpose: "assetExtraction",
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl,
    // 四类资产并发提取且决策上下文各不相同（见下方 "This call extracts ONLY"）；
    // 不按类型分键会让四路决策互相覆盖同一缓存槽，下一轮整体命中最后写入者。
    cacheKey: type,
    context: [
      "Task: extract typed assets (characters, products, props, scenes, style) with structured details as strict JSON. Characters carry structured details only (their image prompt is composed in code); products/props/scenes also carry an English appearance prompt.",
      `This call extracts ONLY: ${type}`,
      `Language: ${opts.language}`,
      `Aspect ratio: ${opts.aspectRatio}`,
      `Existing assets: ${opts.assets?.length ?? 0}`,
    ].join("\n"),
  });

  const result = await service.chatCompletion({
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          opts.prompt,
          visualDirection
            ? `Confirmed visual direction:\n${JSON.stringify(visualDirection)}`
            : "",
          "Design assets according to the confirmed visual direction. Asset appearance prompts describe the subject only; do not redefine the global art style.",
          `THIS CALL EXTRACTS ONLY "${type}": the "${type}s" array carries the assets for this call, and every other array MUST be an empty array.`,
        ].filter(Boolean).join("\n\n"),
      },
    ],
    temperature: params.temperature,
    ...(params.topP === undefined ? {} : { topP: params.topP }),
    enableThinking: params.enableThinking,
  });

  const content = result.content;

  // DEV-ONLY 取证留痕：把提取的模型原始响应写入 debug-dump/extract-logs/，
  // 用于事后分析 LLM 间歇性异常输出（如某次提取缺失角色）。best-effort 不影响主流程。
  if (import.meta.env.DEV) {
    void import("@/lib/devDump").then((m) =>
      m.dumpExtractLog({
        idea: `${type}: ${opts.prompt.slice(0, 380)}`,
        raw: content,
        usage: {
          promptTokens: result.usage?.promptTokens,
          completionTokens: result.usage?.completionTokens,
        },
      }),
    );
  }

  const parsed = parseJsonFromResponse<{
    characters?: RawCharacter[];
    products?: RawProduct[];
    props?: RawProp[];
    scenes?: RawScene[];
    styles?: RawStyle[];
  }>(content);
  if (!parsed) {
    const jsonStr = extractJsonFromResponse(content);
    throw new Error(
      jsonStr
        ? `${getTranslation("error.assetsParseFailed")} ${getTranslation("error.scriptNotJson", { body: jsonStr.slice(0, 200) })}`
        : getTranslation("error.assetsParseFailed"),
    );
  }

  const map = <T extends RawCharacter | RawProduct | RawProp | RawScene, D>(
    arr: T[] | undefined,
    getDetails: (item: T) => D | undefined,
  ): Array<{
    name: string;
    description: string;
    details?: D;
    appearancePrompt: string;
  }> =>
    Array.isArray(arr)
      ? arr.map((c) => ({
          name: c.name ?? "",
          description: c.description ?? "",
          details: getDetails(c),
          appearancePrompt: c.appearancePrompt ?? "",
        }))
      : [];

  const mapStyles = (arr: RawStyle[] | undefined): RawStyle[] =>
    Array.isArray(arr)
      ? arr.slice(0, 1).map((s) => {
          const details = s.details ?? {
            kind: "style" as const,
            mediumMaterial: s.mediumMaterial ?? "",
            colorPalette: s.colorPalette ?? "",
            lightingMood: s.lightingMood ?? "",
            cameraTexture: s.cameraTexture ?? "",
            composition: s.composition ?? "",
            emotion: s.emotion ?? "",
          };
          return {
            name: s.name ?? "",
            description: s.description ?? "",
            details,
            mediumMaterial: details.mediumMaterial,
            colorPalette: details.colorPalette,
            lightingMood: details.lightingMood,
            cameraTexture: details.cameraTexture,
            composition: details.composition,
            emotion: details.emotion,
          };
        })
      : [];

  // 类型过滤兜底：即使模型越界输出了其他类数组，也只保留本次请求的目标类
  const filtered = {
    characters: type === "character" ? map(parsed.characters, (item) => item.details) : [],
    products: type === "product" ? map(parsed.products, (item) => item.details) : [],
    props: type === "prop" ? map(parsed.props, (item) => item.details) : [],
    scenes: type === "scene" ? map(parsed.scenes, (item) => item.details) : [],
    styles: type === "style" ? mapStyles(parsed.styles) : [],
  };
  const targetMap: Record<ExtractableAssetType, unknown[]> = {
    character: filtered.characters,
    scene: filtered.scenes,
    product: filtered.products,
    prop: filtered.props,
    style: filtered.styles,
  };
  if (targetMap[type].length === 0) {
    throw new Error(getTranslation("error.assetsParseFailed"));
  }
  return filtered;
}
