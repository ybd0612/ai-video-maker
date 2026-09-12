// ────────────────────────────────────────────────────────────────────────────
// tests/lib/promptComposer.test.ts
// 提示词拼装器纯函数库的单测。断言来自 src/lib/promptComposer.ts 真实实现。
// ────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import type { Asset, Shot } from "@/stores/projectStore";
import {
  composeTextToImagePrompt,
  composeImageToImagePrompt,
  composeMultiReferencePrompt,
  composePortraitPrompt,
  pickShotReferences,
  getStyleReferenceUrl,
  getStylePrompt,
} from "@/lib/promptComposer";

/* ── 测试数据工厂 ─────────────────────────────────────────────────────────── */

function makeAsset(overrides: Partial<Asset> & Pick<Asset, "id" | "type" | "name">): Asset {
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

/* ── composeTextToImagePrompt：六段式 ──────────────────────────────────────── */

describe("composeTextToImagePrompt", () => {
  it("按 [主体][场景][风格][光照][构图][质量] 顺序输出", () => {
    const out = composeTextToImagePrompt({
      subject: "a young woman",
      scene: "in a cafe",
      style: "anime style",
      lighting: "warm light",
      composition: "wide shot",
      quality: "8k",
    });
    expect(out).toBe("a young woman, in a cafe, anime style, warm light, wide shot, 8k");
  });

  it("空段剔除：仅保留非空段，顺序不乱", () => {
    const out = composeTextToImagePrompt({
      subject: "a red apple",
      scene: undefined,
      style: "  ",
      lighting: "",
      composition: "close-up",
      quality: undefined,
    });
    expect(out).toBe("a red apple, close-up");
  });

  it("全空输入返回空串", () => {
    expect(composeTextToImagePrompt({ subject: "" })).toBe("");
  });
});

/* ── composeImageToImagePrompt ────────────────────────────────────────────── */

describe("composeImageToImagePrompt", () => {
  it("结构为 [改变要求]+[新风格]+[Keep unchanged: 保留主体]", () => {
    const out = composeImageToImagePrompt({
      change: "Render as a clean product reference",
      newStyle: "anime style",
      keep: "a ceramic cup with a blue rim",
    });
    expect(out).toBe(
      "Render as a clean product reference, anime style, Keep unchanged: a ceramic cup with a blue rim",
    );
  });

  it("newStyle 缺省时剔除该段；keep 为空时不产生空的 Keep 段", () => {
    const out = composeImageToImagePrompt({
      change: "change",
      keep: "  ",
    });
    expect(out).toBe("change");
  });
});

/* ── composeMultiReferencePrompt ──────────────────────────────────────────── */

describe("composeMultiReferencePrompt", () => {
  it("参考图说明在前（按 index），目标场景在后，尾部固定图像关系指令", () => {
    const out = composeMultiReferencePrompt({
      references: [
        { index: 1, role: "scene", note: "森林: misty forest" },
        { index: 2, role: "character", note: "小狐狸: a small fox" },
        { index: 3, role: "style", note: "整体风格: anime" },
      ],
      scene: "the fox walks in the forest",
    });
    expect(out).toContain("Image 1 is the scene reference: 森林: misty forest");
    expect(out).toContain("Image 2 is the character reference: 小狐狸: a small fox");
    expect(out).toContain("Image 3 is the style reference: 整体风格: anime");
    expect(out).toContain("Target scene / subject: the fox walks in the forest");
    expect(out).toContain(
      "The reference images only anchor art style, color palette and character identity; do not copy their content or composition.",
    );
    // 顺序：参考图说明 → 目标场景 → 图像关系（末尾）
    const idx1 = out.indexOf("Image 1");
    const idxScene = out.indexOf("Target scene");
    const idxAnchor = out.indexOf("The reference images only anchor");
    expect(idx1).toBeLessThan(idxScene);
    expect(idxScene).toBeLessThan(idxAnchor);
  });

  it("note 为空的参考图被剔除，不产生空说明；style/lighting/composition 空段剔除", () => {
    const out = composeMultiReferencePrompt({
      references: [{ index: 1, role: "scene", note: "  " }],
      scene: "s",
      style: undefined,
      lighting: " ",
      composition: "",
    });
    expect(out).not.toContain("Image 1");
    expect(out).not.toContain("Style:");
    expect(out).not.toContain("Lighting:");
    expect(out).not.toContain("Composition:");
  });
});

/* ── composePortraitPrompt：物种锁定 ──────────────────────────────────────── */

describe("composePortraitPrompt", () => {
  it("动物角色：含物种锁定句（禁止人化），且不含 Portrait of / head and shoulders", () => {
    const out = composePortraitPrompt({
      appearancePrompt: "a small white rabbit with long ears",
    });
    expect(out).toContain("SUBJECT SPECIES LOCK");
    expect(out).toContain("Never render it as a human");
    expect(out).not.toContain("Portrait of");
    expect(out).not.toContain("head and shoulders");
    expect(out).not.toContain("looking at camera");
  });

  it("人物角色：含通用主体锁定句与全身设定尾部", () => {
    const out = composePortraitPrompt({
      appearancePrompt: "a young woman with long dark hair",
    });
    expect(out).toContain("SUBJECT LOCK");
    expect(out).toContain("Full-body character design sheet, consistent identity, clean presentation");
    expect(out).not.toContain("head and shoulders");
  });

  it("stylePrompt 追加在 appearancePrompt 之后、尾部之前", () => {
    const out = composePortraitPrompt({
      appearancePrompt: "a small white rabbit.",
      stylePrompt: "watercolor illustration style",
    });
    expect(out).toContain("a small white rabbit., watercolor illustration style");
    expect(out.indexOf("watercolor")).toBeLessThan(out.indexOf("Full-body character design sheet"));
  });

  it("空 appearancePrompt 不产生空锁定句（无 SUBJECT 字样）", () => {
    const out = composePortraitPrompt({ appearancePrompt: "", stylePrompt: "anime" });
    expect(out).not.toContain("SUBJECT");
    expect(out).toContain("Full-body character design sheet");
  });

  it("产品主体走通用锁定句（非动物物种句）", () => {
    const out = composePortraitPrompt({
      appearancePrompt: "a product shot of a glass bottle",
    });
    expect(out).toContain("SUBJECT LOCK");
    expect(out).not.toContain("SUBJECT SPECIES LOCK");
  });
});

/* ── pickShotReferences ───────────────────────────────────────────────────── */

describe("pickShotReferences", () => {
  const sceneAsset = makeAsset({
    id: "scene_1",
    type: "scene",
    name: "Forest",
    imageUrl: "http://img/scene.png",
  });
  const charAsset = makeAsset({
    id: "char_1",
    type: "character",
    name: "Fox",
    imageUrl: "http://img/char.png",
  });
  const productAsset = makeAsset({
    id: "prod_1",
    type: "product",
    name: "Cup",
    imageUrl: "http://img/product.png",
  });
  const styleAsset = makeAsset({
    id: "style_1",
    type: "style",
    name: "整体风格",
    imageUrl: "http://img/style.png",
  });

  it("顺序：场景 → 角色 → 产品 → 风格（style 恒末位）", () => {
    const project = { assets: [sceneAsset, charAsset, styleAsset], styleReferenceUrl: undefined };
    const shot = makeShot({ sceneDesc: "walking in the Forest", activeCharacterIds: ["char_1"] });
    const refs = pickShotReferences(shot, project);
    expect(refs).toEqual([
      "http://img/scene.png",
      "http://img/char.png",
      "http://img/style.png",
    ]);
  });

  it("风格图恒保留：场景+角色+产品足够填满时，风格图仍在且总数=3（挤掉产品）", () => {
    const project = { assets: [sceneAsset, charAsset, productAsset, styleAsset], styleReferenceUrl: undefined };
    const shot = makeShot({ sceneDesc: "Forest", activeCharacterIds: ["char_1"] });
    const refs = pickShotReferences(shot, project);
    expect(refs).toEqual([
      "http://img/scene.png",
      "http://img/char.png",
      "http://img/style.png",
    ]);
    expect(refs).toHaveLength(3);
    expect(refs[refs.length - 1]).toBe("http://img/style.png");
  });

  it("非风格参考合计最多 2 张：无风格图时产品（低优先级）被舍弃", () => {
    const project = { assets: [sceneAsset, charAsset, productAsset], styleReferenceUrl: undefined };
    const shot = makeShot({ sceneDesc: "walking in the Forest", activeCharacterIds: ["char_1"] });
    expect(pickShotReferences(shot, project)).toEqual([
      "http://img/scene.png",
      "http://img/char.png",
    ]);
  });

  it("去重：同一 URL 只出现一次", () => {
    const dupChar = makeAsset({
      id: "char_dup",
      type: "character",
      name: "Twin",
      imageUrl: "http://img/scene.png", // 与场景图相同 URL
    });
    const project = { assets: [sceneAsset, dupChar, styleAsset], styleReferenceUrl: undefined };
    const shot = makeShot({ sceneDesc: "Forest", activeCharacterIds: ["char_dup", "char_dup"] });
    const refs = pickShotReferences(shot, project);
    expect(refs.filter((u) => u === "http://img/scene.png")).toHaveLength(1);
  });

  it("场景匹配失败时回退首个有图场景", () => {
    const sceneB = makeAsset({ id: "scene_2", type: "scene", name: "Beach", imageUrl: "http://img/beach.png" });
    const project = { assets: [sceneB, styleAsset], styleReferenceUrl: undefined };
    const shot = makeShot({ sceneDesc: "somewhere unrelated" });
    expect(pickShotReferences(shot, project)).toEqual([
      "http://img/beach.png",
      "http://img/style.png",
    ]);
  });

  it("风格图兜底：无场景/角色/产品时只用风格图（旧字段亦可）", () => {
    const project = { assets: [], styleReferenceUrl: "http://img/legacy-style.png" };
    expect(pickShotReferences(makeShot(), project)).toEqual(["http://img/legacy-style.png"]);
  });

  it("角色参考优先 imageUrl，缺图时回退 avatarUrl", () => {
    const avatarChar = makeAsset({
      id: "char_av",
      type: "character",
      name: "Av",
      avatarUrl: "http://img/avatar.png",
    });
    const project = { assets: [avatarChar], styleReferenceUrl: undefined };
    expect(pickShotReferences(makeShot({ activeCharacterIds: ["char_av"] }), project)).toEqual([
      "http://img/avatar.png",
    ]);
  });
});

/* ── getStyleReferenceUrl / getStylePrompt ────────────────────────────────── */

describe("getStyleReferenceUrl", () => {
  it("style 资产 imageUrl 优先，旧字段兜底", () => {
    const project = {
      assets: [makeAsset({ id: "s1", type: "style", name: "style", imageUrl: "http://img/asset-style.png" })],
      styleReferenceUrl: "http://img/legacy.png",
    };
    expect(getStyleReferenceUrl(project)).toBe("http://img/asset-style.png");

    const legacyOnly = { assets: [], styleReferenceUrl: "http://img/legacy.png" };
    expect(getStyleReferenceUrl(legacyOnly)).toBe("http://img/legacy.png");
  });

  it("style 资产无图且无旧字段时返回 undefined", () => {
    const project = { assets: [makeAsset({ id: "s1", type: "style", name: "style" })], styleReferenceUrl: undefined };
    expect(getStyleReferenceUrl(project)).toBeUndefined();
  });
});

describe("getStylePrompt", () => {
  it("返回 style 资产的非空 prompt；无资产或空串返回 undefined", () => {
    const withPrompt = { assets: [makeAsset({ id: "s1", type: "style", name: "style", prompt: "anime, warm tones" })] };
    expect(getStylePrompt(withPrompt)).toBe("anime, warm tones");

    const empty = { assets: [makeAsset({ id: "s1", type: "style", name: "style", prompt: "  " })] };
    expect(getStylePrompt(empty)).toBeUndefined();
    expect(getStylePrompt({ assets: [] })).toBeUndefined();
  });
});
