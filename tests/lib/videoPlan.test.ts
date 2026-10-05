// ────────────────────────────────────────────────────────────────────────────
// tests/lib/videoPlan.test.ts
// 视频一致性策略单测。断言来自 src/lib/videoPlan.ts 真实实现。
// 关键不变量：reference 与 first_frame / last_frame 永不同时给出
// （服务端实测 400「首尾帧素材与参考素材不能同时使用」）；
// chain 的方向是「后镜首帧取前镜末帧」，自动路径不产生任何尾帧。
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
const TAIL = (id: string) => `https://cdn.test/tail_${id}.png`;

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
    shotSize: "medium",
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
      autoFirstFrameUrl: IMG(2),
      consistency: "chain",
    });
    expect(plan).toMatchObject({
      mode: "keyframe", firstFrameUrl: IMG(1),
      lastFrameUrl: "https://cdn.test/manual.png", reason: "manual-tail",
    });
    expectExclusive(plan);
  });

  it("off 策略完全不引入前镜末帧", () => {
    const plan = planShotVideo({ shot: shot(), autoFirstFrameUrl: IMG(2), consistency: "off" });
    expect(plan).toMatchObject({ mode: "keyframe", reason: "first-frame-only" });
    expect(plan.firstFrameUrl).toBe(IMG(1));
    expect(plan.lastFrameUrl).toBeUndefined();
  });

  it("identity 只在拿不到衔接首帧时生效，且不带任何帧素材", () => {
    const refs = [IMG(9), IMG(8)];
    const withHandoff = planShotVideo({
      shot: shot(), autoFirstFrameUrl: IMG(2), consistency: "identity", identityReferences: refs,
    });
    expect(withHandoff.reason).toBe("auto-handoff");

    const crossScene = planShotVideo({
      shot: shot(), autoFirstFrameUrl: undefined, consistency: "identity", identityReferences: refs,
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

describe("planShotVideo：前镜末帧衔接", () => {
  it("有前镜末帧且 consistency 非 off → keyframe 首帧用前镜末帧，不带尾帧", () => {
    const plan = planShotVideo({
      shot: { imageUrl: "https://cdn.test/self.png", useDualFrame: false, lastFrameUrl: undefined },
      autoFirstFrameUrl: "https://cdn.test/prev_tail.png",
      consistency: "chain",
    });
    expect(plan).toEqual({
      mode: "keyframe",
      firstFrameUrl: "https://cdn.test/prev_tail.png",
      referenceImageUrls: [],
      reason: "auto-handoff",
    });
  });

  it("consistency=off 时忽略前镜末帧，退回仅锁本镜首帧", () => {
    const plan = planShotVideo({
      shot: { imageUrl: "https://cdn.test/self.png", useDualFrame: false, lastFrameUrl: undefined },
      autoFirstFrameUrl: "https://cdn.test/prev_tail.png",
      consistency: "off",
    });
    expect(plan.reason).toBe("first-frame-only");
    expect(plan.firstFrameUrl).toBe("https://cdn.test/self.png");
  });

  it("用户手动尾帧永远优先于自动衔接", () => {
    const plan = planShotVideo({
      shot: {
        imageUrl: "https://cdn.test/self.png",
        useDualFrame: true,
        lastFrameUrl: "https://cdn.test/manual.png",
      },
      autoFirstFrameUrl: "https://cdn.test/prev_tail.png",
      consistency: "chain",
    });
    expect(plan.reason).toBe("manual-tail");
    expect(plan.lastFrameUrl).toBe("https://cdn.test/manual.png");
  });

  it("衔接与身份参考互斥：有末帧时不走 reference", () => {
    const plan = planShotVideo({
      shot: { imageUrl: "https://cdn.test/self.png", useDualFrame: false, lastFrameUrl: undefined },
      autoFirstFrameUrl: "https://cdn.test/prev_tail.png",
      consistency: "identity",
      identityReferences: ["https://cdn.test/portrait.png"],
    });
    expect(plan.mode).toBe("keyframe");
    expect(plan.referenceImageUrls).toEqual([]);
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

  it("同场景相邻镜头 + 有前镜末帧 → 首帧换成前镜末帧，不带尾帧也不带参考图", () => {
    const { plan, media } = planShotVideoMedia({
      shot: sameScene[1], shots: sameScene, assets: ASSETS,
      styleReferenceUrl: IMG(9), consistency: "chain",
      tailFrames: { s0: TAIL("s0") },
    });
    expect(plan.reason).toBe("auto-handoff");
    expect(media).toEqual({ imageUrl: TAIL("s0") });
  });

  it("衔接末帧是浏览器 blob 地址时，改用本镜公网画面图", () => {
    const { plan, media } = planShotVideoMedia({
      shot: sameScene[1], shots: sameScene, assets: ASSETS,
      styleReferenceUrl: IMG(9), consistency: "chain",
      tailFrames: { s0: "blob:http://127.0.0.1/tail-frame" },
    });
    expect(plan.reason).toBe("first-frame-only");
    expect(media).toEqual({ imageUrl: IMG(1) });
  });

  it("衔接判定通过但末帧还没抽出来 → 自动降级为仅锁本镜首帧", () => {
    const { plan, media } = planShotVideoMedia({
      shot: sameScene[1], shots: sameScene, assets: ASSETS,
      styleReferenceUrl: IMG(9), consistency: "chain",
      tailFrames: {},
    });
    expect(plan.reason).toBe("first-frame-only");
    expect(media).toEqual({ imageUrl: IMG(1) });
  });

  it("自动路径永不产生尾帧：同场景两镜带末帧请求都不含 lastFrameUrl", () => {
    const tailFrames = { s0: TAIL("s0") };
    for (const shotItem of sameScene) {
      const { media } = planShotVideoMedia({
        shot: shotItem, shots: sameScene, assets: ASSETS,
        styleReferenceUrl: IMG(9), consistency: "chain", tailFrames,
      });
      expect(media.lastFrameUrl).toBeUndefined();
    }
  });

  it("景别跨两档时不衔接（即使末帧已就绪）", () => {
    const gapScene = [
      mkShot("s0", 0, "scene_a", { shotSize: "wide" }),
      mkShot("s1", 1, "scene_a", { shotSize: "close-up" }),
    ];
    const { plan } = planShotVideoMedia({
      shot: gapScene[1], shots: gapScene, assets: ASSETS,
      styleReferenceUrl: IMG(9), consistency: "chain",
      tailFrames: { s0: TAIL("s0") },
    });
    expect(plan.reason).toBe("first-frame-only");
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

  it("用户手动双帧优先，忽略前镜末帧衔接", () => {
    const manual = [
      mkShot("s0", 0, "scene_a"),
      mkShot("s1", 1, "scene_a", {
        useDualFrame: true, lastFrameUrl: "https://cdn.test/manual.png",
      }),
    ];
    const { plan, media } = planShotVideoMedia({
      shot: manual[1], shots: manual, assets: ASSETS,
      styleReferenceUrl: IMG(9), consistency: "identity",
      tailFrames: { s0: TAIL("s0") },
    });
    expect(plan.reason).toBe("manual-tail");
    expect(media).toEqual({ imageUrl: IMG(1), lastFrameUrl: "https://cdn.test/manual.png" });
  });

  it("首镜没有上一镜：identity 策略下改走参考图", () => {
    const { media } = planShotVideoMedia({
      shot: sameScene[0], shots: sameScene, assets: ASSETS,
      styleReferenceUrl: IMG(9), consistency: "identity",
    });
    expect(media.imageUrl).toBeUndefined();
    expect(media.referenceImageUrls).toEqual(["https://cdn.test/portrait.png", IMG(9)]);
  });
});
