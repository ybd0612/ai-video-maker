// ────────────────────────────────────────────────────────────────────────────
// tests/lib/shotReferences.test.ts
// 模型分镜资产引用的运行时归一化与项目资产解析。
// ────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { resolveAssetId, resolveAssetIds, toIdRef, toIdRefList } from "@/lib/shotReferences";
import type { Asset } from "@/stores/projectStore";

const assets = [
  { id: "char_1", type: "character", name: "小猪" },
  { id: "scene_1", type: "scene", name: "乡间麦田夕阳" },
  { id: "prop_1", type: "prop", name: "乡间篱笆" },
] as Asset[];

describe("toIdRef", () => {
  it("支持字符串和带 id/name 的对象", () => {
    expect(toIdRef("  小猪 ")).toBe("小猪");
    expect(toIdRef({ id: "char_1" })).toBe("char_1");
    expect(toIdRef({ assetId: "char_1" })).toBe("char_1");
    expect(toIdRef({ name: "小猪" })).toBe("小猪");
  });

  it("拒绝空值、数组和无法识别的值", () => {
    expect(toIdRef("  ")).toBeUndefined();
    expect(toIdRef(null)).toBeUndefined();
    expect(toIdRef(["小猪"])).toBeUndefined();
    expect(toIdRef(123)).toBeUndefined();
    expect(toIdRef({})).toBeUndefined();
  });
});

describe("toIdRefList", () => {
  it("兼容单值、数组并按大小写去重", () => {
    expect(toIdRefList("小猪")).toEqual(["小猪"]);
    expect(toIdRefList({ id: "char_1" })).toEqual(["char_1"]);
    expect(toIdRefList(["小猪", { id: "char_1" }, { name: "小猪" }, ""])).toEqual([
      "小猪",
      "char_1",
    ]);
  });

  it("非法输入返回空列表", () => {
    expect(toIdRefList(null)).toEqual([]);
    expect(toIdRefList({})).toEqual([]);
  });
});

describe("resolveAssetId / resolveAssetIds", () => {
  it("按 ID 或名称解析指定类型资产", () => {
    expect(resolveAssetId({ id: "char_1" }, assets, "character")).toBe("char_1");
    expect(resolveAssetId("乡间麦田夕阳", assets, "scene")).toBe("scene_1");
    expect(resolveAssetId("乡间篱笆", assets, "character")).toBeUndefined();
  });

  it("兼容单值数组和对象引用，未知引用只被丢弃", () => {
    expect(resolveAssetIds("小猪", assets, "character")).toEqual(["char_1"]);
    expect(resolveAssetIds([{ name: "小猪" }, "不存在"], assets, "character")).toEqual(["char_1"]);
    expect(resolveAssetIds("乡间篱笆", assets, "prop")).toEqual(["prop_1"]);
  });
});
