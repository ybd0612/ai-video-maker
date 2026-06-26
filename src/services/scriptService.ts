// ────────────────────────────────────────────────────────────────────────────
// src/services/scriptService.ts
// Generates structured shots + extracted characters from a user prompt.
// Unified prompt — no mode branching. AI auto-detects characters in content.
// ────────────────────────────────────────────────────────────────────────────

import type { Shot, Character, SceneReference } from "@/stores/projectStore";
import { MODELS } from "@/lib/models";
import { fetchWithRetry } from "@/lib/fetchWithRetry";
import { chatCompletionFromSettings } from "./chatService";

interface GenerateScriptOptions {
  apiKey: string;
  baseUrl: string;
  prompt: string;
  language: "zh" | "en";
  aspectRatio: string;
  characters?: Character[];
  sceneReferences?: SceneReference[];
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
}

interface RawCharacter {
  name: string;
  description: string;
  appearancePrompt: string;
}

export interface GenerateScriptResult {
  shots: Omit<Shot, "id" | "index" | "status">[];
  characters: RawCharacter[];
}

/* ── Motion translation ─────────────────────────────────────────────────── */

export interface MotionTranslationResult {
  visualPrompt: string;   // 画面层（文生图用）
  motionPrompt: string;   // 运动层（图生视频用）
}

/**
 * 将分镜文案翻译为画面层 + 运动层提示词。
 * 内部读取 settingsStore 的 API 配置，调用方无需传 key。
 */
export async function translateToMotion(
  scriptText: string,
  characters: Character[],
  scene?: SceneReference,
): Promise<MotionTranslationResult> {
  const characterDesc = characters.map((c) => `${c.name}: ${c.fullPrompt}`).join("\n");
  const sceneDesc = scene ? `场景: ${scene.prompt}` : "";

  const systemPrompt = `你是一位专业的视频分镜提示词专家。

将用户的故事描述转换为两部分：

1. **画面层（visualPrompt）**：用于文生图，描述静态画面
   - 包含：主体描述、场景、光影、风格
   - 格式：英文，逗号分隔

2. **运动层（motionPrompt）**：用于图生视频，描述物理运动
   - 包含：镜头运动、角色动作、环境动态
   - 格式：英文，具体物理运动指令
   - 不要写情绪，只写具体动作

角色信息：
${characterDesc}

${sceneDesc}

请以 JSON 格式输出：
{
  "visualPrompt": "画面层提示词",
  "motionPrompt": "运动层提示词"
}`;

  const result = await chatCompletionFromSettings({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: scriptText },
    ],
  });

  try {
    return JSON.parse(result.content);
  } catch {
    // AI 返回内容无法解析时的兜底值
    return {
      visualPrompt: scriptText,
      motionPrompt: "Camera slowly pans, gentle movement",
    };
  }
}

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
  characters?: Character[],
  sceneReferences?: SceneReference[],
): string {
  return language === "zh"
    ? buildPromptZh(characters, sceneReferences)
    : buildPromptEn(characters, sceneReferences);
}

function buildPromptZh(characters?: Character[], sceneReferences?: SceneReference[]): string {
  let charSection = "";
  if (characters && characters.length > 0) {
    charSection =
      "\n已有角色（如内容涉及这些角色，请使用对应 ID）：\n" +
      characters
        .map((c) => `- ${c.name}（ID: ${c.id}）：${c.description || "无描述"}`)
        .join("\n") +
      "\n";
  }

  let sceneSection = "";
  if (sceneReferences && sceneReferences.length > 0) {
    sceneSection =
      "\n已有场景参考（请在分镜中使用这些场景，保持 sceneDesc 与场景名称一致）：\n" +
      sceneReferences
        .map((s) => `- ${s.name}：${s.description}`)
        .join("\n") +
      "\n";
  }

  return `你是一位专业的短视频分镜策划师。用户会给你一个主题或想法，你需要：
1. 将其拆分为 4-8 个分镜镜头
2. 如果内容中有人物角色，提取角色信息
${charSection}${sceneSection}
严格按以下 JSON 格式返回，不要包含任何其他文字：
{
  "characters": [
    {
      "name": "角色名",
      "description": "角色简介（性格、身份）",
      "appearancePrompt": "外貌描述（英文，用于 AI 绘图，包含年龄、体型、发型、服饰等）"
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
- characters 数组：仅当内容中有人物角色时才填写，纯风景/产品/抽象内容返回空数组 []
- 如有已有角色，复用其 ID（不要重复创建）；如是新角色，生成新的 ID
- visualPrompt 和 motionPrompt 必须用英文（直接用于 AI API）
- 如有角色出场，visualPrompt 必须包含角色完整外貌描述
- 中文子字段给用户在界面上看，用中文填写
- dialogues：characterId 为 null 表示旁白
- 每镜头 duration 为 3、5 或 8 秒
- 总镜头数 4-8 个，节奏有起承转合

⚠️ 内容安全要求：
- 用 "young man/young woman/teenager" 代替 "boy/girl/child"
- 不要暴力、血腥、裸露等敏感内容
- 不要真人政治人物、名人肖像
- 服饰描述得体，适合全年龄段`;
}

