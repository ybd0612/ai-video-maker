// ────────────────────────────────────────────────────────────────────────────
// tests/lib/briefAppearance.test.ts
// 分镜「短外观锚点」单测：锁住 2026-09-22 回归的修复边界——
// 镜头提示词只能拿到一句身份锚点，不得带上带标签的整份设定。
// 断言来自 src/lib/assetDetails.ts 与 promptRules 生效条目真实实现。
// ────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import {
  BRIEF_APPEARANCE_FIELDS,
  composeAssetAppearance,
  composeAssetBriefAppearance,
} from "@/lib/assetDetails";
import { getActiveRuleText } from "@/lib/promptRules";
import type { AssetDetails } from "@/stores/projectStore";

const DOG: AssetDetails = {
  kind: "character",
  species: "狗（贵宾犬/泰迪）",
  role: "主角",
  age: "成年",
  personality: "忠诚温和",
  appearance: "体型小巧圆润，卷毛蓬松柔软，毛色为深浅不一的棕褐色",
  outfit: "无服饰，全身覆盖紧密卷曲的短卷毛",
  signature: "眼神坚定而柔软",
  background: "家庭宠物",
};
const DOG_DESC = "一只忠诚温和的贵宾犬。\n物种：狗（贵宾犬/泰迪）\n外貌：卷毛蓬松";

describe("场景短锚点必须携带天气与时间", () => {
  it("scene 锚点含 settingType / weather / time 三项", () => {
    expect(BRIEF_APPEARANCE_FIELDS.scene).toEqual(["settingType", "weather", "time"]);
  });

  it("「暴雨前」场景的锚点带上「大雨未落」——镜头提示词才有干湿依据", () => {
    const anchor = composeAssetBriefAppearance({
      type: "scene",
      description: "暴雨将至的旧楼天台，生锈水塔与铁门在远处闪电下呈现冷硬轮廓。",
      details: {
        kind: "scene",
        settingType: "室外城市楼顶平台",
        weather: "乌云密布，狂风卷起尘土，大雨未落，远处天空伴有强烈闪电",
        time: "黄昏至暴雨来临前的临界时刻",
      },
    } as Parameters<typeof composeAssetBriefAppearance>[0]);
    expect(anchor).toContain("室外城市楼顶平台");
    expect(anchor).toContain("大雨未落");
    expect(anchor).toContain("黄昏");
  });

  it("锚点里相邻片段互为子串时去重（既有去重口径扩展到新增字段）", () => {
    const anchor = composeAssetBriefAppearance({
      type: "scene",
      description: "雨夜天台",
      details: {
        kind: "scene",
        settingType: "天台",
        weather: "深夜暴雨",
        time: "深夜",
      },
    } as Parameters<typeof composeAssetBriefAppearance>[0]);
    // "深夜" 已被 "深夜暴雨" 包含，不应重复出现两次
    expect(anchor.match(/深夜/g)?.length).toBe(1);
  });
});

describe("composeAssetBriefAppearance", () => {
  it("只给一句身份锚点，不含字段标签", () => {
    const brief = composeAssetBriefAppearance({ type: "character", description: DOG_DESC, details: DOG });
    expect(brief).toContain("一只忠诚温和的贵宾犬");
    expect(brief).toContain("狗（贵宾犬/泰迪）");
    for (const label of ["外貌", "服饰", "识别特征", "性格", "背景"]) {
      expect(brief).not.toContain(label);
    }
  });

  it("摘要与物种互不包含时两者都保留，但锚点仍是一句话量级", () => {
    // 去重只在「一方完整包含另一方」时生效；摘要写「贵宾犬（泰迪）」、
    // 物种写「狗（贵宾犬/泰迪）」时两者各有信息量，都保留才是正确行为。
    const brief = composeAssetBriefAppearance({
      type: "character",
      description: "一只贵宾犬（泰迪）",
      details: DOG,
    });
    expect(brief).toBe("一只贵宾犬（泰迪），狗（贵宾犬/泰迪）");
    expect(brief.length).toBeLessThan(40);
    expect(brief.split("，").length).toBeLessThanOrEqual(2);
  });

  it("摘要已完整包含物种时不重复追加", () => {
    const brief = composeAssetBriefAppearance({
      type: "character",
      description: "一只狗（贵宾犬/泰迪）",
      details: DOG,
    });
    expect(brief).toBe("一只狗（贵宾犬/泰迪）");
  });

  it("短档严格短于完整档（完整档仍供资产图与定妆照使用）", () => {
    const full = composeAssetAppearance({ type: "character", description: DOG_DESC, details: DOG });
    const brief = composeAssetBriefAppearance({ type: "character", description: DOG_DESC, details: DOG });
    expect(full.length).toBeGreaterThan(brief.length);
    expect(full).toContain("外貌：");
  });

  it("场景与道具各取自己的类型字段，摘要带句号时不留「。，」", () => {
    expect(
      composeAssetBriefAppearance({
        type: "scene",
        description: "阳光客厅。",
        details: { kind: "scene", settingType: "住宅客厅（奇幻化室内）" } as AssetDetails,
      }),
    ).toBe("阳光客厅，住宅客厅（奇幻化室内）");
    expect(
      composeAssetBriefAppearance({
        type: "prop",
        description: "沙发垫堡垒。",
        details: { kind: "prop", objectType: "软体家居家具部件" } as AssetDetails,
      }),
    ).toBe("沙发垫堡垒，软体家居家具部件");
  });
});

describe("分镜规则不再要求复制完整设定", () => {
  it("storyboard.character-appearance 条目改为「只用一句短外观锚点」", () => {
    const zh = getActiveRuleText("storyboardShot", "zh");
    expect(zh).toContain("只使用所给的一句短外观锚点");
    expect(zh).not.toContain("必须包含角色完整外貌描述");
  });
});
