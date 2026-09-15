import { describe, expect, it } from "vitest";
import {
  createDefaultAssetDetails,
  extractAssetSummary,
  normalizeAssetDetails,
  repairAssetDetails,
  splitAssetDescription,
} from "@/lib/assetDetails";
import type { AssetDetails } from "@/stores/projectStore";

/* ── 2026-09-15 事故回归 ────────────────────────────────────────────────
 * 现象：视觉方向"设定"全空、角色"一句话简介"丢失且简介混进完整设定、
 * 部分字段值带前缀（personality = "与行为倾向：贪玩…"）。
 * 两个根因：
 *   ① normalizeAssetDetails 要求 incoming.kind 严格相等，而模型不返回 kind
 *      → 模型给的整份 details 被丢弃；
 *   ② 用硬编码短标签正则取值，模型改用长标签（性格与行为倾向 / 地理与环境）后
 *      要么不匹配（字段空）要么前缀部分匹配（值被污染）。
 * 下文一律用模板字符串构造多行描述，避免转义拼接易错。
 * ────────────────────────────────────────────────────────────────────── */

describe("splitAssetDescription：结构驱动拆分", () => {
  it("首行作简介，其余按「标签：值」拆分，标签名不受限制", () => {
    const desc = `一只圆润贪玩的小猪仔
物种：猪（幼年小猪仔）
性格与行为倾向：贪玩、好奇心强
前景、中景、背景与空间层次：前景为麦穗特写`;
    const parts = splitAssetDescription(desc);
    expect(parts.summary).toBe("一只圆润贪玩的小猪仔");
    expect(parts.fields).toEqual([
      { label: "物种", value: "猪（幼年小猪仔）" },
      { label: "性格与行为倾向", value: "贪玩、好奇心强" },
      { label: "前景、中景、背景与空间层次", value: "前景为麦穗特写" },
    ]);
  });

  it("值内含冒号时按首个冒号拆分", () => {
    const parts = splitAssetDescription("时间：14:30 黄昏");
    expect(parts.fields).toEqual([{ label: "时间", value: "14:30 黄昏" }]);
  });

  it("自由文本（无字段行）→ 整段作简介", () => {
    const parts = splitAssetDescription("一只安详入睡的小兔子，怀里抱着胡萝卜。");
    expect(parts.summary).toBe("一只安详入睡的小兔子，怀里抱着胡萝卜。");
    expect(parts.fields).toEqual([]);
  });

  it("字段后的无标签行续接到上一字段（模型偶发换行不丢信息）", () => {
    const parts = splitAssetDescription(`物种：小白兔
补一句说明
身份：主角`);
    expect(parts.fields).toEqual([
      { label: "物种", value: "小白兔 补一句说明" },
      { label: "身份", value: "主角" },
    ]);
  });

  it("extractAssetSummary 是所有资产类型统一的简介入口", () => {
    const desc = `金黄麦田在夕阳下铺展
空间类型：户外`;
    expect(extractAssetSummary(desc)).toBe("金黄麦田在夕阳下铺展");
  });

  it("空文本不抛错", () => {
    expect(() => splitAssetDescription("")).not.toThrow();
    expect(splitAssetDescription("").summary).toBe("");
    expect(extractAssetSummary("")).toBe("");
  });
});

