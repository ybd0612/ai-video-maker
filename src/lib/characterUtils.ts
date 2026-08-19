// ────────────────────────────────────────────────────────────────────────────
// src/lib/characterUtils.ts
// Utilities for character description injection.
// ────────────────────────────────────────────────────────────────────────────

import type { Character } from "@/stores/projectStore";

/**
 * Inject active characters' appearance descriptions into a visual prompt.
 * Prepends character appearance prompts to the shot's visualPrompt.
 */
export function injectCharacterDescriptions(
  visualPrompt: string,
  activeCharacterIds: string[],
  characters: Character[],
): string {
  if (!activeCharacterIds?.length || !characters.length) {
    return visualPrompt;
  }

  const activeChars = activeCharacterIds
    .map((id) => characters.find((c) => c.id === id))
    .filter(
      (c): c is Character => c != null && !!c.appearancePrompt.trim(),
    );

  if (activeChars.length === 0) return visualPrompt;

  const charDescs = activeChars.map((c) => c.appearancePrompt.trim()).join("; ");
  return `${charDescs}. ${visualPrompt}`;
}
