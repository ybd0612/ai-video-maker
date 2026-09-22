// ────────────────────────────────────────────────────────────────────────────
// tests/lib/summaryNarration.test.ts
// 锁住 2026-09-22 实测缺陷：模型常把剧情写进 description 摘要行
// （「一只忠诚温和的贵宾犬，从铁门后冲出，与橘猫对峙、随后踩水驱赶…」），
// 而外观描述会直接取用摘要行 → 定妆照画出第二只狗和一只猫。
// 现在只取第一个分句，品种事实由 details.species 兜底。
// ────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { composeAssetAppearance, composeAssetBriefAppearance } from "@/lib/assetDetails";
import type { AssetDetails } from "@/stores/projectStore";

const DOG: AssetDetails = {
  kind: "character",
  species: "狗（边境牧羊犬）",
  role: "幼犬",
  age: "幼年期",
  personality: "活泼冲动",
  appearance: "毛色黑白相间，尾巴蓬松",
  outfit: "无",
  signature: "黑白相间的毛发",
  background: "与橘猫从对立转为相依",
};
const NARRATIVE_SUMMARY =
  "一只黑白边境牧羊犬幼犬，从铁门后冲出，与橘猫对峙、随后踩水驱赶并与其在雨中相依。\n物种：狗（边境牧羊犬）\n外貌：毛色黑白相间，尾巴蓬松";

describe("摘要行含剧情时只取第一个分句", () => {
  it("完整档外观不再带出其他角色与剧情动作", () => {
    const full = composeAssetAppearance({ type: "character", description: NARRATIVE_SUMMARY, details: DOG });
    expect(full).toContain("一只黑白边境牧羊犬幼犬");
    expect(full).toContain("物种：狗（边境牧羊犬）");
    for (const leak of ["橘猫", "铁门", "踩水", "雨中", "相依"]) {
      expect(full).not.toContain(leak);
    }
  });

  it("短档外观同样只留身份", () => {
    const brief = composeAssetBriefAppearance({ type: "character", description: NARRATIVE_SUMMARY, details: DOG });
    expect(brief).toBe("一只黑白边境牧羊犬幼犬，狗（边境牧羊犬）");
  });

  it("摘要只有一个分句时不被截断", () => {
    const brief = composeAssetBriefAppearance({
      type: "character",
      description: "一只左眼失明的年长橘猫",
      details: { ...DOG, species: "猫（橘色家猫）" },
    });
    expect(brief).toBe("一只左眼失明的年长橘猫，猫（橘色家猫）");
  });
});
