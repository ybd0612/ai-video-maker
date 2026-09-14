import { describe, expect, it } from "vitest";
import { createDefaultAssetDetails, normalizeAssetDetails } from "@/lib/assetDetails";

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
});
