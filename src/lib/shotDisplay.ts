// ────────────────────────────────────────────────────────────────────────────
// src/lib/shotDisplay.ts
// 镜头轨与详情区的展示映射：景别 → 文案键。
// 未知一律给独立键，不借用真实档位。
// ────────────────────────────────────────────────────────────────────────────

import type { ShotSize } from "@/lib/shotSize";
import type { TranslationKey } from "@/i18n";

export const SHOT_SIZE_LABEL_KEYS: Record<ShotSize, TranslationKey> = {
  "extreme-wide": "shotSize.extremeWide",
  wide: "shotSize.wide",
  medium: "shotSize.medium",
  close: "shotSize.close",
  "close-up": "shotSize.closeUp",
};

export function shotSizeLabelKey(size: ShotSize | undefined): TranslationKey {
  return size ? SHOT_SIZE_LABEL_KEYS[size] : "shotSize.unknown";
}
