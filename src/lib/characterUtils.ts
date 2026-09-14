// ────────────────────────────────────────────────────────────────────────────
// src/lib/characterUtils.ts
// Utilities for injecting explicitly selected asset descriptions into prompts.
// ────────────────────────────────────────────────────────────────────────────

import type { Asset, Shot } from "@/stores/projectStore";

/**
 * Inject active characters' appearance descriptions into a visual prompt.
 * Kept as a small compatibility helper for callers that only have character IDs.
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

function assetDescription(asset: Asset): string {
  return (
    asset.appearancePrompt?.trim() ||
    asset.prompt.trim() ||
    asset.description.trim()
  );
}

function selectedAsset(
  assets: Asset[],
  id: string | undefined,
  type: Asset["type"],
): Asset | undefined {
  if (!id) return undefined;
  return assets.find((asset) => asset.id === id && asset.type === type);
}

function selectedAssets(
  assets: Asset[],
  ids: string[] | undefined,
  type: Asset["type"],
): Asset[] {
  return (ids ?? [])
    .map((id) => assets.find((asset) => asset.id === id && asset.type === type))
    .filter((asset): asset is Asset => !!asset);
}

/**
 * Inject the shot's explicit scene/product/prop selections and character
 * appearance anchors. This is the single prompt context used by image calls;
 * no global "first product" fallback is allowed.
 */
export function injectShotAssetDescriptions(
  visualPrompt: string,
  shot: Pick<Shot, "activeCharacterIds" | "activeSceneId" | "activeProductIds" | "activePropIds">,
  assets: Asset[],
): string {
  const parts: string[] = [];
  const scene = selectedAsset(assets, shot.activeSceneId, "scene");
  if (scene) {
    const description = assetDescription(scene);
    if (description) parts.push(`Scene reference (${scene.name}): ${description}`);
  }

  for (const character of selectedAssets(assets, shot.activeCharacterIds, "character")) {
    const description = assetDescription(character);
    if (description) parts.push(`Character reference (${character.name}): ${description}`);
  }
  for (const product of selectedAssets(assets, shot.activeProductIds, "product")) {
    const description = assetDescription(product);
    if (description) parts.push(`Product reference (${product.name}): ${description}`);
  }
  for (const prop of selectedAssets(assets, shot.activePropIds, "prop")) {
    const description = assetDescription(prop);
    if (description) parts.push(`Prop reference (${prop.name}): ${description}`);
  }

  const prompt = visualPrompt.trim();
  if (!parts.length) return prompt;
  return `${parts.join(". ")}${prompt ? `. ${prompt}` : ""}`;
}
