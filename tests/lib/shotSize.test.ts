import { describe, expect, it } from "vitest";
import {
  SHOT_SIZES,
  isAdjacentSizeCompatible,
  normalizeShotSize,
} from "@/lib/shotSize";

describe("normalizeShotSize", () => {
  it("白名单内的值原样返回（含大小写与首尾空白）", () => {
    for (const v of SHOT_SIZES) {
      expect(normalizeShotSize(`  ${v.toUpperCase()} `)).toBe(v);
    }
  });

  it("白名单外、空串、非字符串一律 undefined（模型不遵守时降级，不猜）", () => {
    expect(normalizeShotSize("medium-long shot")).toBeUndefined();
    expect(normalizeShotSize("")).toBeUndefined();
    expect(normalizeShotSize(undefined)).toBeUndefined();
    expect(normalizeShotSize(3)).toBeUndefined();
    expect(normalizeShotSize(null)).toBeUndefined();
  });
});

describe("isAdjacentSizeCompatible", () => {
  it("任一侧未知 → 判为不兼容（未知不得当作兼容放行衔接）", () => {
    expect(isAdjacentSizeCompatible(undefined, "wide")).toBe(false);
    expect(isAdjacentSizeCompatible("wide", undefined)).toBe(false);
    expect(isAdjacentSizeCompatible(undefined, undefined)).toBe(false);
  });

  it("相邻档位与同档兼容；跨两档以上不兼容", () => {
    expect(isAdjacentSizeCompatible("wide", "medium")).toBe(true);
    expect(isAdjacentSizeCompatible("medium", "wide")).toBe(true);
    expect(isAdjacentSizeCompatible("close-up", "close")).toBe(true);
    expect(isAdjacentSizeCompatible("close-up", "medium")).toBe(false);
    expect(isAdjacentSizeCompatible("extreme-wide", "close")).toBe(false);
  });
});
