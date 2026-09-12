// ────────────────────────────────────────────────────────────────────────────
// src/services/scriptService.ts
// Generates structured shots + extracted characters from a user prompt.
// Unified prompt — no mode branching. AI auto-detects characters in content.
// ────────────────────────────────────────────────────────────────────────────

import type { Shot, Asset } from "@/stores/projectStore";
import { createAIService } from "@/services/ai/factory";

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

/** 场景资产（模型输出格式，与产品同构；appearancePrompt 为英文场景描述） */
interface RawScene {
  name: string;
  description: string;
  appearancePrompt: string;
}

export interface GenerateScriptResult {
  shots: Omit<Shot, "id" | "index" | "status">[];
  characters: RawCharacter[];
  products: RawProduct[];
  scenes: RawScene[];
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
  return language === "zh"
    ? buildPromptZh(assets)
    : buildPromptEn(assets);
}

function buildPromptZh(assets?: Asset[]): string {
  const characters = (assets ?? []).filter((a) => a.type === "character");
  const scenes = (assets ?? []).filter((a) => a.type === "scene");
  const products = (assets ?? []).filter((a) => a.type === "product");

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

  return `你是一位专业的短视频分镜策划师。用户会给你一个主题或想法，你需要：
1. 将其拆分为 4-8 个分镜镜头
2. 如果内容中有人物角色，提取角色信息
3. 如果内容是产品/商品/实物主体，提取产品信息
4. 如果内容涉及具体场景，提取场景信息
${charSection}${sceneSection}${productSection}
严格按以下 JSON 格式返回，不要包含任何其他文字：
{
  "characters": [
    {
      "name": "角色名",
      "description": "角色简介（性格、身份；动物/拟人角色同样适用）",
      "appearancePrompt": "外貌描述（英文，用于 AI 绘图；人物写年龄体型发型服饰，动物写物种体型毛色特征等）"
    }
  ],
  "products": [
    {
      "name": "产品名",
      "description": "产品简介（类型、用途）",
      "appearancePrompt": "外观描述（英文，用于 AI 绘图，包含款式、颜色、材质、细节、logo 等）"
    }
  ],
  "scenes": [
    {
      "name": "场景名",
      "description": "场景简介（中文）",
      "appearancePrompt": "场景英文描述（用于 AI 绘图：环境、光线、氛围）"
    }
  ],
  "shots": [
    {
      "activeCharacterIds": ["char_xxx"],
      "dialogues": [
        { "characterId": null, "text": "旁白文本", "delivery": "平静" },
        { "characterId": "char_xxx", "text": "角色台词", "delivery": "温柔地" }
      ],
      "scriptText": "该镜头旁白/文案（中文，简短有力）",
      "visualPrompt": "文生图英文提示词（完整描述，如有角色出场必须包含角色外貌）",
      "motionPrompt": "图生视频英文提示词（完整动态描述）",
      "subjectDesc": "主体描述（中文）",
      "sceneDesc": "场景/背景描述（中文）",
      "detailDesc": "细节/服饰描述（中文）",
      "lightingDesc": "光影/色调（中文）",
      "styleDesc": "艺术风格（中文）",
      "negativePrompt": "负向提示词（中文）",
      "actionDesc": "主体动作（中文）",
      "cameraDesc": "镜头运镜（中文）",
      "envChangeDesc": "环境变化（中文）",
      "motionSpeedDesc": "运动速率（中文）",
      "negativeMotionPrompt": "负向动态提示（中文）",
      "duration": 5
    }
  ]
}

重要规则：
- characters 数组：涵盖故事中的**一切角色主体**——人物、动物（如小兔子、小猫）、拟人化角色、机器人等，只要是故事的主角/配角就必须填入；仅纯风景内容才返回空数组 []
- products 数组：仅当某个实物是内容的**核心展示主体**（如带货商品、产品广告的主角）时才填写；角色手中/身边的普通道具（如小兔子抱着的胡萝卜）不要填入
- scenes 数组：故事提到任何环境/地点（森林、城市、室内、梦境空间等）就必须至少提取一个场景；仅纯抽象内容才返回空数组 []
- 如有已有角色，复用其 ID（不要重复创建）；如是新角色，生成新的 ID
- visualPrompt 和 motionPrompt 必须用英文（直接用于 AI API）
- 如有角色出场，visualPrompt 必须包含角色完整外貌描述
- 如有产品主体，visualPrompt 必须包含产品完整外观描述（款式、颜色、材质）
- 中文子字段给用户在界面上看，用中文填写
- dialogues：characterId 为 null 表示旁白
- 每镜头 duration 为 4、5 或 8 秒（视频模型支持 4-12 秒）
- 总镜头数 4-8 个，节奏有起承转合

⚠️ 内容安全要求：
- 用 "young man/young woman/teenager" 代替 "boy/girl/child"
- 不要暴力、血腥、裸露等敏感内容
- 不要真人政治人物、名人肖像
- 服饰描述得体，适合全年龄段`;
}