function buildPromptEn(characters?: Character[], sceneReferences?: SceneReference[]): string {
  let charSection = "";
  if (characters && characters.length > 0) {
    charSection =
      "\nExisting characters (use corresponding IDs if content involves them):\n" +
      characters
        .map((c) => `- ${c.name} (ID: ${c.id}): ${c.description || "No description"}`)
        .join("\n") +
      "\n";
  }

  let sceneSection = "";
  if (sceneReferences && sceneReferences.length > 0) {
    sceneSection =
      "\nAvailable scene references (use these scenes, keep sceneDesc consistent with scene names):\n" +
      sceneReferences
        .map((s) => `- ${s.name}: ${s.description}`)
        .join("\n") +
      "\n";
  }

  return `You are a professional short-video storyboard planner. The user will give you a topic or idea. You need to:
1. Break it into 4-8 shot scenes
2. If the content involves characters, extract character info
${charSection}${sceneSection}
Return strictly in this JSON format, no other text:
{
  "characters": [
    {
      "name": "Character name",
      "description": "Brief description (personality, role)",
      "appearancePrompt": "Appearance description in English (age, build, hair, clothing, etc. for AI image generation)"
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
- characters array: ONLY fill if content has characters. For landscape/product/abstract content, return empty array []
- Reuse existing character IDs if applicable; generate new IDs for new characters
- visualPrompt and motionPrompt MUST be in English (sent directly to AI APIs)
- If characters appear, visualPrompt MUST include their full appearance
- Sub-fields (subjectDesc etc.) are shown to users in their language
- dialogues: characterId null = narrator
- Each shot duration: 3, 5, or 8 seconds
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
  const systemPrompt = buildSystemPrompt(opts.language, opts.characters, opts.sceneReferences);

  const url = `${opts.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_SCRIPT_RETRIES; attempt++) {
    const resp = await fetchWithRetry(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model: MODELS.text,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: opts.prompt },
        ],
        temperature: 0.7,
        max_tokens: 3000,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`Script API error ${resp.status}: ${body}`);
    }

    const contentType = resp.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      const body = await resp.text().catch(() => "");
      throw new Error(
        `Script API 返回了非 JSON 响应 (Content-Type: ${contentType})。请检查 Base URL 是否正确。响应前 200 字符：${body.slice(0, 200)}`,
      );
    }

    const json = await resp.json();
    const content: string = json.choices?.[0]?.message?.content ?? "";

    const jsonStr = extractJsonFromResponse(content);
    if (!jsonStr) {
      lastError = new Error(
        `无法从模型响应中提取 JSON（第 ${attempt + 1} 次尝试）。响应内容：${content.slice(0, 200)}`,
      );
      if (attempt < MAX_SCRIPT_RETRIES) continue;
      throw lastError;
    }

    try {
      const parsed = JSON.parse(jsonStr) as {
        shots: RawShot[];
        characters?: RawCharacter[];
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
        duration: [3, 5, 8].includes(s.duration) ? s.duration : 5,
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

      // Update activeCharacterIds in shots to reference existing characters by name match
      // (AI may generate new IDs that don't match existing store IDs)
      if (opts.characters && opts.characters.length > 0 && extractedCharacters.length > 0) {
        const nameToId = new Map(
          opts.characters.map((c) => [c.name.toLowerCase(), c.id]),
        );
        for (const shot of shots) {
          shot.activeCharacterIds = shot.activeCharacterIds.map((refId) => {
            // If this ID matches an existing character, keep it
            if (opts.characters!.some((c) => c.id === refId)) return refId;
            // Otherwise try to match by name (the AI may have used name as ID)
            return nameToId.get(refId.toLowerCase()) ?? refId;
          });
        }
      }

      return { shots, characters: extractedCharacters };
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
