// ────────────────────────────────────────────────────────────────────────────
// src/lib/characterUtils.ts
// Utilities for character description injection.
// ────────────────────────────────────────────────────────────────────────────

import type { Asset } from "@/stores/projectStore";

/**
 * Inject active characters' appearance descriptions into a visual prompt.
 * Prepends character appearance prompts to the shot's visualPrompt.
 */
export function injectCharacterDescriptions(
  visualPrompt: string,
  activeCharacterIds: string[],
  assets: Asset[],
): string {
  if (!activeCharacterIds?.length || !assets.length) {
    return visualPrompt;
  }

  const activeChars = activeCharacterIds
    .map((id) => assets.find((a) => a.id === id && a.type === "character"))
    .filter(
      (c): c is Asset => c != null && !!c.appearancePrompt?.trim(),
    );

  if (activeChars.length === 0) return visualPrompt;

  const charDescs = activeChars.map((c) => c.appearancePrompt!.trim()).join("; ");
  return `${charDescs}. ${visualPrompt}`;
}
