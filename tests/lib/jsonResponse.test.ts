import { describe, expect, it } from "vitest";
import { extractJsonFromResponse, parseJsonFromResponse } from "@/lib/jsonResponse";

describe("json response parsing", () => {
  it("extracts fenced JSON without treating braces in strings as structure", () => {
    const content = '```json\n{"description":"包含 {花括号}"}\n```';
    expect(extractJsonFromResponse(content)).toBe('{"description":"包含 {花括号}"}');
  });

  it("repairs literal line breaks and an unescaped quote in a model string", () => {
    const content = '{"description":"小猪说 "你好"\n然后继续奔跑"}';
    expect(parseJsonFromResponse<{ description: string }>(content)).toEqual({
      description: '小猪说 "你好"\n然后继续奔跑',
    });
  });

  it("returns null for truncated JSON", () => {
    expect(parseJsonFromResponse('{"characters":[{"name":"小猪"}')).toBeNull();
  });
});
