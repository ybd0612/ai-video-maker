// ────────────────────────────────────────────────────────────────────────────
// tests/lib/prompt.test.ts
// 提示词相关纯函数单测：资产命名空间、提示词拼装、角色描述注入。
// 三者共同决定最终发给模型的 prompt，出错会直接影响生成质量，因此覆盖较细。
// ────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import type { Asset, Shot } from "@/stores/projectStore";
import {
  generateAssetNamespace,
  generateFullPrompt,
  resolveAssetNamespaces,
} from "@/lib/assetNamespace";
import { composeMotionPrompt, composeVisualPrompt } from "@/lib/promptUtils";
import { injectCharacterDescriptions } from "@/lib/characterUtils";

/** 测试用的最小对象构造器：只声明被测代码真正读取的字段 */
const asShot = (o: Record<string, unknown>) => o as unknown as Shot;
const asAsset = (o: Record<string, unknown>) => o as unknown as Asset;

const hero = asAsset({
  id: "c1",
  type: "character",
  name: "Hero",
  assetNamespace: "[Hero]",
  fullPrompt: "a character named Hero, tall",
  appearancePrompt: "tall with silver hair",
});

const cafe = asAsset({
  id: "s1",
  type: "scene",
  name: "Cafe",
  prompt: "a sunlit cafe",
});

describe("generateAssetNamespace", () => {
  it("英文名首字母大写并包裹方括号", () => {
    expect(generateAssetNamespace("Hero")).toBe("[Hero]");
    expect(generateAssetNamespace("hero")).toBe("[Hero]");
  });

  it("驼峰名按大写字母切分并各自首字母大写", () => {
    expect(generateAssetNamespace("HeroWarrior")).toBe("[HeroWarrior]");
    // 连续大写会被逐个切分：hELLO → h|E|L|L|O
    expect(generateAssetNamespace("hELLO")).toBe("[HELLO]");
  });

  it("全大写名保持原样", () => {
    expect(generateAssetNamespace("HERO")).toBe("[HERO]");
  });

  it("中文名原样保留", () => {
    expect(generateAssetNamespace("安娜")).toBe("[安娜]");
    expect(generateAssetNamespace("小明Ming")).toBe("[小明Ming]");
  });

  it("剔除空格、下划线、连字符等非字母数字字符", () => {
    expect(generateAssetNamespace("hero warrior")).toBe("[Herowarrior]");
    expect(generateAssetNamespace("Hero_A")).toBe("[HeroA]");
    expect(generateAssetNamespace("Alice-2")).toBe("[Alice2]");
  });

  it("空输入返回空命名空间", () => {
    expect(generateAssetNamespace("")).toBe("[]");
    expect(generateAssetNamespace("  ")).toBe("[]");
  });
});

describe("generateFullPrompt", () => {
  it("以固定句式拼接角色名与外观描述", () => {
    expect(generateFullPrompt({ name: "Hero", appearancePrompt: "tall with silver hair" })).toBe(
      "a character named Hero, tall with silver hair",
    );
  });
});

describe("resolveAssetNamespaces", () => {
  it("把角色命名空间替换为完整提示词", () => {
    expect(resolveAssetNamespaces("a [Hero] walks", [hero], [])).toBe(
      "a a character named Hero, tall walks",
    );
  });

  it("替换提示词中出现的每一处占位符", () => {
    expect(resolveAssetNamespaces("[Hero] and [Hero]", [hero], [])).toBe(
      "a character named Hero, tall and a character named Hero, tall",
    );
  });

  it("没有占位符时原样返回", () => {
    expect(resolveAssetNamespaces("nothing here", [hero], [])).toBe("nothing here");
  });

  it("缺少命名空间或完整提示词的资产会被跳过", () => {
    const incomplete = asAsset({ id: "c9", type: "character", name: "Ghost" });
    expect(resolveAssetNamespaces("[Ghost]", [incomplete], [])).toBe("[Ghost]");
  });

  it("命名空间中的正则特殊字符会被转义，不会误伤相似文本", () => {
    const dotted = asAsset({
      id: "c2",
      type: "character",
      name: "X",
      assetNamespace: "[Hero.X]",
      fullPrompt: "DOTTED",
    });
    expect(resolveAssetNamespaces("[Hero.X] vs [HeroXX]", [dotted], [])).toBe(
      "DOTTED vs [HeroXX]",
    );
  });

  it("场景按 id 占位符替换为场景提示词", () => {
    expect(resolveAssetNamespaces("in [s1] today", [], [cafe])).toBe("in a sunlit cafe today");
  });

  it("已知缺陷：场景 id 未做正则转义，含特殊字符的 id 会过度匹配", () => {
    // 源码中场景分支写作 `\\[${scene.id}\\]`，未像角色分支那样转义。
    // 若 id 含 `.`，该点号会作为「任意字符」参与匹配 —— 这里锁定当前行为，
    // 一旦将来补上转义，本用例会失败并提醒同步更新。
    const weirdScene = asAsset({ id: "s.1", type: "scene", name: "S", prompt: "REPLACED" });
    expect(resolveAssetNamespaces("in [sX1] today", [], [weirdScene])).toBe("in REPLACED today");
  });
});

