// ────────────────────────────────────────────────────────────────────────────
// tests/lib/shotReferencesBySize.test.ts
// 按景别分配参考位（Task 7）。断言来自 src/lib/promptComposer.ts 真实实现：
// 远景/极远景不接收道具图，特写让道具多占位，景别未知时维持旧口径。
// ────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { pickShotReferences } from "@/lib/promptComposer";
import type { Asset, Shot } from "@/stores/projectStore";

const ASSETS = [
  { id: "c1", type: "character", name: "橘猫", imageUrl: "https://cdn.test/c1.png" },
  { id: "c2", type: "character", name: "幼犬", imageUrl: "https://cdn.test/c2.png" },
  { id: "p1", type: "prop", name: "晾衣绳", imageUrl: "https://cdn.test/p1.png" },
  { id: "p2", type: "prop", name: "水桶", imageUrl: "https://cdn.test/p2.png" },
] as Asset[];

function shotFor(over: Partial<Shot> = {}): Shot {
  return {
    id: "s",
    index: 0,
    scriptText: "",
    visualPrompt: "",
    motionPrompt: "",
    dialogues: [],
    activeCharacterIds: ["c1", "c2"],
    activeSceneId: "sc",
    activeProductIds: [],
    activePropIds: ["p1", "p2"],
    duration: 5,
    status: "scripted",
    useDualFrame: false,
    ...over,
  } as Shot;
}

describe("按景别分配参考位", () => {
  it("远景/极远景：只留角色身份锚点，道具特写图不占位", () => {
    for (const size of ["extreme-wide", "wide"] as const) {
      const refs = pickShotReferences(shotFor({ shotSize: size }), { assets: ASSETS });
      expect(refs).toHaveLength(2);
      expect(refs).toEqual(["https://cdn.test/c1.png", "https://cdn.test/c2.png"]);
    }
  });

  it("特写：道具图优先占位（细节需要它），角色仍先收", () => {
    const refs = pickShotReferences(shotFor({ shotSize: "close-up" }), { assets: ASSETS });
    expect(refs[0]).toBe("https://cdn.test/c1.png");
    expect(refs).toContain("https://cdn.test/p1.png");
    // close-up 的角色额度只有 1 张
    expect(refs).toEqual([
      "https://cdn.test/c1.png",
      "https://cdn.test/p1.png",
      "https://cdn.test/p2.png",
    ]);
  });

  it("中景维持既有口径（角色 → 道具，各 2 张）", () => {
    const refs = pickShotReferences(shotFor({ shotSize: "medium" }), { assets: ASSETS });
    expect(refs).toEqual([
      "https://cdn.test/c1.png",
      "https://cdn.test/c2.png",
      "https://cdn.test/p1.png",
      "https://cdn.test/p2.png",
    ]);
  });

  it("景别未知：维持现状口径（角色 → 产品 → 道具，上限 4）", () => {
    const refs = pickShotReferences(shotFor({ shotSize: undefined }), { assets: ASSETS });
    expect(refs).toEqual([
      "https://cdn.test/c1.png",
      "https://cdn.test/c2.png",
      "https://cdn.test/p1.png",
      "https://cdn.test/p2.png",
    ]);
  });
});
