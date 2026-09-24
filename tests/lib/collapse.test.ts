// ────────────────────────────────────────────────────────────────────────────
// tests/lib/collapse.test.ts
// 折叠三档的唯一纯逻辑：什么时候值得给"展开"入口。
// 目的不是精确排版（那由 CSS line-clamp 做），而是避免给一行短文本也挂个展开钮。
// ────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { COLLAPSED_LINES, shouldOfferExpand } from "@/lib/collapse";

describe("shouldOfferExpand", () => {
  it("常量与档 2 定义一致", () => { expect(COLLAPSED_LINES).toBe(3); });
  it("空串 / 短文本不给展开入口", () => {
    expect(shouldOfferExpand("")).toBe(false);
    expect(shouldOfferExpand("一只橘猫蹲在水塔阴影中")).toBe(false);
  });
  it("超过一行分句数或总长超阈值时给入口", () => {
    expect(shouldOfferExpand("暴雨前的旧楼天台，地面干燥发白。" + "橘猫弓背压低，右眼紧盯红色水桶，尾巴绷直。")).toBe(true);
    expect(shouldOfferExpand("a\nb\nc\nd")).toBe(true);
  });
});
