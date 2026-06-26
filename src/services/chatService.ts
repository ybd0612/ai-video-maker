// ────────────────────────────────────────────────────────────────────────────
// src/services/chatService.ts
// Multi-turn chat API for AI-assisted prompt optimization.
// ────────────────────────────────────────────────────────────────────────────

import { createAIService } from "@/services/ai/factory";
import { useSettingsStore } from "@/stores/settingsStore";

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

/**
 * 简化版聊天接口 — 从 settingsStore 读取 provider 配置。
 * 适用于不需要显式传 apiKey/baseUrl 的场景。
 */
export async function chatCompletionFromSettings(params: {
  messages: ChatMessage[];
}): Promise<ChatResult> {
  const { providerConfig } = useSettingsStore.getState();
  const service = createAIService({
    provider: "openai",
    apiKey: providerConfig.apiKey,
    baseUrl: providerConfig.baseUrl,
  });
  return service.chatCompletion({ messages: params.messages });
}
