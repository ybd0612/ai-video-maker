// ────────────────────────────────────────────────────────────────────────────
// tests/lib/videoPlan.test.ts
// 视频一致性策略单测。断言来自 src/lib/videoPlan.ts 真实实现。
// 关键不变量：reference 与 first_frame / last_frame 永不同时给出
// （服务端实测 400「首尾帧素材与参考素材不能同时使用」）。
// ────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import {
  MAX_VIDEO_REFERENCE_IMAGES,
  pickIdentityReferences,
  planShotVideo,
  planShotVideoMedia,
  type VideoPlanInput,
} from "@/lib/videoPlan";
import type { Asset, Shot } from "@/stores/projectStore";

const IMG = (n: number) => `https://cdn.test/shot${n}.png`;

/** 构造 planShotVideoMedia 需要的最小镜头对象 */
function mkShot(
  id: string,
  index: number,
  scene: string | undefined,
  over: Partial<Shot> = {},
): Shot {
  return {
    id, index, imageUrl: IMG(index), activeSceneId: scene,
    activeCharacterIds: scene === undefined ? [] : ["char_1"],
    useDualFrame: false, lastFrameUrl: undefined,
    ...over,
  } as unknown as Shot;
}

const ASSETS = [
  { id: "char_1", type: "character", name: "小兔", imageUrl: "https://cdn.test/portrait.png" },
] as Asset[];

function shot(over: Partial<Shot> & { imageUrl?: string } = {}): VideoPlanInput["shot"] {
  return {
    imageUrl: IMG(1),
    useDualFrame: false,
    lastFrameUrl: undefined,
    ...over,
  };
}

/** 不变量：互斥素材不会同时出现 */
function expectExclusive(plan: ReturnType<typeof planShotVideo>) {
  const hasFrames = !!(plan.firstFrameUrl || plan.lastFrameUrl);
  expect(hasFrames && plan.referenceImageUrls.length > 0).toBe(false);
}

describe("planShotVideo", () => {
  it("用户手动尾帧优先，忽略自动衔接", () => {
    const plan = planShotVideo({
      shot: shot({ useDualFrame: true, lastFrameUrl: "https://cdn.test/manual.png" }),
      autoLastFrameUrl: IMG(2),
      consistency: "chain",
    });
    expect(plan).toMatchObject({
      mode: "keyframe", firstFrameUrl: IMG(1),
      lastFrameUrl: "https://cdn.test/manual.png", reason: "manual-tail",
    });
    expectExclusive(plan);
  });

  it("chain 策略下用同场景下一镜画面图作尾帧", () => {
    const plan = planShotVideo({ shot: shot(), autoLastFrameUrl: IMG(2), consistency: "chain" });
    expect(plan).toMatchObject({
      mode: "keyframe", firstFrameUrl: IMG(1), lastFrameUrl: IMG(2), reason: "auto-chain",
    });
    expectExclusive(plan);
  });

  it("off 策略完全不引入自动尾帧", () => {
    const plan = planShotVideo({ shot: shot(), autoLastFrameUrl: IMG(2), consistency: "off" });
    expect(plan).toMatchObject({ mode: "keyframe", reason: "first-frame-only" });
    expect(plan.lastFrameUrl).toBeUndefined();
  });

  it("identity 只在拿不到衔接尾帧时生效，且不带任何帧素材", () => {
    const refs = [IMG(9), IMG(8)];
    const withChain = planShotVideo({
      shot: shot(), autoLastFrameUrl: IMG(2), consistency: "identity", identityReferences: refs,
    });
    expect(withChain.reason).toBe("auto-chain");

    const crossScene = planShotVideo({
      shot: shot(), autoLastFrameUrl: undefined, consistency: "identity", identityReferences: refs,
    });
    expect(crossScene).toMatchObject({ mode: "reference", reason: "identity-reference" });
    expect(crossScene.firstFrameUrl).toBeUndefined();
    expect(crossScene.lastFrameUrl).toBeUndefined();
    expect(crossScene.referenceImageUrls).toEqual(refs);
    expectExclusive(crossScene);
  });

  it("identity 但没有任何参考素材时退回仅首帧", () => {
    const plan = planShotVideo({ shot: shot(), consistency: "identity", identityReferences: [] });
    expect(plan).toMatchObject({ mode: "keyframe", reason: "first-frame-only" });
  });

  it("无首帧时走纯文本，不携带任何素材", () => {
    const plan = planShotVideo({
      shot: shot({ imageUrl: undefined }), consistency: "identity", identityReferences: [IMG(9)],
    });
    expect(plan).toEqual({ mode: "text", referenceImageUrls: [], reason: "text-only" });
  });

  it("参考图超过 Flash 上限时截断到 5 张", () => {
    const many = Array.from({ length: 8 }, (_, i) => IMG(i));
    const plan = planShotVideo({ shot: shot(), consistency: "identity", identityReferences: many });
    expect(plan.referenceImageUrls).toHaveLength(MAX_VIDEO_REFERENCE_IMAGES);
    expect(plan.referenceImageUrls).toEqual(many.slice(0, 5));
  });
});

