// ────────────────────────────────────────────────────────────────────────────
// src/lib/shotSize.ts
// 景别的唯一机读口径：衔接闸门（shotContinuity）与参考图分配（pickShotReferences）
// 共用。由分镜模型产出，代码不猜——取值不在白名单内即降级为 undefined。
// ────────────────────────────────────────────────────────────────────────────

export type ShotSize = "extreme-wide" | "wide" | "medium" | "close" | "close-up";

/** 由远到近的档位顺序；索引差即「跨了几档」 */
export const SHOT_SIZES: readonly ShotSize[] = [
  "extreme-wide",
  "wide",
  "medium",
  "close",
  "close-up",
] as const;

/** 允许衔接/共享参考位的最大档位跨度：1 ＝ 只允许同档或相邻档 */
export const MAX_SHOT_SIZE_STEP_GAP = 1;

export function normalizeShotSize(raw: unknown): ShotSize | undefined {
  if (typeof raw !== "string") return undefined;
  const key = raw.trim().toLowerCase();
  return (SHOT_SIZES as readonly string[]).includes(key) ? (key as ShotSize) : undefined;
}

/**
 * 相邻两镜的景别是否足够接近，可以让模型在两者之间补一段运动。
 * 任一侧未知时判为不兼容：未知不等于"随便接"。
 */
export function isAdjacentSizeCompatible(
  a: ShotSize | undefined,
  b: ShotSize | undefined,
): boolean {
  if (!a || !b) return false;
  const gap = Math.abs(SHOT_SIZES.indexOf(a) - SHOT_SIZES.indexOf(b));
  return gap <= MAX_SHOT_SIZE_STEP_GAP;
}
