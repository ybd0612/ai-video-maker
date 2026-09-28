// ────────────────────────────────────────────────────────────────────────────
// tests/stores/projectStore.test.ts
// applyShotUpdates / applyAssetUpdate 的纯函数单测：验证局部失效与生成结果写回
// 不依赖 Zustand、localStorage 或浏览器环境。
// ────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import type { Asset, Project, Shot } from "@/stores/projectStore";
import { applyAssetUpdate, applyShotUpdates } from "@/stores/projectStore";
import {
  hasAnyField,
  MOTION_SHOT_FIELDS,
  STORYBOARD_SHOT_FIELDS,
  VISUAL_SHOT_FIELDS,
} from "@/stores/projectOps";

function makeShot(id: string, overrides: Partial<Shot> = {}): Shot {
  return {
    id,
    index: 0,
    scriptText: "A shot",
    visualPrompt: "A visual prompt",
    motionPrompt: "A motion prompt",
    dialogues: [],
    activeCharacterIds: [],
    activeProductIds: [],
    activePropIds: [],
    duration: 5,
    status: "videoed",
    imageUrl: `https://img.test/${id}.png`,
    videoUrl: `https://video.test/${id}.mp4`,
    videoProgress: 100,
    videoRetryCount: 2,
    useDualFrame: false,
    ...overrides,
  };
}

function makeAsset(
  id: string,
  type: Asset["type"],
  overrides: Partial<Asset> = {},
): Asset {
  return {
    id,
    type,
    name: id,
    description: "asset description",
    prompt: "asset prompt",
    imageUrl: `https://img.test/${id}.png`,
    ...overrides,
  };
}

