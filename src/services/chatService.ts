// ────────────────────────────────────────────────────────────────────────────
// src/services/chatService.ts
// AI 辅助服务：字段级专家系统提示词 + 一键润色（polishText）。
// polishText 供 components/ui/AiPolishField.tsx 的框内「润色」按钮调用。
// ────────────────────────────────────────────────────────────────────────────

import { createAIService } from "@/services/ai/factory";
import { getTranslation } from "@/i18n";

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

/* ── System prompts（已迁移至规则注册表，此处再导出保持既有导入路径不变） ── */

export {
  SYSTEM_PROMPT_SCRIPT_TEXT,
  SYSTEM_PROMPT_VISUAL_PROMPT,
  SYSTEM_PROMPT_MAIN_PROMPT,
  SYSTEM_PROMPT_MOTION_PROMPT,
  SYSTEM_PROMPT_DESCRIPTION_ZH,
  SYSTEM_PROMPT_NEGATIVE_PROMPT,
  SYSTEM_PROMPT_CHARACTER,
  SYSTEM_PROMPT_DIALOGUE,
} from "@/lib/promptRules";

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
  // 非 React 上下文的瞬时错误：经 getTranslation 定格当前语言（可接受）
  if (!content) throw new Error(getTranslation("error.polishEmpty"));

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
  if (!polished) throw new Error(getTranslation("error.polishEmptyResult"));
  return polished;
}
