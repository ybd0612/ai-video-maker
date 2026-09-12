// ────────────────────────────────────────────────────────────────────────────
// tests/lib/extractAssets.test.ts
// extractNewAssets 去重语义回归锁。
// 事故背景（2026-09-12）：替换式提取（想法 → 重新提取）时，去重基准若为全部
// 旧资产，模型输出的同名新角色会被误跳过；替换写回又清掉旧 extracted 角色
// → 角色凭空消失（实测两次）。修复：替换式去重基准 = 仅 manual 资产。
// ────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import type { Asset } from "@/stores/projectStore";
import { extractNewAssets, type RawAsset } from "@/lib/extractAssets";

function makeAsset(partial: Partial<Asset> & Pick<Asset, "id" | "type" | "name">): Asset {
  return {
    description: "",
    prompt: "",
    source: "extracted",
    ...partial,
  } as Asset;
}

function makeRaw(name: string): RawAsset {
  return { name, description: `${name} 的描述`, appearancePrompt: `cute ${name}` };
}

describe("extractNewAssets 去重语义", () => {
  it("【事故回归锁】替换式提取：旧 extracted 同名角色不参与去重，新角色保留", () => {
    // 用户重新提取时的真实现场：旧资产含上一次提取的角色 + 场景 + 风格
    const existing = [
      makeAsset({ id: "a1", type: "character", name: "小白兔" }),
      makeAsset({ id: "a2", type: "character", name: "兔妈妈" }),
      makeAsset({ id: "a3", type: "scene", name: "静谧月夜森林" }),
      makeAsset({ id: "a4", type: "style", name: "温馨手绘动画风" }),
    ];
    const manual: Asset[] = [];
    const { assets } = extractNewAssets(
      existing,
      [makeRaw("小白兔"), makeRaw("兔妈妈")],
      "character",
      manual,
    );
    // 修复前：同名被误跳过 → assets 为空 → 替换写回后角色凭空消失
    expect(assets.map((a) => a.name)).toEqual(["小白兔", "兔妈妈"]);
  });

  it("替换式提取：manual 同名资产仍受保护（新提取项跳过）", () => {
    const existing = [
      makeAsset({ id: "a1", type: "character", name: "小白兔" }),
      makeAsset({ id: "a2", type: "character", name: "小红帽", source: "manual" }),
    ];
    const manual = existing.filter((a) => a.source === "manual");
    const { assets } = extractNewAssets(
      existing,
      [makeRaw("小白兔"), makeRaw("小红帽")],
      "character",
      manual,
    );
    // 小白兔（extracted 旧名）保留；小红帽与 manual 重名 → 跳过，保留用户手工版
    expect(assets.map((a) => a.name)).toEqual(["小白兔"]);
  });

  it("追加式（默认，无第 4 参）：与全部旧资产同名则跳过（分镜补建语义不变）", () => {
    const existing = [makeAsset({ id: "a1", type: "character", name: "小白兔" })];
    const { assets } = extractNewAssets(existing, [makeRaw("小白兔"), makeRaw("新角色")], "character");
    expect(assets.map((a) => a.name)).toEqual(["新角色"]);
  });

  it("style 分支：prompt 置空、不带 namespace/fullPrompt", () => {
    const { assets } = extractNewAssets([], [makeRaw("温馨手绘动画风")], "style");
    expect(assets).toHaveLength(1);
    expect(assets[0].type).toBe("style");
    expect(assets[0].prompt).toBe("");
    expect(assets[0].appearancePrompt).toBeUndefined();
    expect(assets[0].assetNamespace).toBeUndefined();
  });

  it("character 分支：写入 appearancePrompt/namespace/fullPrompt", () => {
    const { assets, idByName } = extractNewAssets([], [makeRaw("小白兔")], "character");
    expect(assets).toHaveLength(1);
    expect(assets[0].appearancePrompt).toBe("cute 小白兔");
    expect(assets[0].assetNamespace).toBe("[小白兔]");
    expect(idByName.get("小白兔")).toBe(assets[0].id);
  });

  it("空名字的条目被跳过", () => {
    const raw = { name: "   ", description: "d", appearancePrompt: "a" };
    const { assets } = extractNewAssets([], [raw], "character");
    expect(assets).toHaveLength(0);
  });
});
