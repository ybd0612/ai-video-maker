// ────────────────────────────────────────────────────────────────────────────
// tests/lib/misc.test.ts
// 零散但被广泛复用的纯函数：API 地址归一化。
// ────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { resolveBaseUrl } from "@/lib/resolveBaseUrl";

describe("resolveBaseUrl", () => {
  it("去掉结尾多余的斜杠", () => {
    expect(resolveBaseUrl("https://api.agnes-ai.cn/v1/")).toBe("https://api.agnes-ai.cn/v1");
    expect(resolveBaseUrl("https://api.agnes-ai.cn/v1///")).toBe("https://api.agnes-ai.cn/v1");
  });

  it("本就没有尾斜杠时原样返回", () => {
    expect(resolveBaseUrl("https://api.agnes-ai.cn/v1")).toBe("https://api.agnes-ai.cn/v1");
  });

  it("保留路径中间的斜杠", () => {
    expect(resolveBaseUrl("https://example.com/a/b")).toBe("https://example.com/a/b");
    expect(resolveBaseUrl("https://example.com/a/b/")).toBe("https://example.com/a/b");
  });

  it("空串与纯斜杠归一化为空串", () => {
    expect(resolveBaseUrl("")).toBe("");
    expect(resolveBaseUrl("///")).toBe("");
  });
});