describe("composeVisualPrompt", () => {
  it("优先使用英文 visualPrompt，并去掉首尾空白", () => {
    expect(composeVisualPrompt(asShot({ visualPrompt: "  English prompt  " }))).toBe(
      "English prompt",
    );
  });

  it("visualPrompt 为空时不再从结构化子字段拼出第二套画面提示词", () => {
    const shot = asShot({
      visualPrompt: "   ",
      sceneDesc: "in a cafe",
      detailDesc: "a hat",
    });
    expect(composeVisualPrompt(shot)).toBe("");
  });

  it("结构化子字段不会追加到唯一的 visualPrompt SSOT", () => {
    const shot = asShot({
      visualPrompt: "A woman walks through a cafe",
      sceneDesc: "warm morning light",
      styleDesc: "8k",
    });
    expect(composeVisualPrompt(shot)).toBe("A woman walks through a cafe");
  });

  it("纯空白 visualPrompt 且无子字段时返回空串", () => {
    expect(composeVisualPrompt(asShot({ visualPrompt: "   " }))).toBe("");
  });

  it("visualPrompt 缺失且无子字段时返回空串", () => {
    expect(composeVisualPrompt(asShot({}))).toBe("");
  });
});

describe("composeMotionPrompt", () => {
  it("优先使用英文 motionPrompt", () => {
    expect(composeMotionPrompt(asShot({ motionPrompt: "  camera pans  " }))).toBe("camera pans");
  });

  it("缺少 motionPrompt 时不再从结构化动态字段拼出第二套运动提示词", () => {
    const shot = asShot({ actionDesc: "turns", cameraDesc: "dolly in" });
    expect(composeMotionPrompt(shot)).toBe("");
  });

  it("结构化动态字段不会追加到唯一的 motionPrompt SSOT", () => {
    const shot = asShot({ motionPrompt: "The subject walks", actionDesc: "turns slowly" });
    expect(composeMotionPrompt(shot)).toBe("The subject walks");
  });

  it("全部缺失时返回空串", () => {
    expect(composeMotionPrompt(asShot({}))).toBe("");
  });
});

describe("injectCharacterDescriptions", () => {
  it("把启用角色的外观描述前置到画面提示词", () => {
    expect(injectCharacterDescriptions("walks down the street", ["c1"], [hero])).toBe(
      "tall with silver hair. walks down the street",
    );
  });

  it("多个角色用分号连接，保持入参顺序", () => {
    const other = asAsset({
      id: "c2",
      type: "character",
      name: "Mage",
      appearancePrompt: "wearing a blue robe",
    });
    expect(injectCharacterDescriptions("meets", ["c1", "c2"], [hero, other])).toBe(
      "tall with silver hair; wearing a blue robe. meets",
    );
  });

  it("无启用角色或无资产时原样返回", () => {
    expect(injectCharacterDescriptions("prompt", [], [hero])).toBe("prompt");
    expect(injectCharacterDescriptions("prompt", ["c1"], [])).toBe("prompt");
  });

  it("找不到对应 id 时原样返回", () => {
    expect(injectCharacterDescriptions("prompt", ["missing"], [hero])).toBe("prompt");
  });

  it("id 命中但类型不是 character 时忽略（避免把场景描述当角色注入）", () => {
    expect(injectCharacterDescriptions("prompt", ["s1"], [cafe])).toBe("prompt");
  });

  it("外观描述为空或纯空白的角色被忽略", () => {
    const blank = asAsset({ id: "c3", type: "character", name: "Blank", appearancePrompt: "   " });
    expect(injectCharacterDescriptions("prompt", ["c3"], [blank])).toBe("prompt");
  });
});