function buildPromptEn(assets?: Asset[]): string {
  const characters = (assets ?? []).filter((a) => a.type === "character");
  const scenes = (assets ?? []).filter((a) => a.type === "scene");
  const products = (assets ?? []).filter((a) => a.type === "product");

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

  return `You are a professional short-video storyboard planner. The user will give you a topic or idea. You need to:
1. Break it into 4-8 shot scenes
2. If the content involves ANY character/subject (humans, animals like a little rabbit, anthropomorphic creatures, robots), extract character info
3. If a physical item is the CORE showcased subject (e.g. a product ad), extract product info
4. If the content involves concrete scenes, extract scene info
${charSection}${sceneSection}${productSection}
Return strictly in this JSON format, no other text:
{
  "characters": [
    {
      "name": "Character name",
      "description": "Brief description (personality, role; applies to animals/anthropomorphic subjects too)",
      "appearancePrompt": "Appearance description in English (humans: age, build, hair, clothing; animals: species, body shape, fur color, features, etc.)"
    }
  ],
  "products": [
    {
      "name": "Product name",
      "description": "Brief description (type, purpose)",
      "appearancePrompt": "Appearance description in English (style, color, material, details, logo, etc. for AI image generation)"
    }
  ],
  "scenes": [
    {
      "name": "Scene name",
      "description": "Brief description of the scene",
      "appearancePrompt": "English scene description (environment, lighting, atmosphere for AI image generation)"
    }
  ],
  "shots": [
    {
      "activeCharacterIds": ["char_xxx"],
      "dialogues": [
        { "characterId": null, "text": "Narrator text", "delivery": "calm" },
        { "characterId": "char_xxx", "text": "Character dialogue", "delivery": "gently" }
      ],
      "scriptText": "Shot narration (short, punchy)",
      "visualPrompt": "Text-to-image English prompt (full description, must include character appearance if characters appear)",
      "motionPrompt": "Image-to-video English prompt (full motion description)",
      "subjectDesc": "Subject description",
      "sceneDesc": "Scene/background",
      "detailDesc": "Details/clothing",
      "lightingDesc": "Lighting/color",
      "styleDesc": "Art style",
      "negativePrompt": "Negative prompt",
      "actionDesc": "Subject action",
      "cameraDesc": "Camera movement",
      "envChangeDesc": "Environment changes",
      "motionSpeedDesc": "Motion speed",
      "negativeMotionPrompt": "Negative motion prompt",
      "duration": 5
    }
  ]
}

Important rules:
- characters array: include ANY story character/subject — humans, animals (e.g. a little rabbit), anthropomorphic or fantasy creatures, robots. Every protagonist/side character MUST be listed; only return [] for pure landscape content
- products array: ONLY fill when a physical item is the CORE subject being showcased (e.g. a product for an ad). Everyday props held by characters (e.g. a carrot a rabbit hugs) do NOT belong here
- scenes array: if the story mentions ANY environment/setting (forest, city, indoor, dream space, etc.), extract at least one scene; only return [] for purely abstract content
- Reuse existing character IDs if applicable; generate new IDs for new characters
- visualPrompt and motionPrompt MUST be in English (sent directly to AI APIs)
- If characters appear, visualPrompt MUST include their full appearance
- If a product subject appears, visualPrompt MUST include its full appearance (style, color, material)
- Sub-fields (subjectDesc etc.) are shown to users in their language
- dialogues: characterId null = narrator
- Each shot duration: 4, 5, or 8 seconds (the video model supports 4-12s)
- 4-8 shots total, with narrative pacing

Content safety:
- Use "young man/young woman/teenager" instead of "boy/girl/child"
- No violence, gore, nudity, or sensitive content
- No real political figures or celebrity likenesses
- Keep clothing descriptions modest and appropriate`;
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
      maxTokens: 8192,
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
        scenes?: RawScene[];
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

      // 场景提取（供步骤 2 生成场景参考图）
      const extractedScenes: RawScene[] = Array.isArray(parsed.scenes)
        ? parsed.scenes.map((c) => ({
            name: c.name ?? "",
            description: c.description ?? "",
            appearancePrompt: c.appearancePrompt ?? "",
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

      return { shots, characters: extractedCharacters, products: extractedProducts, scenes: extractedScenes };
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

function buildExtractPromptZh(assets?: Asset[]): string {
  const charSection =
    (assets ?? []).filter((a) => a.type === "character").length > 0
      ? "\n已有角色：" + (assets ?? []).filter((a) => a.type === "character").map((c) => `- ${c.name}`).join("\n") + "\n"
      : "";
  const productSection =
    (assets ?? []).filter((a) => a.type === "product").length > 0
      ? "\n已有产品：" + (assets ?? []).filter((a) => a.type === "product").map((p) => `- ${p.name}`).join("\n") + "\n"
      : "";
  return `你是一位专业的短视频资产提取助手。用户会给你一个视频主题或想法，请提取其中的资产信息，严格按以下 JSON 格式返回，不要包含任何其他文字：
{
  "characters": [
    { "name": "角色名", "description": "角色简介（性格、身份）", "appearancePrompt": "外貌描述（英文，用于 AI 绘图）" }
  ],
  "products": [
    { "name": "产品名", "description": "产品简介（类型、用途）", "appearancePrompt": "外观描述（英文，用于 AI 绘图，包含款式、颜色、材质、logo 等）" }
  ],
  "scenes": [
    { "name": "场景名", "description": "场景简介（中文）", "appearancePrompt": "场景英文描述（环境、光线、氛围）" }
  ]
}
${charSection}${productSection}
规则：
- characters：涵盖故事中的**一切角色主体**——人物、动物（如小兔子、小猫）、拟人化角色、机器人等，只要是故事的主角/配角就必须全部填入；仅纯风景内容才 []
- products：仅当某个实物是内容的**核心展示主体**（如带货商品、产品广告的主角）时填写；角色手中/身边的普通道具（如小兔子抱着的胡萝卜）不要填入
- scenes：故事提到任何环境/地点（森林、城市、室内、梦境空间等）就必须至少提取一个场景；仅纯抽象内容才 []
- 不要生成分镜，只返回上述 JSON`;
}

function buildExtractPromptEn(assets?: Asset[]): string {
  const charSection =
    (assets ?? []).filter((a) => a.type === "character").length > 0
      ? "\nExisting characters: " + (assets ?? []).filter((a) => a.type === "character").map((c) => `- ${c.name}`).join("\n") + "\n"
      : "";
  const productSection =
    (assets ?? []).filter((a) => a.type === "product").length > 0
      ? "\nExisting products: " + (assets ?? []).filter((a) => a.type === "product").map((p) => `- ${p.name}`).join("\n") + "\n"
      : "";
  return `You are a professional short-video asset extraction assistant. The user will give you a video topic or idea. Extract asset info and return strictly in this JSON format, no other text:
{
  "characters": [
    { "name": "Character name", "description": "Brief description", "appearancePrompt": "Appearance description in English (for AI image generation)" }
  ],
  "products": [
    { "name": "Product name", "description": "Brief description", "appearancePrompt": "Appearance description in English (style, color, material, logo, etc.)" }
  ],
  "scenes": [
    { "name": "Scene name", "description": "Brief description", "appearancePrompt": "English scene description (environment, lighting, atmosphere)" }
  ]
}
${charSection}${productSection}
Rules:
- characters: ONLY fill if content has characters, otherwise []
- products: ONLY fill if content has a product/goods subject, otherwise []
- scenes: ONLY fill if content involves concrete scenes, otherwise []
- Do NOT generate storyboard shots; return only the JSON above`;
}

/**
 * 轻量资产提取：只返回 characters/products/scenes，不生成分镜。
 * 供步骤 1「AI 提取角色/产品并继续」使用，避免完整分镜生成（8192 tokens）的浪费。
 */
export async function extractAssetsFromIdea(
  opts: GenerateScriptOptions,
): Promise<{ characters: RawCharacter[]; products: RawProduct[]; scenes: RawScene[] }> {
  const systemPrompt =
    opts.language === "en" ? buildExtractPromptEn(opts.assets) : buildExtractPromptZh(opts.assets);

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
    maxTokens: 1024,
    enableThinking: false,
  });

  const jsonStr = extractJsonFromResponse(result.content);
  if (!jsonStr) {
    throw new Error("无法从模型响应中提取资产 JSON。");
  }

  const parsed = JSON.parse(jsonStr) as {
    characters?: RawCharacter[];
    products?: RawProduct[];
    scenes?: RawScene[];
  };

  const map = (arr: RawCharacter[] | undefined) =>
    Array.isArray(arr)
      ? arr.map((c) => ({
          name: c.name ?? "",
          description: c.description ?? "",
          appearancePrompt: c.appearancePrompt ?? "",
        }))
      : [];

  return {
    characters: map(parsed.characters),
    products: map(parsed.products),
    scenes: map(parsed.scenes),
  };
}
