// ────────────────────────────────────────────────────────────────────────────
// tests/lib/railSelection.test.ts
// 镜头轨选中态的唯一纯逻辑（本仓库不渲染组件，故把可判定部分全放这里）。
// 断言来自 src/lib/railSelection.ts 真实实现。
// ────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { moveSelection, syncSelectionWithShots } from "@/lib/railSelection";

describe("moveSelection", () => {
  it("两端夹住不环绕（环绕会让用户失去方位感）", () => {
    const ids = ["a", "b", "c"];
    expect(moveSelection(ids, "a", 1)).toBe("b");
    expect(moveSelection(ids, "c", 1)).toBe("c");
    expect(moveSelection(ids, "c", -1)).toBe("b");
    expect(moveSelection(ids, "a", -1)).toBe("a");
  });

  it("未选中 / 选中项已消失时落到首镜", () => {
    expect(moveSelection(["a", "b"], undefined, 1)).toBe("a");
    expect(moveSelection(["a", "b"], "gone", -1)).toBe("a");
  });

  it("空集合返回 undefined，不抛错", () => {
    expect(moveSelection([], undefined, 1)).toBeUndefined();
    expect(moveSelection([], "a", 1)).toBeUndefined();
  });
});

describe("syncSelectionWithShots", () => {
  it("选中项仍在集合内则保持；已消失则回到首镜，不留悬空选中", () => {
    expect(syncSelectionWithShots(["a", "b"], "b")).toBe("b");
    expect(syncSelectionWithShots(["a", "b"], "gone")).toBe("a");
    expect(syncSelectionWithShots([], "a")).toBeUndefined();
  });
});
