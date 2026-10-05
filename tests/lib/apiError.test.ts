// 2026-10-03 审计 P2-6：HTTP 错误响应体的用户可见摘要。
// 核心契约：不把原始响应体整段透传给用户可见错误（可能含请求回显/内部字段）。
import { describe, expect, it } from "vitest";

import { summarizeApiError } from "@/lib/apiError";

describe("summarizeApiError", () => {
  it("OpenAI 兼容 JSON：提取 error.message", () => {
    const raw = JSON.stringify({ error: { message: "Your api key is invalid", type: "invalid_request_error" } });
    expect(summarizeApiError(raw)).toBe("Your api key is invalid");
  });

  it("顶层 message / code 兜底", () => {
    expect(summarizeApiError(JSON.stringify({ message: "quota exceeded" }))).toBe("quota exceeded");
    expect(summarizeApiError(JSON.stringify({ code: "RateLimit" }))).toBe("RateLimit");
  });

  it("非 JSON 长文本截断到 200 字符以内", () => {
    const long = "x".repeat(5000);
    const out = summarizeApiError(long);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out).toBe(long.slice(0, 200));
  });

  it("JSON 但无可用信息字段：退化为截断纯文本", () => {
    const raw = JSON.stringify({ data: { echo: "y".repeat(1000) } });
    expect(summarizeApiError(raw).length).toBeLessThanOrEqual(200);
  });

  it("空响应体给出可读占位", () => {
    expect(summarizeApiError("   ")).toBe("（空响应体）");
  });

  it("error.message 超长同样限长", () => {
    const raw = JSON.stringify({ error: { message: "z".repeat(1000) } });
    expect(summarizeApiError(raw).length).toBe(200);
  });
});
