// ────────────────────────────────────────────────────────────────────────────
// tests/lib/referencePlan.test.ts
// 参考位分配的可解释性：被拒收必须说得出原因，不能静默。
// accepted 必须与 pickShotReferences 完全一致 —— 解释器不得另立一套判定，
// 否则界面解释与实际请求会随时间分叉（本项目明令禁止同一语义两套实现）。
// ────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { explainShotReferences } from "@/lib/referencePlan";
import { MAX_REFERENCES_BY_SIZE, pickShotReferences } from "@/lib/promptComposer";
import type { Asset, Shot } from "@/stores/projectTypes";

const ASSETS = [
  { id: "c1", type: "character", name: "橘猫", imageUrl: "https://cdn.test/c1.png" },
  { id: "c2", type: "character", name: "幼犬", imageUrl: "https://cdn.test/c2.png" },
  { id: "p1", type: "prop", name: "晾衣绳", imageUrl: "https://cdn.test/p1.png" },
  { id: "p2", type: "prop", name: "水桶", imageUrl: "https://cdn.test/p2.png" },
] as Asset[];

const shotFor = (over: Partial<Shot> = {}): Shot => ({
  id: "s", index: 0, scriptText: "", visualPrompt: "", motionPrompt: "", dialogues: [],
  activeCharacterIds: ["c1", "c2"], activeProductIds: [], activePropIds: ["p1", "p2"],
  duration: 5, status: "scripted", useDualFrame: false,
  ...over,
} as Shot);

describe("explainShotReferences", () => {
  it("accepted 与 pickShotReferences 完全一致（含景别未知）", () => {
    for (const size of ["extreme-wide", "wide", "medium", "close", "close-up", undefined] as const) {
      const shot = shotFor({ shotSize: size });
      expect(explainShotReferences(shot, { assets: ASSETS }).accepted)
        .toEqual(pickShotReferences(shot, { assets: ASSETS }));
    }
  });

  it("远景拒收两张道具图，原因是 size-budget 而不是 total-budget", () => {
    const r = explainShotReferences(shotFor({ shotSize: "wide" }), { assets: ASSETS });
    expect(r.accepted).toHaveLength(2);
    expect(r.rejected.map((x) => x.assetId)).toEqual(["p1", "p2"]);
    expect(r.rejected.every((x) => x.because === "size-budget")).toBe(true);
  });

  it("特写额度 1 角色 + 3 道具：第二个角色被拒，道具全收", () => {
    expect(MAX_REFERENCES_BY_SIZE["close-up"]).toEqual({ characters: 1, props: 3 });
    const r = explainShotReferences(shotFor({ shotSize: "close-up" }), { assets: ASSETS });
    expect(r.accepted).toEqual([
      "https://cdn.test/c1.png", "https://cdn.test/p1.png", "https://cdn.test/p2.png",
    ]);
    expect(r.rejected.map((x) => x.assetId)).toEqual(["c2"]);
  });

  it("景别未知时不拒收任何一张（额度 2+2，总数正好 4）", () => {
    const r = explainShotReferences(shotFor({ shotSize: undefined }), { assets: ASSETS });
    expect(r.rejected).toEqual([]);
    expect(r.accepted).toHaveLength(4);
  });

  it("没有 imageUrl 的资产既不占位也不算被拒（它本来没资格）", () => {
    const noImg = [{ id: "c9", type: "character", name: "无图" } as Asset];
    const r = explainShotReferences(
      shotFor({ activeCharacterIds: ["c9"], activePropIds: [] }),
      { assets: noImg },
    );
    expect(r).toEqual({ accepted: [], rejected: [] });
  });
});
