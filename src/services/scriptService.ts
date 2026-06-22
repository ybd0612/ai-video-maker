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
      "visualPrompt": "文生图英文提示词（完整的英文描述，用于 AI 绘图 API 调用）",
      "motionPrompt": "图生视频英文提示词（完整的英文动态描述，用于 AI 视频 API 调用）",
      "subjectDesc": "主体描述（中文，如 一位长发黑色长发的年轻女性）",
      "sceneDesc": "场景/背景描述（中文，如 坐在阳光充足的咖啡馆窗边）",
      "detailDesc": "细节/服饰描述（中文，如 穿着白色衬衫，精致首饰）",
      "lightingDesc": "光影/色调（中文，如 温暖的金色夕阳光，电影感轮廓光）",
      "styleDesc": "艺术风格（中文，如 写实风格，8K，超精细）",
      "negativePrompt": "负向提示词（中文，如 解剖异常，多余肢体，模糊）",
      "actionDesc": "主体动作（中文，如 缓缓转头，温柔微笑）",
      "cameraDesc": "镜头运镜（中文，如 镜头缓缓推进，特写跟踪镜头）",
      "envChangeDesc": "环境变化（中文，如 咖啡杯蒸汽上升，窗外树叶摇曳）",
      "motionSpeedDesc": "运动速率（中文，如 电影感慢动作，24fps）",
      "negativeMotionPrompt": "负向动态提示（中文，如 变形，闪烁，抖动）",
      "duration": 5
    }
  ]
}

重要：visualPrompt 和 motionPrompt 必须用英文，它们是直接发送给 AI 绘图/视频 API 的提示词。

visualPrompt 要求（英文）：
- 将上面所有子字段的内容翻译并组合为一段完整的英文提示词
- 用逗号分隔短语，包含主体、场景、细节、光影、风格
- 主体姿态要自然稳定
- 示例：A young woman with long black hair, sitting in a sunlit cafe by the window, wearing a white blouse with delicate jewelry, warm golden hour light with cinematic rim light, photorealistic, 8k, ultra-detailed

motionPrompt 要求（英文）：
- 将动作、运镜、环境变化、速率组合为一段完整的英文提示词
- 使用专业镜头语言（dolly, pan, tilt, tracking shot）
- 示例：slowly turns her head and smiles gently, camera slowly dollies in for a close-up tracking shot, steam rising from the coffee cup and leaves swaying outside the window, cinematic slow-motion at 24fps

中文子字段要求（给用户看的，用中文填写）：
- subjectDesc：主体外貌描述，姿态自然稳定
- sceneDesc：场景/背景，有空间层次
- detailDesc：服饰、道具、细节
- lightingDesc：光线类型、色调氛围
- styleDesc：艺术风格、渲染质量
- actionDesc：主体动作，1-2 个核心动作
- cameraDesc：镜头运镜方式
- envChangeDesc：环境动态变化
- motionSpeedDesc：运动速率和帧率
- negativePrompt / negativeMotionPrompt：不希望出现的元素

其他要求：
- 每个镜头 duration 为 3、5 或 8 秒
- scriptText 用中文
- 整体节奏要有起承转合
- 总镜头数 4-6 个`;

const SIMPLE_PROMPT_EN = `You are a professional short-video storyboard planner. The user will give you a topic or idea. Break it into 4-6 shot scenes.

Return strictly in this JSON format, no other text:
{
  "shots": [
    {
      "scriptText": "Narration/copy for this shot (short, punchy)",
      "visualPrompt": "Text-to-image English prompt (complete English description for AI image API)",
      "motionPrompt": "Image-to-video English prompt (complete English motion description for AI video API)",
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
      "visualPrompt": "文生图英文提示词（完整的英文描述，必须包含出场角色完整外貌）",
      "motionPrompt": "图生视频英文提示词（完整的英文动态描述）",
      "subjectDesc": "主体描述（中文，如 一位长发黑色长发的年轻女性）",
      "sceneDesc": "场景/背景描述（中文，如 坐在阳光充足的咖啡馆窗边）",
      "detailDesc": "细节/服饰描述（中文，如 穿着白色衬衫，精致首饰）",
      "lightingDesc": "光影/色调（中文，如 温暖的金色夕阳光，电影感轮廓光）",
      "styleDesc": "艺术风格（中文，如 写实风格，8K，超精细）",
      "negativePrompt": "负向提示词（中文，如 解剖异常，多余肢体，模糊）",
      "actionDesc": "主体动作（中文，如 缓缓转头，温柔微笑）",
      "cameraDesc": "镜头运镜（中文，如 镜头缓缓推进，特写跟踪镜头）",
      "envChangeDesc": "环境变化（中文，如 咖啡杯蒸汽上升，窗外树叶摇曳）",
      "motionSpeedDesc": "运动速率（中文，如 电影感慢动作，24fps）",
      "negativeMotionPrompt": "负向动态提示（中文，如 变形，闪烁，抖动）",
      "duration": 5
    }
  ]
}

重要：visualPrompt 和 motionPrompt 必须用英文，它们直接用于 AI 绘图/视频 API。
- visualPrompt 必须包含出场角色的完整外貌描述（与角色设定一致）
- motionPrompt 使用专业镜头语言

中文子字段是给用户在界面上看的，用中文填写。

对话要求：
- characterId 为 null 表示旁白，否则使用角色 ID
- delivery 描述语气/情绪
- 每镜头 1-3 句对话，简洁有力

其他要求：
- 每个镜头 duration 为 3、5 或 8 秒
- scriptText 用中文
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
      "visualPrompt": "Text-to-image English prompt (complete English description, must include active characters' full appearance)",
      "motionPrompt": "Image-to-video English prompt (complete English motion description)",
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
- subjectDesc: must include full appearance of active characters matching character definitions
- sceneDesc: scene/background with spatial layers
- detailDesc: clothing, props, details
- lightingDesc: lighting type, color mood
- styleDesc: art style, render quality
- negativePrompt: unwanted elements

Image-to-video sub-fields (actionDesc/cameraDesc/envChangeDesc/motionSpeedDesc):
- Must be in English
- actionDesc: 1-2 core actions only
- cameraDesc: professional camera language (dolly, pan, tilt, tracking shot)
- envChangeDesc: environmental dynamics
- motionSpeedDesc: motion speed and frame rate
- negativeMotionPrompt: unwanted motion effects

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
