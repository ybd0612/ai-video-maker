// ────────────────────────────────────────────────────────────────────────────
// src/services/scriptService.ts
// Generates structured shots from a user prompt using the text model.
// ────────────────────────────────────────────────────────────────────────────

import type { Shot, ProjectMode, Character } from "@/stores/projectStore";
import { MODELS } from "@/lib/models";

interface GenerateScriptOptions {
  apiKey: string;
  baseUrl: string;
  prompt: string;
  language: "zh" | "en";
  aspectRatio: string;
  mode?: ProjectMode;
  characters?: Character[];
}

interface RawShot {
  scriptText: string;
  visualPrompt: string;
  motionPrompt: string;
  duration: number;
  dialogues?: Array<{ characterId: string | null; text: string; delivery?: string }>;
  activeCharacterIds?: string[];
}

/**
 * Extract JSON object from a model response that may contain markdown fences,
 * preamble text, or trailing commentary.
 */
function extractJsonFromResponse(content: string): string | null {
  // 1. Try markdown code block first (```json ... ``` or ``` ... ```)
  const fenced = content.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenced) {
    const inner = fenced[1].trim();
    if (inner.startsWith("{")) return inner;
  }

  // 2. Try to find the outermost { ... } that contains "shots"
  // Use brace-counting to avoid greedy over-match
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

  // 3. Fallback: last resort greedy match
  const fallback = content.match(/\{[\s\S]*\}/);
  return fallback ? fallback[0] : null;
}

const MAX_SCRIPT_RETRIES = 2;

/* ── System prompt builders ────────────────────────────────────────────── */

function buildSystemPrompt(
  language: "zh" | "en",
  isDrama: boolean,
  characters?: Character[],
): string {
  if (isDrama) {
    return language === "zh"
      ? buildDramaPromptZh(characters)
      : buildDramaPromptEn(characters);
  }
  return language === "zh" ? SIMPLE_PROMPT_ZH : SIMPLE_PROMPT_EN;
}

const SIMPLE_PROMPT_ZH = `你是一位专业的短视频分镜策划师。用户会给你一个主题或想法，你需要将其拆分为 4-6 个分镜镜头。

严格按以下 JSON 格式返回，不要包含任何其他文字：
{
  "shots": [
    {
      "scriptText": "该镜头的旁白/文案（中文，简短有力）",
      "visualPrompt": "文生图提示词（英文，静态画面描述：主体+场景背景+光影色调+艺术风格，详细具体）",
      "motionPrompt": "图生视频提示词（英文，动态描述：主体动作+镜头运镜+环境变化，1-2个核心动作即可）",
      "duration": 5
    }
  ]
}

visualPrompt（文生图）要求：
- 必须用英文，短语用逗号分隔
- 包含：主体描述、场景/背景、光影/色调、艺术风格
- 主体姿态要自然稳定，避免动作幅度过大的姿势
- 尽量用中景或特写构图
- 示例：A young woman with long dark hair, standing in a sunlit cafe, warm golden hour light, soft bokeh background, photorealistic, cinematic composition, 8k

motionPrompt（图生视频）要求：
- 必须用英文
- 只描述动态元素：主体动作、镜头运镜、环境变化
- 每个镜头只给 1-2 个核心动作，不要贪多
- 使用专业镜头语言：slow dolly in, pan left, tilt up, close-up tracking shot 等
- 不要重复描述静态元素（衣服颜色、发型等，图片已经锚定了）
- 示例：The woman slowly turns her head and smiles gently, camera slowly dollies in, steam rising from the coffee cup, soft natural lighting shifts

其他要求：
- 每个镜头 duration 为 3、5 或 8 秒
- scriptText 用用户相同的语言
- 整体节奏要有起承转合
- 总镜头数 4-6 个`;

const SIMPLE_PROMPT_EN = `You are a professional short-video storyboard planner. The user will give you a topic or idea. Break it into 4-6 shot scenes.

Return strictly in this JSON format, no other text:
{
  "shots": [
    {
      "scriptText": "Narration/copy for this shot (short, punchy)",
      "visualPrompt": "Text-to-image prompt (English, static scene: subject + background + lighting + art style, detailed)",
      "motionPrompt": "Image-to-video prompt (English, dynamic: subject action + camera movement + environment change, 1-2 core actions)",
      "duration": 5
    }
  ]
}

visualPrompt (Text-to-Image) requirements:
- Must be in English, comma-separated phrases
- Include: subject description, scene/background, lighting/color palette, art style
- Keep subject pose natural and stable, avoid extreme action poses
- Prefer medium shot or close-up composition
- Example: A young woman with long dark hair, standing in a sunlit cafe, warm golden hour light, soft bokeh background, photorealistic, cinematic composition, 8k

motionPrompt (Image-to-Video) requirements:
- Must be in English
- Only describe dynamic elements: subject action, camera movement, environment changes
- Give only 1-2 core actions per shot, don't overload
- Use professional camera language: slow dolly in, pan left, tilt up, close-up tracking shot, etc.
- Don't repeat static elements (clothing color, hairstyle — the image already anchors those)
- Example: The woman slowly turns her head and smiles gently, camera slowly dollies in, steam rising from the coffee cup, soft natural lighting shifts

Other requirements:
- Each shot duration: 3, 5, or 8 seconds
- scriptText in the user's language
- Overall pacing: setup, development, climax, resolution
- 4-6 shots total`;

