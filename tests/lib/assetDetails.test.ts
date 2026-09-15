import { describe, expect, it } from "vitest";
import {
  composeAssetDescription,
  composeDetailsText,
  createDefaultAssetDetails,
  detailEntries,
  mergeDetailsPreferDerived,
  normalizeAssetDetails,
} from "@/lib/assetDetails";

describe("detailEntries / composeDetailsText", () => {
  const character = createDefaultAssetDetails({
    type: "character",
    description: "小猪主角\n物种：猪\n身份：故事主角\n年龄：幼年\n性格：憨厚\n外貌：圆润粉色\n服饰：红围巾\n记忆点：卷尾巴\n背景：生活在麦田旁",
  });

  it("detailEntries 剔除内部字段 kind，保留字段顺序与原值", () => {
    const entries = detailEntries(character);
    expect(entries[0]).toEqual(["species", "猪"]);
    expect(entries.some(([key]) => key === "kind")).toBe(false);
  });

  it("composeDetailsText 输出「字段名: 值」多行文本并剔除空值；details 为空时返回空串", () => {
    const text = composeDetailsText(character);
    expect(text).toContain("species: 猪");
    expect(text).not.toContain("kind:");

    const partial = { kind: "character" as const, species: "兔", role: "", age: "" };
    expect(composeDetailsText(partial)).toBe("species: 兔");
    expect(composeDetailsText(undefined)).toBe("");
  });

  it("composeAssetDescription 单行拼 summary + 结构化字段；无 details 回落原始 description", () => {
    const asset = {
      description: "一只贪玩好奇的粉色小猪。",
      details: character,
    };
    const line = composeAssetDescription(asset);
    expect(line).toContain("一只贪玩好奇的粉色小猪。");
    expect(line).toContain("species: 猪");
    expect(line).not.toContain("\n");

    expect(composeAssetDescription({ description: "旧数据一句话", details: undefined })).toBe(
      "旧数据一句话",
    );
  });
});

describe("mergeDetailsPreferDerived", () => {
  it("描述解析值优先，旧 details 只补空字段（AI 指令改写后保存的合并语义）", () => {
    const merged = mergeDetailsPreferDerived(
      { type: "character", description: "新描述的小猪\n物种：猪\n性格：好奇勇敢" },
      { kind: "character", species: "旧物种", role: "旧身份", personality: "旧性格", age: "", appearance: "", outfit: "", signature: "", background: "" },
    );
    expect(merged).toMatchObject({
      kind: "character",
      species: "猪",
      personality: "好奇勇敢",
      role: "旧身份", // 描述里没写，用旧值补
    });
  });

  it("kind 不一致的旧 details 不参与补空；无描述派生能力时返回 undefined", () => {
    const merged = mergeDetailsPreferDerived(
      { type: "character", description: "物种：兔" },
      { kind: "scene", settingType: "x", environment: "", time: "", weather: "", elements: "", spatialLayers: "", lighting: "", paletteMood: "", storyUse: "" } as never,
    );
    expect(merged?.species).toBe("兔");

    expect(mergeDetailsPreferDerived({ type: "style", description: "" }, undefined)).toBeDefined();
  });
});

describe("asset details", () => {
  it("parses legacy labeled character descriptions into the eight fields", () => {
    const details = createDefaultAssetDetails({
      type: "character",
      description: "小猪主角\n物种：猪\n身份：故事主角\n年龄：幼年\n性格：憨厚\n外貌：圆润粉色\n服饰：红围巾\n记忆点：卷尾巴\n背景：生活在麦田旁",
    });
    expect(details).toMatchObject({
      kind: "character",
      species: "猪",
      outfit: "红围巾",
      signature: "卷尾巴",
      background: "生活在麦田旁",
    });
  });

  it("keeps valid generated details while filling missing fields", () => {
    const details = normalizeAssetDetails(
      { type: "product", description: "一盏台灯" },
      { kind: "product", category: "台灯", purpose: "照明", silhouette: "", dimensions: "", color: "", material: "", structure: "", surfaceDetails: "", branding: "", signature: "", usageState: "" },
    );
    expect(details?.kind).toBe("product");
    expect(details?.category).toBe("台灯");
  });

  it("materializes style details from a labeled visual-direction description", () => {
    const description = "温暖治愈 3D 动画风\n画风：柔和 3D 动画渲染\n主色调：金黄与暖橙\n光影：柔和夕阳光\n镜头：浅景深\n构图：平视留白\n情绪：温暖治愈";
    const expected = {
      kind: "style",
      mediumMaterial: "柔和 3D 动画渲染",
      colorPalette: "金黄与暖橙",
      lightingMood: "柔和夕阳光",
      cameraTexture: "浅景深",
      composition: "平视留白",
      emotion: "温暖治愈",
    };
    expect(createDefaultAssetDetails({ type: "style", description })).toEqual(expected);
    // style 资产物化路径：无 incoming 时与描述派生结果一致
    expect(normalizeAssetDetails({ type: "style", description }, undefined)).toEqual(expected);
  });

  it("style 描述不含标签时六个维度为空串，kind 仍为 style", () => {
    expect(createDefaultAssetDetails({ type: "style", description: "温暖治愈动画风" })).toEqual({
      kind: "style",
      mediumMaterial: "",
      colorPalette: "",
      lightingMood: "",
      cameraTexture: "",
      composition: "",
      emotion: "",
    });
  });

  it("style 归一化在新旧 kind 不匹配时回落到描述派生的默认值", () => {
    const details = normalizeAssetDetails(
      { type: "style", description: "画风：水彩插画" },
      { kind: "scene", settingType: "", environment: "", time: "", weather: "", elements: "", spatialLayers: "", lighting: "", paletteMood: "", storyUse: "" },
    );
    expect(details).toMatchObject({ kind: "style", mediumMaterial: "水彩插画" });
  });
});
