// ────────────────────────────────────────────────────────────────────────────
// tests/lib/tailFrameStore.test.ts
// 前镜末帧内存缓存的生命周期。断言来自 src/lib/tailFrameStore.ts 真实实现。
// 单例是模块级的，每个用例都 resetModules + 动态 import 取新实例；
// blob URL 的创建/释放用 spyOn 伪造，不整体替换 URL 全局对象。
// ────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const revoked: string[] = [];

beforeEach(() => {
  vi.resetModules();
  revoked.length = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:fake");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((u: string) => {
    revoked.push(u);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function store() {
  return await import("@/lib/tailFrameStore");
}

describe("tailFrameStore", () => {
  it("写入后可读回，snapshot 返回普通对象供纯函数消费", async () => {
    const m = await store();
    m.setTailFrame("s0", "blob:a");
    expect(m.getTailFrame("s0")).toBe("blob:a");
    expect(m.snapshotTailFrames()).toEqual({ s0: "blob:a" });
  });

  it("同一镜头重复写入时释放旧的 blob URL（不泄漏）", async () => {
    const m = await store();
    m.setTailFrame("s0", "blob:old");
    m.setTailFrame("s0", "blob:new");
    expect(revoked).toEqual(["blob:old"]);
    expect(m.getTailFrame("s0")).toBe("blob:new");
  });

  it("release 指定镜头；不传参释放全部并清空", async () => {
    const m = await store();
    m.setTailFrame("a", "blob:a");
    m.setTailFrame("b", "blob:b");
    m.releaseTailFrames(["a"]);
    expect(revoked).toEqual(["blob:a"]);
    expect(m.snapshotTailFrames()).toEqual({ b: "blob:b" });
    m.releaseTailFrames();
    expect(m.snapshotTailFrames()).toEqual({});
  });

  it("未知 ID 读取返回 undefined，释放不抛错", async () => {
    const m = await store();
    expect(m.getTailFrame("nope")).toBeUndefined();
    expect(() => m.releaseTailFrames(["nope"])).not.toThrow();
  });
});
