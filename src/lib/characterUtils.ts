// ────────────────────────────────────────────────────────────────────────────
// src/lib/characterUtils.ts
// Utilities for character description injection and dialogue-to-text conversion.
// ────────────────────────────────────────────────────────────────────────────

import type { Character, DialogueLine } from "@/stores/projectStore";

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

/**
 * Convert a dialogue sequence into a scriptText string.
 * Used in drama mode to auto-generate scriptText from dialogues.
 */
export function dialoguesToScriptText(
  dialogues: DialogueLine[],
  characters: Character[],
): string {
  return dialogues
    .map((d) => {
      if (!d.text.trim()) return "";
      if (d.characterId === null) {
        return d.text; // narrator
      }
      const char = characters.find((c) => c.id === d.characterId);
      const name = char?.name ?? "Unknown";
      return `${name}: ${d.text}`;
    })
    .filter(Boolean)
    .join("\n");
}
