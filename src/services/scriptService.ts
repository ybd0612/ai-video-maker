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
  // Structured sub-elements for text-to-image
  subjectDesc?: string;
  sceneDesc?: string;
  detailDesc?: string;
  lightingDesc?: string;
  styleDesc?: string;
  negativePrompt?: string;
  // Structured sub-elements for image-to-video
  actionDesc?: string;
  cameraDesc?: string;
  envChangeDesc?: string;
  motionSpeedDesc?: string;
  negativeMotionPrompt?: string;
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
      "subjectDesc": "主体描述（英文，如 A young woman with long dark hair）",
      "sceneDesc": "场景/背景描述（英文，如 sitting in a sunlit cafe by the window）",
      "detailDesc": "细节/服饰描述（英文，如 wearing a white blouse, delicate jewelry）",
      "lightingDesc": "光影/色调（英文，如 warm golden hour light, cinematic rim light）",
      "styleDesc": "艺术风格（英文，如 photorealistic, 8k, ultra-detailed）",
      "negativePrompt": "负向提示词（英文，如 bad anatomy, extra limbs, blurry）",
      "actionDesc": "主体动作（英文，如 slowly turns her head and smiles gently）",
      "cameraDesc": "镜头运镜（英文，如 camera slowly dollies in, close-up tracking shot）",
      "envChangeDesc": "环境变化（英文，如 steam rising from the coffee cup, leaves swaying）",
      "motionSpeedDesc": "运动速率（英文，如 cinematic slow-motion, 24fps）",
      "negativeMotionPrompt": "负向动态提示（英文，如 morphing, flickering, shaky camera）",
      "duration": 5
    }
  ]
}

文生图子字段要求（subjectDesc/sceneDesc/detailDesc/lightingDesc/styleDesc）：
- 必须用英文，逗号分隔短语
- subjectDesc：主体外貌描述，姿态自然稳定，中景或特写
- sceneDesc：场景/背景，有空间层次（前景/中景/远景）
- detailDesc：服饰、道具、细节
- lightingDesc：光线类型、色调氛围
- styleDesc：艺术风格、渲染质量
- negativePrompt：不希望出现的元素

图生视频子字段要求（actionDesc/cameraDesc/envChangeDesc/motionSpeedDesc）：
- 必须用英文
- actionDesc：主体动作，只给 1-2 个核心动作
- cameraDesc：使用专业镜头语言（dolly, pan, tilt, tracking shot）
- envChangeDesc：环境动态变化（烟雾、光影变化、物体运动）
- motionSpeedDesc：运动速率和帧率
- negativeMotionPrompt：不希望出现的动态效果（变形、闪烁、抖动）

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
      "subjectDesc": "Subject description (English, e.g. A young woman with long dark hair)",
      "sceneDesc": "Scene/background (English, e.g. sitting in a sunlit cafe by the window)",
      "detailDesc": "Details/clothing (English, e.g. wearing a white blouse, delicate jewelry)",
      "lightingDesc": "Lighting/color (English, e.g. warm golden hour light, cinematic rim light)",
      "styleDesc": "Art style (English, e.g. photorealistic, 8k, ultra-detailed)",
      "negativePrompt": "Negative prompt (English, e.g. bad anatomy, extra limbs, blurry)",
      "actionDesc": "Subject action (English, e.g. slowly turns her head and smiles gently)",
      "cameraDesc": "Camera movement (English, e.g. camera slowly dollies in, close-up tracking shot)",
      "envChangeDesc": "Environment changes (English, e.g. steam rising from the coffee cup)",
      "motionSpeedDesc": "Motion speed (English, e.g. cinematic slow-motion, 24fps)",
      "negativeMotionPrompt": "Negative motion (English, e.g. morphing, flickering, shaky camera)",
      "duration": 5
    }
  ]
}

Text-to-image sub-fields (subjectDesc/sceneDesc/detailDesc/lightingDesc/styleDesc):
- Must be in English, comma-separated phrases
- subjectDesc: subject appearance, natural stable pose, medium shot or close-up
- sceneDesc: scene/background with spatial layers (foreground/midground/background)
- detailDesc: clothing, props, details
- lightingDesc: lighting type, color mood
- styleDesc: art style, render quality
- negativePrompt: unwanted elements

Image-to-video sub-fields (actionDesc/cameraDesc/envChangeDesc/motionSpeedDesc):
- Must be in English
- actionDesc: 1-2 core actions only
- cameraDesc: professional camera language (dolly, pan, tilt, tracking shot)
- envChangeDesc: environmental dynamics (smoke, light shifts, object motion)
- motionSpeedDesc: motion speed and frame rate
- negativeMotionPrompt: unwanted motion effects (morphing, flickering, shaking)

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
        // Map structured sub-elements
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