describe("长标签别名映射（回归：曾因标签不匹配导致字段空/值被污染）", () => {
  it("角色长标签正确落位，且值不带前缀", () => {
    const desc = `一只小猪仔
物种：猪
身份：主角
年龄：幼年
性格与行为倾向：贪玩好奇
外貌：圆润饱满
服饰与配饰：无服饰
记忆点：卷尾巴
来历与角色关系：乡间长大`;
    const details = createDefaultAssetDetails({ type: "character", description: desc }) as unknown as Record<string, string>;
    expect(details.personality).toBe("贪玩好奇"); // 旧实现为 "与行为倾向：贪玩好奇"
    expect(details.outfit).toBe("无服饰"); // 旧实现为 "与配饰：无服饰"
    expect(details.background).toBe("乡间长大"); // 旧实现为空（别名缺失）
    expect(details.signature).toBe("卷尾巴");
  });

  it("场景长标签正确落位", () => {
    const desc = `黄昏麦田
空间类型：户外乡村田野
地理与环境：开阔平原
时间：黄昏
天气：晴朗
主要元素：麦穗田、篱笆
前景、中景、背景与空间层次：前景麦穗特写
光线方向与质量：侧后方低角度
色彩与氛围：金黄暖橘
可用于哪些剧情：相遇与同行`;
    const details = createDefaultAssetDetails({ type: "scene", description: desc }) as unknown as Record<string, string>;
    expect(details.environment).toBe("开阔平原");
    expect(details.spatialLayers).toBe("前景麦穗特写");
    expect(details.lighting).toBe("侧后方低角度");
    expect(details.paletteMood).toBe("金黄暖橘");
    expect(details.storyUse).toBe("相遇与同行");
  });

  it("道具长标签（特殊标记或识别特征 / 在镜头中的使用方式）不再污染", () => {
    const desc = `一段木篱笆
道具用途：空间分隔
故事作用：友谊起点
物件类型：木质围栏
整体形状：横向低矮
尺寸与比例：高约 50cm
材质：原木
颜色：浅棕
结构细节：竖桩加横木
磨损与使用痕迹：雨水水痕
特殊标记或识别特征：一道爪痕
在镜头中的使用方式：作前景框架`;
    const details = createDefaultAssetDetails({ type: "prop", description: desc }) as unknown as Record<string, string>;
    expect(details.purpose).toBe("空间分隔");
    expect(details.signature).toBe("一道爪痕"); // 旧实现为 "或识别特征：一道爪痕"
    expect(details.usage).toBe("作前景框架");
    expect(details.wear).toBe("雨水水痕");
  });

  it("兼容旧短标签（历史数据仍可解析）", () => {
    const desc = `小猪主角
物种：猪
身份：故事主角
年龄：幼年
性格：憨厚
外貌：圆润粉色
服饰：红围巾
记忆点：卷尾巴
背景：生活在麦田旁`;
    const details = createDefaultAssetDetails({ type: "character", description: desc }) as unknown as Record<string, string>;
    expect(details.species).toBe("猪");
    expect(details.personality).toBe("憨厚");
    expect(details.outfit).toBe("红围巾");
    expect(details.background).toBe("生活在麦田旁");
  });
});

describe("normalizeAssetDetails：kind 缺失容忍（回归：曾整份 details 被丢弃）", () => {
  it("模型返回的 details 不含内部 kind 时仍被采纳", () => {
    const incoming = {
      mediumMaterial: "写实 3D 渲染",
      colorPalette: "金黄与暖橘",
      lightingMood: "",
      cameraTexture: "浅景深",
      composition: "",
      emotion: "",
    } as unknown as AssetDetails;
    const details = normalizeAssetDetails(
      { type: "style", description: "柔和暖调乡村视觉" },
      incoming,
    ) as unknown as Record<string, string>;
    expect(details.kind).toBe("style");
    expect(details.mediumMaterial).toBe("写实 3D 渲染");
    expect(details.cameraTexture).toBe("浅景深");
  });

  it("显式给出不同 kind 时仍回落描述派生（错配保护不变）", () => {
    const details = normalizeAssetDetails(
      { type: "style", description: "画风：水彩插画" },
      {
        kind: "scene",
        settingType: "",
        environment: "",
        time: "",
        weather: "",
        elements: "",
        spatialLayers: "",
        lighting: "",
        paletteMood: "",
        storyUse: "",
        mediumMaterial: "不应采纳",
      } as unknown as AssetDetails,
    ) as unknown as Record<string, string>;
    expect(details.kind).toBe("style");
    expect(details.mediumMaterial).toBe("水彩插画");
  });

  it("模型返回空串不覆盖可用的描述派生值", () => {
    const desc = `画风：水彩插画
主色调：冷蓝`;
    const details = normalizeAssetDetails(
      { type: "style", description: desc },
      { mediumMaterial: "", colorPalette: "" } as unknown as AssetDetails,
    ) as unknown as Record<string, string>;
    expect(details.mediumMaterial).toBe("水彩插画");
    expect(details.colorPalette).toBe("冷蓝");
  });
});

