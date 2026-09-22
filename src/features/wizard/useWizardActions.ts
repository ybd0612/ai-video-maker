// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/useWizardActions.ts
// Wizard operation facade: keeps the public API stable while composing
// domain-specific action hooks.
// ────────────────────────────────────────────────────────────────────────────

import { useAssetActions } from "./useAssetActions";
import { useImageActions } from "./useImageActions";
import { useScriptActions } from "./useScriptActions";
import { useVideoActions } from "./useVideoActions";

/**
 * 向导动作统一入口。
 * 具体实现按脚本、资产、图片、视频四个生成域拆分，调用方无需改动。
 */
export function useWizardActions() {
  const assetActions = useAssetActions();
  const imageActions = useImageActions();
  const scriptActions = useScriptActions(
    assetActions.generateStyleReference,
    assetActions.generateAssetImages,
  );
  const videoActions = useVideoActions();

  return {
    ...scriptActions,
    ...assetActions,
    ...imageActions,
    ...videoActions,
  };
}

export { hasActiveAssetTask } from "./useAssetActions";
export { hasActiveScriptTask, hasActiveIdeaTask } from "./useScriptActions";
export { extractNewAssets } from "@/lib/extractAssets";