function makeProject(assets: Asset[], shots: Shot[]): Project {
  return {
    id: "project_1",
    title: "Test project",
    wizardStep: 5,
    automationMode: "semi-auto",
    assets,
    aspectRatio: "16:9",
    style: "cinematic",
    language: "en",
    shots,
    status: "idle",
    assetsReviewed: true,
    storyboardReviewed: true,
    imagesReviewed: true,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("applyShotUpdates", () => {
  it("画面字段变化只使当前镜头图片和视频失效", () => {
    const shot = makeShot("shot_1");

    const next = applyShotUpdates(shot, { visualPrompt: "Updated visual prompt" });

    expect(next.visualPrompt).toBe("Updated visual prompt");
    expect(next.imageUrl).toBeUndefined();
    expect(next.videoUrl).toBeUndefined();
    expect(next.videoProgress).toBeUndefined();
    expect(next.videoRetryCount).toBeUndefined();
    expect(next.status).toBe("scripted");
    expect(next.error).toBeUndefined();
  });

  it("动态字段变化保留图片，只使视频失效", () => {
    const shot = makeShot("shot_1");

    const next = applyShotUpdates(shot, { cameraDesc: "Slow dolly in" });

    expect(next.imageUrl).toBe("https://img.test/shot_1.png");
    expect(next.videoUrl).toBeUndefined();
    expect(next.videoProgress).toBeUndefined();
    expect(next.videoRetryCount).toBeUndefined();
    expect(next.status).toBe("imaged");
  });

  it("生成器写入新图片时清理旧视频，但不再次清空新图片", () => {
    const shot = makeShot("shot_1");

    const next = applyShotUpdates(shot, {
      imageUrl: "https://img.test/new.png",
      status: "imaged",
    });

    expect(next.imageUrl).toBe("https://img.test/new.png");
    expect(next.videoUrl).toBeUndefined();
    expect(next.status).toBe("imaged");
  });

  it("生成器写入新视频时清理运行时进度字段", () => {
    const shot = makeShot("shot_1", { status: "videoing", videoProgress: 72, videoRetryCount: 1 });

    const next = applyShotUpdates(shot, {
      videoUrl: "https://video.test/new.mp4",
      status: "videoed",
    });

    expect(next.imageUrl).toBe("https://img.test/shot_1.png");
    expect(next.videoUrl).toBe("https://video.test/new.mp4");
    expect(next.videoProgress).toBeUndefined();
    expect(next.videoRetryCount).toBeUndefined();
    expect(next.status).toBe("videoed");
  });

  it("旧数据缺少脚本和引用数组时，画面更新不会抛错", () => {
    const legacyShot = makeShot("legacy", {
      scriptText: undefined as unknown as string,
      activeCharacterIds: undefined as unknown as string[],
      activeProductIds: undefined as unknown as string[],
      activePropIds: undefined as unknown as string[],
    });

    expect(() => applyShotUpdates(legacyShot, { activePropIds: ["prop_1"] })).not.toThrow();
    expect(applyShotUpdates(legacyShot, { activePropIds: ["prop_1"] }).status).toBe("idle");
  });
});

describe("applyAssetUpdate", () => {
  it("只使引用该资产的镜头失效，并重置审核状态", () => {
    const character = makeAsset("char_1", "character");
    const otherCharacter = makeAsset("char_2", "character");
    const affected = makeShot("affected", { activeCharacterIds: [character.id] });
    const unaffected = makeShot("unaffected", { activeCharacterIds: [otherCharacter.id] });
    const project = makeProject([character, otherCharacter], [affected, unaffected]);

    const next = applyAssetUpdate(project, character.id, { description: "updated description" });

    expect(next.assetsReviewed).toBe(false);
    expect(next.storyboardReviewed).toBe(false);
    expect(next.imagesReviewed).toBe(false);
    expect(next.shots[0].imageUrl).toBeUndefined();
    expect(next.shots[0].videoUrl).toBeUndefined();
    expect(next.shots[0].status).toBe("scripted");
    expect(next.shots[1].imageUrl).toBe(unaffected.imageUrl);
    expect(next.shots[1].videoUrl).toBe(unaffected.videoUrl);
  });

  it("场景、产品和道具引用都会参与局部失效", () => {
    const scene = makeAsset("scene_1", "scene");
    const product = makeAsset("product_1", "product");
    const prop = makeAsset("prop_1", "prop");
    const sceneShot = makeShot("scene-shot", { activeSceneId: scene.id });
    const productShot = makeShot("product-shot", { activeProductIds: [product.id] });
    const propShot = makeShot("prop-shot", { activePropIds: [prop.id] });
    const project = makeProject([scene, product, prop], [sceneShot, productShot, propShot]);

    const sceneUpdated = applyAssetUpdate(project, scene.id, { imageUrl: "https://img.test/scene-new.png" });
    const productUpdated = applyAssetUpdate(project, product.id, { prompt: "new product prompt" });
    const propUpdated = applyAssetUpdate(project, prop.id, { name: "new prop name" });

    expect(sceneUpdated.shots[0].imageUrl).toBeUndefined();
    expect(productUpdated.shots[1].imageUrl).toBeUndefined();
    expect(propUpdated.shots[2].imageUrl).toBeUndefined();
  });

  it("风格资产是项目级锚点，修改后使所有镜头失效", () => {
    const style = makeAsset("style_1", "style");
    const shotA = makeShot("shot-a");
    const shotB = makeShot("shot-b");
    const project = makeProject([style], [shotA, shotB]);

    const next = applyAssetUpdate(project, style.id, { prompt: "new visual direction" });

    expect(next.shots.every((shot) => !shot.imageUrl && !shot.videoUrl)).toBe(true);
    expect(next.shots.every((shot) => shot.status === "scripted")).toBe(true);
  });

  it("不存在的资产 ID 不修改项目引用", () => {
    const shot = makeShot("shot_1");
    const project = makeProject([makeAsset("char_1", "character")], [shot]);

    expect(applyAssetUpdate(project, "missing", { description: "ignored" })).toBe(project);
  });
});

describe("运行时字段分档（问题 2）", () => {
  it("只勾双帧开关不清空已生成视频，也不回退状态", () => {
    const shot = makeShot("shot_1");

    const next = applyShotUpdates(shot, { useDualFrame: true });

    expect(next.useDualFrame).toBe(true);
    expect(next.videoUrl).toBe("https://video.test/shot_1.mp4");
    expect(next.videoProgress).toBe(100);
    expect(next.videoRetryCount).toBe(2);
    expect(next.status).toBe("videoed");
  });

  it("只写尾帧/首帧 URL（运行时字段）不清空视频", () => {
    const shot = makeShot("shot_1");

    const withTail = applyShotUpdates(shot, { lastFrameUrl: "https://img.test/tail.png" });
    const withFirst = applyShotUpdates(shot, { firstFrameUrl: "https://img.test/first.png" });

    expect(withTail.videoUrl).toBe("https://video.test/shot_1.mp4");
    expect(withTail.status).toBe("videoed");
    expect(withFirst.videoUrl).toBe("https://video.test/shot_1.mp4");
    expect(withFirst.status).toBe("videoed");
  });

  it("运行时字段不入 STORYBOARD_SHOT_FIELDS；内容型运动字段仍入（既有防线不丢）", () => {
    // 运行时字段：不回收分镜审核位
    expect(hasAnyField({ useDualFrame: true }, STORYBOARD_SHOT_FIELDS)).toBe(false);
    expect(hasAnyField({ lastFrameUrl: "x" }, STORYBOARD_SHOT_FIELDS)).toBe(false);
    expect(hasAnyField({ firstFrameUrl: "x" }, STORYBOARD_SHOT_FIELDS)).toBe(false);
    // 内容型运动字段：改了仍必须重新审核
    expect(hasAnyField({ motionPrompt: "x" }, STORYBOARD_SHOT_FIELDS)).toBe(true);
    expect(hasAnyField({ duration: 8 }, STORYBOARD_SHOT_FIELDS)).toBe(true);
    expect(hasAnyField({ actionDesc: "x" }, STORYBOARD_SHOT_FIELDS)).toBe(true);
    expect(hasAnyField({ cameraDesc: "x" }, STORYBOARD_SHOT_FIELDS)).toBe(true);
    expect(hasAnyField({ endStateDesc: "x" }, STORYBOARD_SHOT_FIELDS)).toBe(true);
    // 且它们不属于 VISUAL_SHOT_FIELDS（不回收图片审核位）
    expect(hasAnyField({ motionPrompt: "x" }, VISUAL_SHOT_FIELDS)).toBe(false);
    // MOTION_SHOT_FIELDS 现在只含内容型运动字段
    expect(MOTION_SHOT_FIELDS).toContain("motionPrompt");
    expect(MOTION_SHOT_FIELDS).toContain("duration");
    expect(MOTION_SHOT_FIELDS).not.toContain("useDualFrame");
    expect(MOTION_SHOT_FIELDS).not.toContain("lastFrameUrl");
    expect(MOTION_SHOT_FIELDS).not.toContain("firstFrameUrl");
  });

  it("真改内容型运动字段仍使已生成视频失效（不得因分档而丢失）", () => {
    const shot = makeShot("shot_1");

    const next = applyShotUpdates(shot, { motionPrompt: "New motion" });

    expect(next.videoUrl).toBeUndefined();
    expect(next.status).toBe("imaged");
  });

  it("改止态按内容型运动档处理：视频重做、图片保留（双帧方案 E）", () => {
    const shot = makeShot("shot_1");

    const next = applyShotUpdates(shot, { endStateDesc: "门完全打开，小猫停在门槛上" });

    expect(next.videoUrl).toBeUndefined();
    expect(next.status).toBe("imaged");
    expect(next.imageUrl).toBe(shot.imageUrl);
  });
});