function buildDramaPromptZh(characters?: Character[]): string {
  let charSection = "";
  if (characters && characters.length > 0) {
    charSection =
      "\n可用角色：\n" +
      characters
        .map((c) => `- ${c.name}（ID: ${c.id}）：${c.description || "无描述"}`)
        .join("\n") +
      "\n";
  }

  return `你是一位专业的短剧编剧。用户会给你一个主题或想法，你需要将其拆分为 4-8 个分镜，并为每个分镜编写对话和画面描述。
${charSection}
严格按以下 JSON 格式返回，不要包含任何其他文字：
{
  "shots": [
    {
      "activeCharacterIds": ["char_xxx"],
      "dialogues": [
        { "characterId": null, "text": "旁白文本", "delivery": "平静" },
        { "characterId": "char_xxx", "text": "角色台词", "delivery": "温柔地" }
      ],
      "scriptText": "该镜头旁白摘要（简短有力）",
      "visualPrompt": "文生图提示词（英文，必须包含出场角色的完整外貌描述，与角色设定一致）",
      "motionPrompt": "图生视频提示词（英文，动态描述）",
      "duration": 5
    }
  ]
}

visualPrompt 要求：
- 必须用英文，短语用逗号分隔
- 必须包含出场角色的完整外貌描述（与角色设定保持一致）
- 包含：主体描述、场景/背景、光影/色调、艺术风格
- 主体姿态要自然稳定
- 示例：A young woman with long black hair wearing a white blouse, slim build, soft features, standing in a sunlit cafe, warm golden hour light, photorealistic, 8k

motionPrompt 要求：
- 必须用英文
- 只描述动态元素：主体动作、镜头运镜、环境变化
- 每个镜头只给 1-2 个核心动作
- 使用专业镜头语言

对话要求：
- characterId 为 null 表示旁白，否则使用角色 ID
- delivery 描述语气/情绪
- 每镜头 1-3 句对话，简洁有力

其他要求：
- 每个镜头 duration 为 3、5 或 8 秒
- scriptText 用用户相同的语言
- 整体节奏要有起承转合
- 总镜头数 4-8 个`;
}

function buildDramaPromptEn(characters?: Character[]): string {
  let charSection = "";
  if (characters && characters.length > 0) {
    charSection =
      "\nAvailable characters:\n" +
      characters
        .map((c) => `- ${c.name} (ID: ${c.id}): ${c.description || "No description"}`)
        .join("\n") +
      "\n";
  }

  return `You are a professional short drama screenwriter. The user will give you a topic or idea. Break it into 4-8 shot scenes with dialogue and visual descriptions.
${charSection}
Return strictly in this JSON format, no other text:
{
  "shots": [
    {
      "activeCharacterIds": ["char_xxx"],
      "dialogues": [
        { "characterId": null, "text": "Narrator text", "delivery": "calm" },
        { "characterId": "char_xxx", "text": "Character dialogue", "delivery": "gently" }
      ],
      "scriptText": "Shot narration summary (short, punchy)",
      "visualPrompt": "Text-to-image prompt (English, must include active characters' full appearance matching character definitions)",
      "motionPrompt": "Image-to-video prompt (English, dynamic description)",
      "duration": 5
    }
  ]
}

visualPrompt requirements:
- Must be in English, comma-separated phrases
- Must include full appearance descriptions of active characters (consistent with character definitions)
- Include: subject, scene/background, lighting/color, art style
- Keep poses natural and stable

motionPrompt requirements:
- Must be in English
- Only describe dynamic elements: subject action, camera movement, environment changes
- 1-2 core actions per shot
- Use professional camera language

Dialogue requirements:
- characterId null = narrator, otherwise use character ID
- delivery describes tone/emotion
- 1-3 lines per shot, concise and impactful

Other requirements:
- Each shot duration: 3, 5, or 8 seconds
- scriptText in the user's language
- Overall pacing: setup, development, climax, resolution
- 4-8 shots total`;
}

/**
 * Call the text model to generate a structured shot list from a user prompt.
 * Returns an array of shots (without id/index/status — those are added by the store).
 */
export async function generateScript(
  opts: GenerateScriptOptions,
): Promise<Omit<Shot, "id" | "index" | "status">[]> {
  // Build system prompt based on mode
  const isDrama = opts.mode === "drama";
  const systemPrompt = buildSystemPrompt(opts.language, isDrama, opts.characters);

  const url = `${opts.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_SCRIPT_RETRIES; attempt++) {
    const resp = await fetch(url, {
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
        max_tokens: 2048,
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
      const parsed = JSON.parse(jsonStr) as { shots: RawShot[] };
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
        duration: [3, 5, 8].includes(s.duration) ? s.duration : 5,
      }));

      // Validate: every shot must have non-empty visualPrompt and motionPrompt
      // If empty, generate fallbacks from scriptText
      for (const shot of shots) {
        if (!shot.visualPrompt.trim() && shot.scriptText.trim()) {
          shot.visualPrompt = `Cinematic shot: ${shot.scriptText.trim()}, professional lighting, high quality, detailed composition, photorealistic, 8k`;
        }
        if (!shot.motionPrompt.trim() && shot.scriptText.trim()) {
          shot.motionPrompt = `Slow cinematic camera movement, gentle ambient motion, subtle environmental changes, natural physics`;
        }
      }

      // If any shot still has empty prompts, reject and retry
      const hasEmpty = shots.some((s) => !s.visualPrompt.trim() || !s.motionPrompt.trim());
      if (hasEmpty && attempt < MAX_SCRIPT_RETRIES) {
        lastError = new Error("部分分镜缺少提示词，自动重试...");
        continue;
      }

      return shots;
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
