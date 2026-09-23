// ────────────────────────────────────────────────────────────────────────────
// tests/lib/shotContinuity.test.ts
// 相邻镜头首帧衔接的派生规则。断言来自 src/lib/shotContinuity.ts 真实实现。
// 方向口径（2026-09-23 纠正）：linked 表示「本镜从上一镜取首帧」，
// 绝不把任何镜头的画面图当作别的镜头的尾帧。
// ────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import {
  buildHandoffMap,
  planShotContinuity,
  type ShotForContinuity,
} from "@/lib/shotContinuity";

const IMG = (n: number) => `https://cdn.test/shot${n}.png`;

function shot(
  overrides: Partial<ShotForContinuity> & { id: string; index: number },
): ShotForContinuity {
  return {
    imageUrl: IMG(overrides.index),
    activeSceneId: "scene_1",
    activeCharacterIds: ["char_pig"],
    shotSize: "medium",
    ...overrides,
  };
}

/** 麦田两镜可接 → 景别跨两档断开 → 换场景断开 → 换场景同档可接 → 缺图 */
const SAMPLE: ShotForContinuity[] = [
  shot({ id: "s0", index: 0 }),
  shot({ id: "s1", index: 1, shotSize: "wide" }),                 // 同场景，跨一档 → 可衔接
  shot({ id: "s2", index: 2, shotSize: "close-up" }),             // 与 s1 跨两档 → 不衔接
  shot({ id: "s3", index: 3, activeSceneId: "scene_2" }),         // 换场景 → 不衔接
  shot({ id: "s4", index: 4, activeSceneId: "scene_2", activeCharacterIds: [] }),
  shot({ id: "s5", index: 5, activeSceneId: undefined, imageUrl: undefined }),
  shot({ id: "s6", index: 6, imageUrl: undefined }),
];

function reasons(list: ReturnType<typeof planShotContinuity>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of list) out[d.shotId] = d.linked ? "linked" : d.reason;
  return out;
}

describe("planShotContinuity：衔接方向", () => {
  it("绝不把任何镜头的画面图当作别的镜头的尾帧（回归绊线）", () => {
    const decisions = planShotContinuity(SAMPLE);
    expect(decisions.some((d) => "lastFrameUrl" in d)).toBe(false);
  });

  it("linked 表示「本镜应从上一镜取首帧」，方向指向后镜", () => {
    const map = buildHandoffMap(planShotContinuity(SAMPLE));
    // s1 从 s0 取首帧；s2 因景别跨两档不接；s3 换场景不接；s4 从 s3 取
    expect([...map.entries()]).toEqual([["s1", "s0"], ["s4", "s3"]]);
  });

  it("景别未知的一侧不衔接（未知不放行）", () => {
    const list = planShotContinuity([
      shot({ id: "a", index: 0 }),
      shot({ id: "b", index: 1, shotSize: undefined }),
    ]);
    expect(reasons(list)).toEqual({ a: "last-shot", b: "size-unknown" });
  });

  it("同场景但出场人物完全不相交时断开（换人特写不强行接在同一路径上）", () => {
    const list = planShotContinuity([
      shot({ id: "a", index: 0, activeCharacterIds: ["c1"] }),
      shot({ id: "b", index: 1, activeCharacterIds: ["c2"] }),
    ]);
    expect(reasons(list)).toEqual({ a: "last-shot", b: "cast-disjoint" });
  });

  it("上一镜没有画面图时无处可取", () => {
    const list = planShotContinuity([
      shot({ id: "a", index: 0, imageUrl: undefined }),
      shot({ id: "b", index: 1 }),
    ]);
    expect(reasons(list)).toEqual({ a: "last-shot", b: "no-first-frame" });
  });

  it("关闭角色共享要求后，换人相邻镜也衔接", () => {
    const list = planShotContinuity(
      [
        shot({ id: "a", index: 0, activeCharacterIds: ["c1"] }),
        shot({ id: "b", index: 1, activeCharacterIds: ["c2"] }),
      ],
      { requireSharedCast: false },
    );
    expect(reasons(list)).toEqual({ a: "last-shot", b: "linked" });
  });

  it("乱序数组按 index 排序后再配对", () => {
    const decisions = planShotContinuity([SAMPLE[1], SAMPLE[0], SAMPLE[2]]);
    expect(decisions.map((d) => d.shotId)).toEqual(["s0", "s1", "s2"]);
  });

  it("纯函数：不修改入参", () => {
    const input = [shot({ id: "a", index: 0 }), shot({ id: "b", index: 1 })];
    const before = JSON.stringify(input);
    planShotContinuity(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("空数组与单镜数组都不抛错", () => {
    expect(planShotContinuity([])).toEqual([]);
    expect(reasons(planShotContinuity([shot({ id: "only", index: 0 })]))).toEqual({
      only: "last-shot",
    });
  });
});
