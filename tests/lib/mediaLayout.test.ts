// ────────────────────────────────────────────────────────────────────────────
// 画幅版式唯一口径。断言来自 src/lib/mediaLayout.ts 真实实现。
// 关注三件事：① 三种画幅的版式类串必须互不相同（今天完全相同是根因）；
// ② 竖幅详情预览必须「高度优先」（不按宽度撑满后被 max-h 截，那正是留白来源）；
// ③ 非法/缺失画幅回落 16:9（与 projectStore 的新建默认一致），不抛错。
// ────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import {
  ASPECT_RATIO_CSS,
  DEFAULT_ASPECT,
  MEDIA_FRAME,
  resolveAspect,
  type MediaSlot,
} from "@/lib/mediaLayout";

const SLOTS: MediaSlot[] = ["railThumb", "detailPrimary", "detailSecondary"];

describe("resolveAspect", () => {
  it("合法值原样返回", () => {
    expect(resolveAspect("9:16")).toBe("9:16");
    expect(resolveAspect("16:9")).toBe("16:9");
    expect(resolveAspect("1:1")).toBe("1:1");
  });

  it("非法 / 缺失 / 非字符串一律回落 DEFAULT_ASPECT（=16:9，与新建项目默认同值）", () => {
    expect(DEFAULT_ASPECT).toBe("16:9");
    for (const bad of [undefined, null, "4:5", "", "9×16", 42, {}]) {
      expect(resolveAspect(bad)).toBe("16:9");
    }
  });
});

describe("ASPECT_RATIO_CSS", () => {
  it("三种画幅的宽高比类串互不相同", () => {
    const values = Object.values(ASPECT_RATIO_CSS);
    expect(new Set(values).size).toBe(3);
    expect(ASPECT_RATIO_CSS["9:16"]).toBe("aspect-[9/16]");
  });
});

describe("MEDIA_FRAME", () => {
  it("每个槽位都覆盖三种画幅，且类串非空", () => {
    for (const slot of SLOTS) {
      for (const aspect of ["9:16", "16:9", "1:1"] as const) {
        const frame = MEDIA_FRAME[slot][aspect];
        expect(frame.containerClass, `${slot}/${aspect}`).toBeTruthy();
        expect(frame.mediaClass, `${slot}/${aspect}`).toBeTruthy();
      }
    }
  });

  it("三画幅的容器类串互不相同（否则等于没做画幅适配）", () => {
    for (const slot of SLOTS) {
      const set = new Set([
        MEDIA_FRAME[slot]["9:16"].containerClass,
        MEDIA_FRAME[slot]["16:9"].containerClass,
        MEDIA_FRAME[slot]["1:1"].containerClass,
      ]);
      expect(set.size, slot).toBe(3);
    }
  });

  it("竖幅详情预览按高度优先：容器带 h-* 与 aspect，且不含 w-full 撑宽", () => {
    const portrait = MEDIA_FRAME.detailPrimary["9:16"].containerClass;
    expect(portrait).toContain("aspect-[9/16]");
    expect(portrait).toMatch(/(^| )h-\[/);
    expect(portrait).not.toContain("w-full");
  });

  it("横幅详情预览按宽度优先（w-full + aspect-[16/9]）", () => {
    const landscape = MEDIA_FRAME.detailPrimary["16:9"].containerClass;
    expect(landscape).toContain("w-full");
    expect(landscape).toContain("aspect-[16/9]");
  });

  it("轨上缩略图一律裁剪填满（object-cover），详情主图一律完整可见（object-contain）", () => {
    expect(MEDIA_FRAME.railThumb["9:16"].mediaClass).toContain("object-cover");
    expect(MEDIA_FRAME.detailPrimary["9:16"].mediaClass).toContain("object-contain");
  });

  it("轨上缩略图竖幅用竖比例、横幅用横比例（两列轨的观感差别全在这里）", () => {
    expect(MEDIA_FRAME.railThumb["9:16"].containerClass).toContain("aspect-[9/16]");
    expect(MEDIA_FRAME.railThumb["16:9"].containerClass).toContain("aspect-[16/9]");
    expect(MEDIA_FRAME.railThumb["1:1"].containerClass).toContain("aspect-square");
  });
});
