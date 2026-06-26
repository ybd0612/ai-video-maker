// ────────────────────────────────────────────────────────────────────────────
// src/lib/assetNamespace.ts
// Asset namespace utilities for character/scene consistency in prompts.
// Namespaces allow shorthand [Hero_A] in prompts that resolve to full descriptions.
// ────────────────────────────────────────────────────────────────────────────

import type { Character, SceneReference } from "@/stores/projectStore";

/**
 * 为角色生成资产命名空间
 * 格式：[PascalCaseName]
 */
export function generateAssetNamespace(name: string): string {
  const cleanName = name.replace(/[^a-zA-Z0-9一-鿿]/g, "");
  const pascalCase = cleanName
    .split(/(?=[A-Z一-鿿])/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
  return `[${pascalCase}]`;
}

/**
 * 生成角色的完整提示词，用于替换命名空间占位符
 */
export function generateFullPrompt(character: Character): string {
  return `a character named ${character.name}, ${character.appearancePrompt}`;
}

/**
 * 解析提示词中的资产命名空间
 * 将 [HeroA] 等占位符替换为完整的角色/场景描述
 */
export function resolveAssetNamespaces(
  prompt: string,
  characters: Character[],
  scenes: SceneReference[],
): string {
  let resolved = prompt;

  for (const char of characters) {
    if (!char.assetNamespace) continue;
    // 转义命名空间中的特殊正则字符
    const escaped = char.assetNamespace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    resolved = resolved.replace(new RegExp(escaped, "g"), char.fullPrompt);
  }

  for (const scene of scenes) {
    const pattern = `\\[${scene.id}\\]`;
    resolved = resolved.replace(new RegExp(pattern, "g"), scene.prompt);
  }

  return resolved;
}
