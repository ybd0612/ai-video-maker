// ────────────────────────────────────────────────────────────────────────────
// src/lib/promptUtils.ts
// Compose structured prompt sub-elements into full prompts.
// ────────────────────────────────────────────────────────────────────────────

import type { Shot } from "@/stores/projectStore";

/**
 * Compose visualPrompt from structured sub-elements.
 * If sub-elements exist, join them with ". " separator.
 * Falls back to shot.visualPrompt if all sub-elements are empty.
 */
export function composeVisualPrompt(shot: Shot): string {
  const parts = [
    shot.subjectDesc,
    shot.sceneDesc,
    shot.detailDesc,
    shot.lightingDesc,
    shot.styleDesc,
  ]
    .map((s) => s?.trim())
    .filter(Boolean);

  if (parts.length === 0) return shot.visualPrompt;
  return parts.join(". ");
}

/**
 * Compose motionPrompt from structured sub-elements.
 * If sub-elements exist, join them with ". " separator.
 * Falls back to shot.motionPrompt if all sub-elements are empty.
 */
export function composeMotionPrompt(shot: Shot): string {
  const parts = [
    shot.actionDesc,
    shot.cameraDesc,
    shot.envChangeDesc,
    shot.motionSpeedDesc,
  ]
    .map((s) => s?.trim())
    .filter(Boolean);

  if (parts.length === 0) return shot.motionPrompt;
  return parts.join(". ");
}
