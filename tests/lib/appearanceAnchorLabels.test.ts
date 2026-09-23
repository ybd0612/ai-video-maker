// ────────────────────────────────────────────────────────────────────────────
// tests/lib/appearanceAnchorLabels.test.ts
// 短外观锚点的括注格式（Task 9）：分类标签必须以元信息形式给出，
// 不能被模型当正文照抄（实测「一只黑白色边境牧羊犬幼犬，狗（边境牧羊犬）」
// 「旧麻质晾衣绳，生活线绳」「水泥凸台，建筑结构」）。
// 断言来自 src/lib/assetDetails.ts 真实实现。
// ────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { composeAssetBriefAppearance } from "@/lib/assetDetails";

type BriefInput = Parameters<typeof composeAssetBriefAppearance>[0];

describe("锚点标签以括注形式给出，不被当正文照抄", () => {
  it("单字段：摘要后接括注标签", () => {
    const anchor = composeAssetBriefAppearance({
      type: "character",
      description: "一只左眼戴黑色布质眼罩的年长橘色家猫。",
      details: { kind: "character", species: "猫（橘色家猫）" },
    } as BriefInput);
    expect(anchor).toBe("一只左眼戴黑色布质眼罩的年长橘色家猫（物种：猫（橘色家猫））");
  });

  it("多字段用分号并列，整体仍是一个括注", () => {
    const anchor = composeAssetBriefAppearance({
      type: "scene",
      description: "暴雨将至的旧楼天台。",
      details: {
        kind: "scene",
        settingType: "室外城市楼顶平台",
        weather: "大雨未落",
        time: "黄昏",
      },
    } as BriefInput);
    expect(anchor).toBe(
      "暴雨将至的旧楼天台（空间类型：室外城市楼顶平台；天气：大雨未落；时间：黄昏）",
    );
  });

  it("没有标签字段时退化为纯摘要，不带空括号", () => {
    const anchor = composeAssetBriefAppearance({
      type: "character",
      description: "一只灰猫。",
      details: undefined,
    } as BriefInput);
    expect(anchor).toBe("一只灰猫");
  });

  it("摘要已完整包含字段值时不追加（既有去重口径保持）", () => {
    const anchor = composeAssetBriefAppearance({
      type: "character",
      description: "一只狗（贵宾犬/泰迪）",
      details: { kind: "character", species: "狗（贵宾犬/泰迪）" },
    } as BriefInput);
    expect(anchor).toBe("一只狗（贵宾犬/泰迪）");
  });

  it("摘要缺失时不吞掉唯一标签（旧数据兜底）", () => {
    const anchor = composeAssetBriefAppearance({
      type: "prop",
      description: "",
      details: { kind: "prop", objectType: "生活线绳" },
    } as BriefInput);
    expect(anchor).toBe("物件类型：生活线绳");
  });
});