describe("pickIdentityReferences", () => {
  const assets = [
    { id: "char_1", type: "character", name: "小兔", imageUrl: IMG(1) },
    { id: "char_2", type: "character", name: "小狐", avatarUrl: IMG(2) },
    { id: "char_3", type: "character", name: "无图" },
    { id: "scene_1", type: "scene", name: "麦田", imageUrl: IMG(4) },
  ] as Asset[];

  it("只取本镜出场角色的定妆照（imageUrl 优先、avatarUrl 兜底），最后附风格母版", () => {
    const refs = pickIdentityReferences(
      { activeCharacterIds: ["char_1", "char_2", "char_3", "scene_1"] } as Shot,
      assets,
      IMG(9),
    );
    expect(refs).toEqual([IMG(1), IMG(2), IMG(9)]);
  });

  it("去重且不超上限", () => {
    const sameUrlCharacters = Array.from({ length: 7 }, (_, i) => ({
      id: `c${i}`, type: "character" as const, name: `角色${i}`, imageUrl: IMG(i % 2),
    }));
    const refs = pickIdentityReferences(
      { activeCharacterIds: sameUrlCharacters.map((c) => c.id) } as Shot,
      sameUrlCharacters as Asset[],
      IMG(9),
    );
    expect(refs.length).toBeLessThanOrEqual(MAX_VIDEO_REFERENCE_IMAGES);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it("无角色且无风格母版时返回空数组", () => {
    expect(pickIdentityReferences({ activeCharacterIds: [] } as Shot, assets, undefined)).toEqual([]);
  });
});

describe("planShotVideoMedia（编排层唯一入口）", () => {
  const sameScene = [mkShot("s0", 0, "scene_a"), mkShot("s1", 1, "scene_a")];
  const crossScene = [mkShot("s0", 0, "scene_a"), mkShot("s1", 1, "scene_b")];

  it("同场景相邻镜头 → 首帧 + 下一镜画面图作尾帧，不带参考图", () => {
    const { media } = planShotVideoMedia({
      shot: sameScene[0], shots: sameScene, assets: ASSETS,
      styleReferenceUrl: IMG(9), consistency: "chain",
    });
    expect(media).toEqual({ imageUrl: IMG(0), lastFrameUrl: IMG(1) });
  });

  it("跨场景 + identity → 只给参考图（定妆照 + 风格母版），不给首尾帧", () => {
    const { plan, media } = planShotVideoMedia({
      shot: crossScene[0], shots: crossScene, assets: ASSETS,
      styleReferenceUrl: IMG(9), consistency: "identity",
    });
    expect(plan.reason).toBe("identity-reference");
    expect(media).toEqual({ referenceImageUrls: ["https://cdn.test/portrait.png", IMG(9)] });
    expect(media.imageUrl).toBeUndefined();
    expect(media.lastFrameUrl).toBeUndefined();
  });

  it("跨场景 + chain → 仍只给首帧（不引入参考图）", () => {
    const { media } = planShotVideoMedia({
      shot: crossScene[0], shots: crossScene, assets: ASSETS,
      styleReferenceUrl: IMG(9), consistency: "chain",
    });
    expect(media).toEqual({ imageUrl: IMG(0) });
  });

  it("用户手动双帧优先，忽略同场景自动尾帧", () => {
    const manual = [
      mkShot("s0", 0, "scene_a", { useDualFrame: true, lastFrameUrl: "https://cdn.test/manual.png" }),
      mkShot("s1", 1, "scene_a"),
    ];
    const { plan, media } = planShotVideoMedia({
      shot: manual[0], shots: manual, assets: ASSETS,
      styleReferenceUrl: IMG(9), consistency: "identity",
    });
    expect(plan.reason).toBe("manual-tail");
    expect(media).toEqual({ imageUrl: IMG(0), lastFrameUrl: "https://cdn.test/manual.png" });
  });

  it("末镜没有下一镜：identity 策略下改走参考图", () => {
    const { media } = planShotVideoMedia({
      shot: sameScene[1], shots: sameScene, assets: ASSETS,
      styleReferenceUrl: IMG(9), consistency: "identity",
    });
    expect(media.imageUrl).toBeUndefined();
    expect(media.referenceImageUrls).toEqual(["https://cdn.test/portrait.png", IMG(9)]);
  });
});