describe("repairAssetDetails：历史脏数据修复（v16 迁移用）", () => {
  function makeAsset(overrides: Record<string, unknown>) {
    return {
      id: "a1",
      type: "character",
      source: "extracted",
      name: "小猪",
      prompt: "",
      ...overrides,
    };
  }

  it("纠正带标签残片的污染值", () => {
    const desc = `一只小猪仔
物种：猪
性格与行为倾向：贪玩好奇
服饰与配饰：无服饰`;
    const asset = makeAsset({
      description: desc,
      details: {
        kind: "character",
        species: "猪",
        role: "",
        age: "",
        personality: "与行为倾向：贪玩好奇",
        appearance: "",
        outfit: "与配饰：无服饰",
        signature: "",
        background: "",
      },
    });
    const repaired = repairAssetDetails(asset as never) as unknown as { details: Record<string, string> };
    expect(repaired.details.personality).toBe("贪玩好奇");
    expect(repaired.details.outfit).toBe("无服饰");
  });

  it("补上空缺字段（模型 details 曾被整份丢弃的场景）", () => {
    const desc = `柔和暖调乡村视觉
画风：写实 3D 渲染
主色调：金黄暖橘`;
    const asset = makeAsset({
      type: "style",
      description: desc,
      details: { kind: "style", mediumMaterial: "", colorPalette: "", lightingMood: "", cameraTexture: "", composition: "", emotion: "" },
    });
    const repaired = repairAssetDetails(asset as never) as unknown as { details: Record<string, string> };
    expect(repaired.details.mediumMaterial).toBe("写实 3D 渲染");
    expect(repaired.details.colorPalette).toBe("金黄暖橘");
  });

  it("保留看起来正常的既有值（不拿描述覆盖 AI/用户设定）", () => {
    const desc = `一只小狗
物种：犬`;
    const asset = makeAsset({
      description: desc,
      details: { kind: "character", species: "犬（AI 专门设定）", role: "", age: "", personality: "", appearance: "", outfit: "", signature: "", background: "" },
    });
    const repaired = repairAssetDetails(asset as never) as unknown as { details: Record<string, string> };
    expect(repaired.details.species).toBe("犬（AI 专门设定）");
  });

  it("幂等：修复后再修一次结果不变", () => {
    const desc = `黄昏麦田
空间类型：户外
地理与环境：开阔平原`;
    const asset = makeAsset({
      type: "scene",
      description: desc,
      details: { kind: "scene", settingType: "", environment: "", time: "", weather: "", elements: "", spatialLayers: "", lighting: "", paletteMood: "", storyUse: "" },
    });
    const once = repairAssetDetails(asset as never);
    const twice = repairAssetDetails(once);
    const read = (a: unknown) => (a as { details: Record<string, string> }).details;
    expect(read(twice)).toEqual(read(once));
  });

  it("无 details 的资产直接补全", () => {
    const desc = `木篱笆
道具用途：空间分隔`;
    const asset = makeAsset({ type: "prop", description: desc });
    const repaired = repairAssetDetails(asset as never) as unknown as { details: Record<string, string> };
    expect(repaired.details.purpose).toBe("空间分隔");
  });

  it("描述缺失时不抛错（迁移需对任意历史数据安全）", () => {
    expect(() => repairAssetDetails(makeAsset({ description: undefined }) as never)).not.toThrow();
    expect(() => repairAssetDetails(makeAsset({}) as never)).not.toThrow();
    expect(repairAssetDetails(makeAsset({ type: "style" }) as never)).toBeTruthy();
  });
});
