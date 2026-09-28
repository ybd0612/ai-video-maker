// ────────────────────────────────────────────────────────────────────────────
// src/lib/promptUtils.ts
// Compose prompts for API calls. visualPrompt/motionPrompt are the API SSOT;
// structured sub-fields are an editable breakdown, not a second prompt source.
// ────────────────────────────────────────────────────────────────────────────

import type { Shot } from "@/stores/projectStore";

export { generateAssetNamespace, generateFullPrompt } from "./assetNamespace";

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

/** Return the Chinese image prompt used by the image API. */
export function composeVisualPrompt(shot: Shot): string {
  return nonEmpty(shot.visualPrompt) ?? "";
}

/** 止态结尾句的连接语：只标注结构，止态内容一律由分镜模型产出（代码不判断、不补写） */
const END_STATE_PREFIX = "结束时画面：";

/**
 * Return the Chinese motion prompt used by the video API.
 * 分镜声明了止态时把它拼为结尾句（双帧方案 E）—— 文本约束取代额外的止幅图。
 */
export function composeMotionPrompt(shot: Shot): string {
  const base = nonEmpty(shot.motionPrompt) ?? "";
  const endState = nonEmpty(shot.endStateDesc);
  if (!endState) return base;
  const sentence = `${END_STATE_PREFIX}${endState}`;
  return base ? `${base}。${sentence}` : sentence;
}
