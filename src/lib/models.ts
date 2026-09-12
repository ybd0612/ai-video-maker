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
 * 文本模型输出预算：统一给到模型最大输出（Agnes 3.0 Flash = 65,536）。
 * 项目方针：效果优先，不为节约 token 精打细算——调用方一律不设小预算，
 * 避免输出触顶截断（JSON 断裂/内容缺失）。若需覆盖，调用方显式传 maxTokens。
 */
export const MAX_OUTPUT_TOKENS = 65536;
