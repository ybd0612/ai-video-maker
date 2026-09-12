// ────────────────────────────────────────────────────────────────────────────
// src/lib/models.ts
// Centralized AI model identifiers. Update here to change across all services.
// ────────────────────────────────────────────────────────────────────────────

export const MODELS = {
  text: "agnes-3.0-flash",
  image: "agnes-image-2.5-flash",
  video: "agnes-video-2.5-flash",
} as const;

/**
 * 文本模型输出预算：固定为模型最大输出（Agnes 3.0 Flash = 65,536）。
 * ⚠️ 必须显式传：实测不传时服务端缺省 max_tokens=4096，长内容会被
 * finish_reason=length 截断。项目方针：效果优先，不做 token 精打细算，
 * 此参数不对外暴露（ChatParams 上没有它）。
 */
export const MAX_OUTPUT_TOKENS = 65536;
