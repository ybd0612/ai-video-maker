// ────────────────────────────────────────────────────────────────────────────
// src/lib/promptUtils.ts
// Compose prompts for API calls. The generated English prompt remains the
// base, while structured sub-fields are appended as explicit user constraints
// so edits made in the UI reach the actual API request.
// ────────────────────────────────────────────────────────────────────────────

import type { Shot } from "@/stores/projectStore";

export { generateAssetNamespace, generateFullPrompt } from "./assetNamespace";

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

/**
 * Return the final visual prompt for API calls.
 * The model's full English prompt is preserved, and any edited structured
 * fields are appended with labels instead of being silently ignored.
 */
export function composeVisualPrompt(shot: Shot): string {
  const base = nonEmpty(shot.visualPrompt);
  const structured = [
    nonEmpty(shot.subjectDesc) ? `Subject: ${shot.subjectDesc!.trim()}` : undefined,
    nonEmpty(shot.sceneDesc) ? `Scene / background: ${shot.sceneDesc!.trim()}` : undefined,
    nonEmpty(shot.detailDesc) ? `Details: ${shot.detailDesc!.trim()}` : undefined,
    nonEmpty(shot.lightingDesc) ? `Lighting / color: ${shot.lightingDesc!.trim()}` : undefined,
    nonEmpty(shot.styleDesc) ? `Art style: ${shot.styleDesc!.trim()}` : undefined,
    nonEmpty(shot.negativePrompt) ? `Avoid: ${shot.negativePrompt!.trim()}` : undefined,
  ].filter((part): part is string => !!part);

  if (base && structured.length > 0) return `${base}. User constraints: ${structured.join("; ")}`;
  if (base) return base;
  return structured.join("; ");
}

/**
 * Return the final motion prompt for API calls.
 * The generated English prompt is retained, with edited motion fields appended
 * as explicit constraints. Negative motion input is included as an avoid list.
 */
export function composeMotionPrompt(shot: Shot): string {
  const base = nonEmpty(shot.motionPrompt);
  const structured = [
    nonEmpty(shot.actionDesc) ? `Action: ${shot.actionDesc!.trim()}` : undefined,
    nonEmpty(shot.cameraDesc) ? `Camera: ${shot.cameraDesc!.trim()}` : undefined,
    nonEmpty(shot.envChangeDesc) ? `Environment changes: ${shot.envChangeDesc!.trim()}` : undefined,
    nonEmpty(shot.motionSpeedDesc) ? `Motion speed: ${shot.motionSpeedDesc!.trim()}` : undefined,
    nonEmpty(shot.negativeMotionPrompt) ? `Avoid: ${shot.negativeMotionPrompt!.trim()}` : undefined,
  ].filter((part): part is string => !!part);

  if (base && structured.length > 0) return `${base}. User motion constraints: ${structured.join("; ")}`;
  if (base) return base;
  return structured.join("; ");
}
