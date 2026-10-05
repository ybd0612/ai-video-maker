// ────────────────────────────────────────────────────────────────────────────
// src/lib/apiError.ts
// HTTP 错误响应体的用户可见摘要（2026-10-03 审计 P2-6）。
// 独立成 lib：openai provider 与 videoService 共用，避免 services 间循环 import。
// ────────────────────────────────────────────────────────────────────────────

/** 摘要长度上限：够读完一条供应商错误信息，不至于灌满错误横幅。 */
const MAX_DETAIL_LEN = 200;

/**
 * 把 HTTP 错误响应体收敛成用户可见的一句摘要。
 * 原始响应体可能上百行、含请求回显（提示词、base64 参考图）甚至供应商内部字段，
 * 直接拼进错误文案会把无关内容整段灌进错误横幅/日志。
 * 优先提取 JSON 的 error.message（OpenAI 兼容格式的常规位置），
 * 提取不到就退化为截断纯文本；统一限长 200 字符。
 */
export function summarizeApiError(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "（空响应体）";
  try {
    const json = JSON.parse(trimmed) as {
      error?: { message?: unknown };
      message?: unknown;
      code?: unknown;
    };
    const msg =
      (typeof json.error?.message === "string" && json.error.message) ||
      (typeof json.message === "string" && json.message) ||
      (typeof json.code === "string" && json.code) ||
      "";
    if (msg) return msg.slice(0, MAX_DETAIL_LEN);
  } catch {
    /* 非 JSON：走纯文本截断 */
  }
  return trimmed.slice(0, MAX_DETAIL_LEN);
}
