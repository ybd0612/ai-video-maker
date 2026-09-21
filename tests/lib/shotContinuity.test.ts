// ────────────────────────────────────────────────────────────────────────────
// tests/lib/shotContinuity.test.ts
// 同场景首尾帧自动衔接的派生规则。断言来自 src/lib/shotContinuity.ts 真实实现。
// ────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import {
  buildContinuityMap,
  planShotContinuity,
  type ContinuityDecision,
  type ShotForContinuity,
} from "@/lib/shotContinuity";

const IMG = (n: number) => `https://cdn.test/shot${n}.png`;

function shot(overrides: Partial<ShotForContinuity> & { id: string; index: number }): ShotForContinuity {
  return {
    imageUrl: IMG(overrides.index),
    activeSceneId: "scene_1",
    activeCharacterIds: ["char_pig"],
    useDualFrame: false,
    lastFrameUrl: undefined,
    ...overrides,
  };
}

/** 一条真实的六镜链路：麦田三镜 → 河边两镜 → 尾镜无图 */
const SAMPLE: ShotForContinuity[] = [
  shot({ id: "s0", index: 0 }),
  shot({ id: "s1", index: 1 }),
  shot({ id: "s2", index: 2, activeCharacterIds: ["char_hare"] }),   // 同场景换人
  shot({ id: "s3", index: 3, activeSceneId: "scene_2" }),            // 换场景
  shot({ id: "s4", index: 4, activeSceneId: "scene_2", activeCharacterIds: [] }),
  shot({ id: "s5", index: 5, activeSceneId: undefined, imageUrl: undefined }),
  shot({ id: "s6", index: 6, imageUrl: undefined }),
];

function reasons(decisions: ContinuityDecision[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of decisions) out[d.shotId] = d.linked ? "linked" : d.reason;
  return out;
}

describe("planShotContinuity", () => {
  it("同场景相邻两镜：用下一镜画面图作本镜尾帧", () => {
    const decisions = planShotContinuity(SAMPLE);
    const s0 = decisions.find((d) => d.shotId === "s0")!;
    expect(s0.linked).toBe(true);
    if (s0.linked) {
      expect(s0.lastFrameUrl).toBe(IMG(1));
      expect(s0.nextShotId).toBe("s1");
    }
  });

  it("逐镜判定与预期一致（含四类断开原因）", () => {
    expect(reasons(planShotContinuity(SAMPLE))).toEqual({
      s0: "linked",
      s1: "cast-disjoint",   // s2 换人：同场景不共享角色
      s2: "scene-changed",   // s3 进入 scene_2
      s3: "linked",          // s3 → s4 同场景、角色未知不阻断
      s4: "no-next-frame",   // s5 没有画面图，拿不到尾帧（先于场景判定）
      s5: "no-first-frame",  // s5 自己没图（本镜也不会出视频）
      s6: "last-shot",
    });
  });

  it("下一镜有图但缺主场景时判为 scene-unknown", () => {
    const shots = [
      shot({ id: "a", index: 0 }),
      shot({ id: "b", index: 1, activeSceneId: undefined }),
    ];
    expect(reasons(planShotContinuity(shots))).toEqual({ a: "scene-unknown", b: "last-shot" });
  });

  it("关闭角色共享要求后，换人相邻镜也衔接", () => {
    const decisions = planShotContinuity(SAMPLE, { requireSharedCast: false });
    const s1 = decisions.find((d) => d.shotId === "s1")!;
    expect(s1.linked).toBe(true);
    if (s1.linked) expect(s1.lastFrameUrl).toBe(IMG(2));
  });

  it("下一镜缺图时不衔接，原因区分于本镜缺图", () => {
    const shots = [
      shot({ id: "a", index: 0 }),
      shot({ id: "b", index: 1, imageUrl: undefined }),
    ];
    expect(reasons(planShotContinuity(shots))).toEqual({ a: "no-next-frame", b: "last-shot" });
  });

  it("用户手动尾帧优先，不被自动衔接覆盖", () => {
    const shots = [
      shot({ id: "a", index: 0, useDualFrame: true, lastFrameUrl: "https://cdn.test/manual.png" }),
      shot({ id: "b", index: 1 }),
    ];
    expect(reasons(planShotContinuity(shots)).a).toBe("manual-tail");
  });

  it("乱序数组按 index 排序后再配对", () => {
    const decisions = planShotContinuity([SAMPLE[1], SAMPLE[0], SAMPLE[2]]);
    expect(decisions.map((d) => d.shotId)).toEqual(["s0", "s1", "s2"]);
  });

  it("纯函数：不修改入参镜头数据", () => {
    const input: ShotForContinuity[] = [shot({ id: "a", index: 0 }), shot({ id: "b", index: 1 })];
    const before = JSON.stringify(input);
    planShotContinuity(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("空数组与单镜数组都不抛错", () => {
    expect(planShotContinuity([])).toEqual([]);
    expect(reasons(planShotContinuity([shot({ id: "only", index: 0 })]))).toEqual({ only: "last-shot" });
  });
});

describe("buildContinuityMap", () => {
  it("映射只收录已衔接的镜头（手动尾帧优先等取舍在 videoPlan 判定）", () => {
    const links = buildContinuityMap(planShotContinuity(SAMPLE));
    expect([...links.entries()]).toEqual([["s0", IMG(1)], ["s3", IMG(4)]]);
  });
});
