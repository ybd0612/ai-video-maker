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

/** Return the generated English image prompt used by the image API. */
export function composeVisualPrompt(shot: Shot): string {
  return nonEmpty(shot.visualPrompt) ?? "";
}

/** Return the generated English motion prompt used by the video API. */
export function composeMotionPrompt(shot: Shot): string {
  return nonEmpty(shot.motionPrompt) ?? "";
}
