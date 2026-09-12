// ────────────────────────────────────────────────────────────────────────────
// tests/lib/imageParams.test.ts
// 图片生成参数映射的单测：
// - aspectRatioToImageParams：画幅 → { size 档位串, ratio }
// - imageSizeToTier：档位串直通 + 像素串解析（含存量行为锁定）
// 断言来自 src/services/imageService.ts 与 src/lib/plans.ts 真实实现。
// ────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { aspectRatioToImageParams } from "@/services/imageService";
import { imageSizeToTier } from "@/lib/plans";

describe("aspectRatioToImageParams", () => {
  it("竖屏 9:16 → { size: \"1K\", ratio: \"9:16\" }", () => {
    expect(aspectRatioToImageParams("9:16")).toEqual({ size: "1K", ratio: "9:16" });
  });

  it("横屏 16:9 与方形 1:1 正确透传，size 均为 1K 档", () => {
    expect(aspectRatioToImageParams("16:9")).toEqual({ size: "1K", ratio: "16:9" });
    expect(aspectRatioToImageParams("1:1")).toEqual({ size: "1K", ratio: "1:1" });
  });

  it("白名单内的其他画幅（3:4 / 4:3 / 2:3 / 3:2 / 21:9）透传", () => {
    for (const ratio of ["3:4", "4:3", "2:3", "3:2", "21:9"] as const) {
      expect(aspectRatioToImageParams(ratio).ratio).toBe(ratio);
    }
  });

  it("未知画幅回退 1:1", () => {
    expect(aspectRatioToImageParams("7:3")).toEqual({ size: "1K", ratio: "1:1" });
    expect(aspectRatioToImageParams("")).toEqual({ size: "1K", ratio: "1:1" });
  });

  it("非法输入（undefined / null / 大小写不匹配）同样回退 1:1，不抛错", () => {
    expect(aspectRatioToImageParams(undefined as unknown as string)).toEqual({
      size: "1K",
      ratio: "1:1",
    });
    expect(aspectRatioToImageParams(null as unknown as string)).toEqual({
      size: "1K",
      ratio: "1:1",
    });
    // 大小写敏感：不在白名单内 → 回退
    expect(aspectRatioToImageParams("16:9 ")).toEqual({ size: "1K", ratio: "1:1" });
    expect(aspectRatioToImageParams("9:16x")).toEqual({ size: "1K", ratio: "1:1" });
  });
});

describe("imageSizeToTier：档位串直通", () => {
  it("档位串直接返回对应档位（大小写不敏感）", () => {
    expect(imageSizeToTier("2K")).toBe("2K");
    expect(imageSizeToTier("4k")).toBe("4K");
    expect(imageSizeToTier("1K")).toBe("1K");
    expect(imageSizeToTier("3K")).toBe("3K");
  });

  it("档位串两侧空白可容忍", () => {
    expect(imageSizeToTier(" 2K ")).toBe("2K");
  });
});

describe("imageSizeToTier：像素串解析（存量行为锁定）", () => {
  it("按长边映射到官方档位", () => {
    expect(imageSizeToTier("1024x1024")).toBe("1K");
    expect(imageSizeToTier("1344x768")).toBe("1K");
    expect(imageSizeToTier("2624x1472")).toBe("2K");
    expect(imageSizeToTier("3936x2214")).toBe("3K");
    expect(imageSizeToTier("5248x2952")).toBe("4K");
  });

  it("档位边界取「不小于」语义", () => {
    expect(imageSizeToTier("1499x1000")).toBe("1K");
    expect(imageSizeToTier("1500x1000")).toBe("2K");
    expect(imageSizeToTier("2699x1000")).toBe("2K");
    expect(imageSizeToTier("2700x1000")).toBe("3K");
    expect(imageSizeToTier("3999x1000")).toBe("3K");
    expect(imageSizeToTier("4000x1000")).toBe("4K");
  });

  it("无法解析时回退到 1K", () => {
    expect(imageSizeToTier(undefined)).toBe("1K");
    expect(imageSizeToTier("")).toBe("1K");
    expect(imageSizeToTier("auto")).toBe("1K");
    expect(imageSizeToTier("1024")).toBe("1K");
  });
});
