// ────────────────────────────────────────────────────────────────────────────
// tests/services/scriptService.test.ts
// 视觉方向纯函数单测（不触网）：
// - parseVisualDirection：details 结构化写法 / 旧平铺写法 / 非法 JSON
// - applyVisualDirectionRewrite：非空重写字段覆盖，空字段保留原值
// 断言来自 src/services/scriptService.ts 真实实现。
// ────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import {
  applyVisualDirectionRewrite,
  parseVisualDirection,
  type RawVisualDirection,
} from "@/services/scriptService";

const BASE_DIRECTION: RawVisualDirection = {
  name: "温暖治愈 3D 动画风",
  description: "柔和暖色的动画视觉",
  details: {
    kind: "style",
    mediumMaterial: "柔和 3D 动画",
    colorPalette: "金黄与暖橙",
    lightingMood: "柔和夕阳光",
    cameraTexture: "浅景深",
    composition: "平视留白",
    emotion: "温暖治愈",
  },
  mediumMaterial: "柔和 3D 动画",
  colorPalette: "金黄与暖橙",
  lightingMood: "柔和夕阳光",
  cameraTexture: "浅景深",
  composition: "平视留白",
  emotion: "温暖治愈",
};

describe("parseVisualDirection", () => {
  it("解析结构化 details 写法，并同步平铺字段", () => {
    const parsed = parseVisualDirection(
      JSON.stringify({
        name: "n",
        description: "d",
        details: {
          mediumMaterial: "m",
          colorPalette: "c",
          lightingMood: "l",
          cameraTexture: "cam",
          composition: "comp",
          emotion: "e",
        },
      }),
    );

    expect(parsed?.details).toEqual({
      kind: "style",
      mediumMaterial: "m",
      colorPalette: "c",
      lightingMood: "l",
      cameraTexture: "cam",
      composition: "comp",
      emotion: "e",
    });
    expect(parsed?.composition).toBe("comp");
  });

  it("兼容旧平铺 6 字段写法：物化 details", () => {
    const parsed = parseVisualDirection(
      JSON.stringify({ name: "n", mediumMaterial: "m", colorPalette: "c" }),
    );

    expect(parsed?.details.kind).toBe("style");
    expect(parsed?.details.mediumMaterial).toBe("m");
    expect(parsed?.details.colorPalette).toBe("c");
    expect(parsed?.details.lightingMood).toBe("");
  });

  it("description 缺失时回落到 name；非法 JSON 返回 null", () => {
    expect(parseVisualDirection(JSON.stringify({ name: "n" }))?.description).toBe("n");
    expect(parseVisualDirection("完全不是 JSON")).toBeNull();
  });
});

describe("applyVisualDirectionRewrite", () => {
  it("只采用非空重写字段，空字段保留原值", () => {
    const next = applyVisualDirectionRewrite(BASE_DIRECTION, {
      details: {
        kind: "style",
        mediumMaterial: "扁平插画",
        colorPalette: "",
        lightingMood: "  ",
        cameraTexture: "",
        composition: "",
        emotion: "",
      },
    });

    expect(next.details.mediumMaterial).toBe("扁平插画");
    expect(next.details.colorPalette).toBe("金黄与暖橙");
    expect(next.details.lightingMood).toBe("柔和夕阳光");
    expect(next.details.emotion).toBe("温暖治愈");
  });

  it("name / description 也按非空覆盖", () => {
    const next = applyVisualDirectionRewrite(BASE_DIRECTION, {
      name: "新方向名",
      description: "",
    });

    expect(next.name).toBe("新方向名");
    expect(next.description).toBe("柔和暖色的动画视觉");
  });

  it("兼容旧平铺写法的重写结果", () => {
    const next = applyVisualDirectionRewrite(BASE_DIRECTION, {
      mediumMaterial: "水彩",
      composition: "对称留白",
    });

    expect(next.details.mediumMaterial).toBe("水彩");
    expect(next.details.composition).toBe("对称留白");
    expect(next.mediumMaterial).toBe("水彩");
  });
});
