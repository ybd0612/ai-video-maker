// ────────────────────────────────────────────────────────────────────────────
// tests/lib/promptComposer.edge.test.ts
// promptComposer 边界补测（QA 第 1 轮）：
// - pickShotReferences：场景图 = 风格图（同 URL）去重、命中场景无图回退、
//   全部为空的退化、4 个非风格来源齐全时 cap=2 语义
// - composePortraitPrompt：物种探测边界（含关键词的复合词 / 空白首句）
// ────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import type { Asset, Shot } from "@/stores/projectStore";
import {
  composePortraitPrompt,
  pickShotReferences,
} from "@/lib/promptComposer";

/* ── 测试数据工厂（与 promptComposer.test.ts 同构） ───────────────────────── */

function makeAsset(
  overrides: Partial<Asset> & Pick<Asset, "id" | "type" | "name">,
): Asset {
  return { description: "", prompt: "", ...overrides };
}

function makeShot(overrides: Partial<Shot> = {}): Shot {
  return {
    id: "shot_1",
    index: 0,
    scriptText: "",
    visualPrompt: "",
    motionPrompt: "",
    dialogues: [],
    activeCharacterIds: [],
    duration: 5,
    status: "scripted",
    useDualFrame: false,
    ...overrides,
  };
}

const STYLE_URL = "http://img/style.png";

function styleAsset(url: string | undefined): Asset {
  return makeAsset({
    id: "style_1",
    type: "style",
    name: "整体风格",
    ...(url ? { imageUrl: url } : {}),
  });
}

/* ── pickShotReferences 边界 ─────────────────────────────────────────────── */

describe("pickShotReferences 边界", () => {
  it("场景图与风格图同 URL 也不进入分镜参考图", () => {
    const scene = makeAsset({
      id: "scene_1",
      type: "scene",
      name: "Forest",
      imageUrl: STYLE_URL, // 与风格图同 URL
    });
    const project = { assets: [scene, styleAsset(STYLE_URL)], styleReferenceUrl: undefined };
    const shot = makeShot({ sceneDesc: "in the Forest" });

    const refs = pickShotReferences(shot, project);
    expect(refs).toEqual([]);
  });

  it("旧字段风格图也不作为分镜参考图", () => {
    const scene = makeAsset({
      id: "scene_1",
      type: "scene",
      name: "Forest",
      imageUrl: STYLE_URL,
    });
    const project = { assets: [scene], styleReferenceUrl: STYLE_URL };
    const refs = pickShotReferences(makeShot({ sceneDesc: "Forest" }), project);
    expect(refs).toEqual([]);
  });

  it("sceneDesc 命中的场景无图时仍不回退场景参考图", () => {
    const namedNoImage = makeAsset({
      id: "scene_a",
      type: "scene",
      name: "Forest",
      // 无 imageUrl
    });
    const other = makeAsset({
      id: "scene_b",
      type: "scene",
      name: "Beach",
      imageUrl: "http://img/beach.png",
    });
    const project = {
      assets: [namedNoImage, other, styleAsset(STYLE_URL)],
      styleReferenceUrl: undefined,
    };
    const shot = makeShot({ sceneDesc: "walking in the Forest" });

    expect(pickShotReferences(shot, project)).toEqual([]);
  });

  it("全部为空的退化：无场景/角色/产品/风格图 → 空数组", () => {
    const noImages = { assets: [styleAsset(undefined)], styleReferenceUrl: undefined };
    expect(pickShotReferences(makeShot(), noImages)).toEqual([]);

    expect(pickShotReferences(makeShot(), { assets: [], styleReferenceUrl: undefined })).toEqual([]);
  });

  it("场景图退出后仅取显式角色，避免旧场景回退污染", () => {
    const scene = makeAsset({ id: "s", type: "scene", name: "Forest", imageUrl: "http://img/scene.png" });
    const char1 = makeAsset({ id: "c1", type: "character", name: "A", imageUrl: "http://img/c1.png" });
    const char2 = makeAsset({ id: "c2", type: "character", name: "B", imageUrl: "http://img/c2.png" });
    const product = makeAsset({ id: "p", type: "product", name: "Cup", imageUrl: "http://img/product.png" });
    const project = {
      assets: [scene, char1, char2, product, styleAsset(STYLE_URL)],
      styleReferenceUrl: undefined,
    };
    const shot = makeShot({
      sceneDesc: "Forest",
      activeCharacterIds: ["c1", "c2"],
    });

    const refs = pickShotReferences(shot, project);
    expect(refs).toEqual(["http://img/c1.png", "http://img/c2.png"]);
    expect(refs).toHaveLength(2);
    expect(refs).not.toContain(STYLE_URL);
  });

  it("activeCharacterIds 引用不存在的角色 ID：静默跳过，不抛错", () => {
    const project = { assets: [styleAsset(STYLE_URL)], styleReferenceUrl: undefined };
    const shot = makeShot({ activeCharacterIds: ["ghost_id"] });
    expect(pickShotReferences(shot, project)).toEqual([]);
  });
});

/* ── composePortraitPrompt 物种探测边界 ──────────────────────────────────── */

describe("composePortraitPrompt 物种探测边界", () => {
  it("动物探测按首句兜底：第二句含动物词不影响人物判定路径", () => {
    // 首句无动物词 → 通用锁定；第二句的 rabbit 不触发物种句
    const out = composePortraitPrompt({
      appearancePrompt: "A young woman with a warm smile. She owns a rabbit.",
    });
    expect(out).toContain("主体锁定：严格保留");
    expect(out).not.toContain("这个主体是");
  });

  it("猪角色 → 动物物种锁定 + 猪专属解剖约束（历史事故沉淀）", () => {
    const out = composePortraitPrompt({
      appearancePrompt: "A cute chubby pink piglet with short legs and small ears",
    });
    expect(out).toContain("这个主体是");
    expect(out).toContain("绝不画成人物");
    expect(out).toContain("猪的正常解剖结构");
    expect(out).toContain("四条腿");
    expect(out).not.toContain("所描述动物的正常解剖结构");
  });

  it("产品首句 → 通用锁定（非动物句），且不含人像语汇", () => {
    const out = composePortraitPrompt({
      appearancePrompt: "A sleek product shot of a matte black water bottle",
    });
    expect(out).toContain("主体锁定：严格保留");
    expect(out).not.toContain("这个主体是");
    expect(out).not.toContain("Portrait of");
    expect(out).not.toContain("head and shoulders");
    expect(out).not.toContain("looking at camera");
  });

  it("中文物种词现在生效：「小白兔」拿到动物物种锁定", () => {
    // 旧实现词表只有英文，中文设定一律走通用锁定（原用例锁的是这个缺陷）；
    // 中文化改造后中文物种线索纳入判定，必须走动物物种锁定句。
    const out = composePortraitPrompt({
      appearancePrompt: "一只可爱的小白兔，长耳朵，红眼睛。小兔子很活泼。",
    });
    expect(out).toContain("主体锁定：这个主体是一只可爱的小白兔");
    expect(out).toContain("绝不画成人物");
    expect(out).toContain("全身角色设定图，身份一致，画面干净");
  });
});
