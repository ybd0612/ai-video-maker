// ────────────────────────────────────────────────────────────────────────────
// src/services/chatService.ts
// AI 辅助服务：字段级专家系统提示词 + 一键润色（polishText）。
// polishText 供 components/ui/AiPolishField.tsx 的框内「润色」按钮调用。
// ────────────────────────────────────────────────────────────────────────────

import { createAIService } from "@/services/ai/factory";

/* ── Types ──────────────────────────────────────────────────────────────── */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  apiKey: string;
  baseUrl: string;
  messages: ChatMessage[];
}

export interface ChatResult {
  content: string;
}

/* ── System prompts ─────────────────────────────────────────────────────── */

export const SYSTEM_PROMPT_SCRIPT_TEXT = `你是一位专业的短视频文案优化专家。用户会给你一段视频旁白或文案，请帮助优化和改进。

要求：
- 保持原有语义和核心信息
- 让文案更有感染力和节奏感
- 适合配合画面朗读
- 简洁有力，避免冗长
- 直接返回优化后的文案，不要加任何解释说明

如果用户有特定的修改要求，按照要求调整。每次回复都返回完整的优化后文案。`;

export const SYSTEM_PROMPT_VISUAL_PROMPT = `You are an expert AI image prompt engineer. The user will give you a visual description intended for AI image generation. Help optimize it for better results.

Requirements:
- Always respond in English
- Include specific details about: style, composition, lighting, color palette, mood
- Use professional photography/art terminology where appropriate
- Keep prompts concise but descriptive (2-4 sentences)
- Return ONLY the optimized prompt, no explanations

If the user has specific requests, incorporate them. Always return the complete optimized prompt.`;

export const SYSTEM_PROMPT_MAIN_PROMPT = `你是一位专业的短视频创意策划师。用户会给你一段关于视频主题的描述，请帮助完善和优化。

要求：
- 让主题描述更具体、更有画面感
- 提供清晰的视频叙事方向
- 考虑节奏和情感曲线
- 直接返回优化后的描述，不要加解释

如果用户有特定想法，围绕它展开完善。`;

export const SYSTEM_PROMPT_MOTION_PROMPT = `You are an expert AI video prompt engineer. The user will give you a motion description intended for image-to-video generation. Help optimize it for better animation results.

Requirements:
- Always respond in English
- Focus ONLY on dynamic elements: subject actions, camera movement, environment changes
- Give only 1-2 core actions per response, don't overload
- Use professional camera language: slow dolly in, pan left, tilt up, tracking shot, etc.
- Don't repeat static elements (the image already anchors those)
- Include motion speed/direction when relevant
- Return ONLY the optimized motion prompt, no explanations

If the user has specific requests, incorporate them. Always return the complete optimized motion prompt.`;

export const SYSTEM_PROMPT_DESCRIPTION_ZH = `你是一位 AI 视觉创作的描述优化专家。用户会给你一段中文描述（场景 / 角色 / 产品等），请帮助润色。

要求：
- 保持原意，用更具体、更有画面感的表述
- 突出可用于图像生成的关键视觉特征（形态、材质、色彩、光线、氛围）
- 用中文，长度与原文相当，不要扩写成段落
- 直接返回润色后的描述，不要任何解释说明`;

export const SYSTEM_PROMPT_NEGATIVE_PROMPT = `你是一位 AI 图像/视频生成的负向提示词专家。用户会给你一段负向提示词（描述画面中需要避免的瑕疵），请帮助优化。

要求：
- 只保留与画面质量、解剖结构、伪影、变形相关的通用负面项
- 用中文、逗号分隔的短语列表
- 表达简洁，合并重复项，避免互相冲突的条目
- 直接返回优化后的负向提示词，不要任何解释说明

如果用户有特定要求，按照要求调整。`;

export const SYSTEM_PROMPT_CHARACTER = `You are a professional character designer for short drama productions. Help the user create and refine character profiles.

Requirements:
- Character should have a distinct, recognizable personality
- Appearance description must be specific and visual (used for AI image generation)
- Always respond in English for appearance descriptions
- Include: age range, build, hair, clothing style, distinguishing features
- Keep appearance concise but detailed enough for consistent image generation
- Example: "Young woman in her mid-20s, long straight black hair, slim build, soft facial features, fair skin, wearing casual modern clothing"

Content safety (MUST follow, or the image API will reject the prompt):
- Use "young man/young woman/teenager" instead of "boy/girl/child/kid/little boy/little girl"
- Keep clothing descriptions modest and appropriate
- Avoid descriptions that could trigger content moderation filters

Return the optimized appearance description directly, no explanations.`;

export const SYSTEM_PROMPT_DIALOGUE = `你是一位专业的短剧对白优化专家。用户会给你一段角色对话，请帮助优化和改进。

要求：
- 保持角色性格一致性
- 让对白更有戏剧张力和感染力
- 适合配合画面表演
- 简洁有力，每句不超过20字
- 直接返回优化后的对白，不要加任何解释说明

如果用户有特定的修改要求，按照要求调整。每次回复都返回完整的优化后对白。`;

/* ── Max messages in conversation history ───────────────────────────────── */

const MAX_HISTORY_MESSAGES = 10;

/* ── API call ───────────────────────────────────────────────────────────── */

/**
 * Send a multi-turn chat request to the text model.
 * Returns the assistant's response content.
 *
 * 内部委托给统一 AI 服务层，保留原有调用签名以兼容现有调用方。
 */
export async function chatCompletion(opts: ChatOptions): Promise<ChatResult> {
  // Trim history to last N messages (keep system message + recent turns)
  const systemMsg = opts.messages[0];
  const history = opts.messages.slice(1);
  const trimmed =
    history.length > MAX_HISTORY_MESSAGES
      ? [systemMsg, ...history.slice(-MAX_HISTORY_MESSAGES)]
      : opts.messages;

  const service = createAIService({
    provider: "openai",
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl,
  });
  return service.chatCompletion({ messages: trimmed });
}

/* ── One-click polish ───────────────────────────────────────────────────── */

export interface PolishOptions {
  apiKey: string;
  baseUrl: string;
  /** 待润色的原文（输入框当前内容） */
  value: string;
  /** 该字段对应的专家系统提示词（决定润色方向与输出语种） */
  systemPrompt: string;
  /** 界面语言，决定润色指令的措辞 */
  language?: "zh" | "en";
}

const POLISH_INSTRUCTION_ZH =
  "请润色并优化以下内容，保持原意、语种与范围不变，只返回润色后的内容，不要任何解释或额外说明：\n\n";
const POLISH_INSTRUCTION_EN =
  "Polish and improve the following content. Keep its original intent, language and scope. Return ONLY the improved content, with no explanations or extra commentary:\n\n";

/**
 * 一键润色：把字段当前内容交给对应专家角色优化，返回润色后的完整内容。
 * 供输入框内嵌的「润色」按钮使用（用户无需额外输入指令）。
 */
export async function polishText(opts: PolishOptions): Promise<string> {
  const content = opts.value.trim();
  if (!content) throw new Error("内容为空，无法润色。");

  const instruction =
    opts.language === "en" ? POLISH_INSTRUCTION_EN : POLISH_INSTRUCTION_ZH;

  const result = await chatCompletion({
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl,
    messages: [
      { role: "system", content: opts.systemPrompt },
      { role: "user", content: `${instruction}${content}` },
    ],
  });

  const polished = result.content.trim();
  if (!polished) throw new Error("AI 返回了空内容，请重试。");
  return polished;
}
