// ────────────────────────────────────────────────────────────────────────────
// tests/lib/firstFrameSource.test.ts
// 「本镜首帧从哪来、为什么没衔接」的唯一解释器。
// 断言来自 src/lib/firstFrameSource.ts 与 shotContinuity 的真实判定顺序 ——
// 界面解释与请求素材必须同源，否则会各说各话。
// ────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import type { ShotForContinuity } from "@/lib/shotContinuity";
import { describeFirstFrameSource, firstFrameSourceKey } from "@/lib/firstFrameSource";

const shotOf = (over: Partial<ShotForContinuity> & { id: string; index: number }): ShotForContinuity => ({
  imageUrl: `https://cdn.test/${over.id}.png`,
  activeSceneId: "scene_1",
  activeCharacterIds: ["c1"],
  shotSize: "medium",
  ...over,
});

const INPUT = (over: Partial<Parameters<typeof describeFirstFrameSource>[0]> = {}) => ({
  shotId: "s1",
  shots: [shotOf({ id: "s0", index: 0 }), shotOf({ id: "s1", index: 1 })],
  useDualFrame: false,
  lastFrameUrl: undefined,
  consistency: "chain" as const,
  tailFrames: { s0: "https://cdn.test/tail-s0.png" },
  ...over,
});

describe("describeFirstFrameSource", () => {
  it("手动双帧优先（用户指定了尾帧，自动衔接让位）", () => {
    expect(describeFirstFrameSource(INPUT({ useDualFrame: true, lastFrameUrl: "https://cdn.test/t.png" })))
      .toEqual({ kind: "manual-tail" });
  });

  it("衔接成立且末帧就绪 → 取前镜末帧，并指出来自哪一镜", () => {
    expect(describeFirstFrameSource(INPUT())).toEqual({ kind: "handoff", fromShotId: "s0" });
  });

  it("consistency=off 时明确降级原因，不静默", () => {
    expect(describeFirstFrameSource(INPUT({ consistency: "off" })))
      .toEqual({ kind: "self", because: "consistency-off" });
  });

  it("判定可衔接但末帧没抽到（刷新后内存丢失）→ tail-missing", () => {
    expect(describeFirstFrameSource(INPUT({ tailFrames: {} })))
      .toEqual({ kind: "self", because: "tail-missing" });
  });

  it("末帧是浏览器本地 blob 地址时解释为退回本镜公网画面图", () => {
    expect(describeFirstFrameSource(INPUT({ tailFrames: { s0: "blob:http://127.0.0.1/tail" } })))
      .toEqual({ kind: "self", because: "tail-local-only" });
  });

  it("景别跨两档 → 透出 shotContinuity 的真实原因 size-gap", () => {
    expect(describeFirstFrameSource(INPUT({
      shots: [shotOf({ id: "s0", index: 0, shotSize: "wide" }), shotOf({ id: "s1", index: 1, shotSize: "close-up" })],
    }))).toEqual({ kind: "self", because: "size-gap" });
  });

  it("换场景 / 演员不相交 / 前镜无图 / 首镜 四种原因互不被抹平", () => {
    const scene = describeFirstFrameSource(INPUT({
      shots: [shotOf({ id: "s0", index: 0, activeSceneId: "scene_9" }), shotOf({ id: "s1", index: 1 })],
    }));
    const cast = describeFirstFrameSource(INPUT({
      shots: [shotOf({ id: "s0", index: 0, activeCharacterIds: ["x"] }), shotOf({ id: "s1", index: 1, activeCharacterIds: ["y"] })],
    }));
    const noImg = describeFirstFrameSource(INPUT({
      shots: [shotOf({ id: "s0", index: 0, imageUrl: undefined }), shotOf({ id: "s1", index: 1 })],
    }));
    const first = describeFirstFrameSource(INPUT({ shotId: "s0" }));
    expect([scene, cast, noImg, first]).toEqual([
      { kind: "self", because: "scene-changed" },
      { kind: "self", because: "cast-disjoint" },
      { kind: "self", because: "no-first-frame" },
      { kind: "self", because: "last-shot" },
    ]);
  });

  it("每个 kind / because 都有独立文案键（不允许出现未翻译的内部枚举）", () => {
    const cases: Array<ReturnType<typeof describeFirstFrameSource>> = [
      { kind: "manual-tail" },
      { kind: "handoff", fromShotId: "s0" },
      { kind: "self", because: "consistency-off" },
      { kind: "self", because: "tail-missing" },
      { kind: "self", because: "tail-local-only" },
      { kind: "self", because: "size-gap" },
      { kind: "self", because: "scene-changed" },
      { kind: "self", because: "cast-disjoint" },
      { kind: "self", because: "no-first-frame" },
      { kind: "self", because: "scene-unknown" },
      { kind: "self", because: "size-unknown" },
      { kind: "self", because: "last-shot" },
    ];
    const keys = cases.map(firstFrameSourceKey);
    for (const key of keys) expect(key).toMatch(/^videoPlan\.firstFrame\./);
    // 十一种情形必须落到不同文案，否则"没衔接"会被统一说成一句话
    expect(new Set(keys).size).toBe(cases.length);
  });
});
