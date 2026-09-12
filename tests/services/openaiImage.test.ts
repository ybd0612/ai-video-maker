// ────────────────────────────────────────────────────────────────────────────
// tests/services/openaiImage.test.ts
// OpenAIService.generateImage 请求体结构单测（QA 边界补测）：
// - referenceImageUrls ≥1 时写入 extra_body.image（数组）
// - referenceImageUrls 为空数组 / 缺省时不设置 extra_body.image
// - size 直通档位串；ratio 缺省回退 "1:1"，显式传入时透传
// 网络依赖用 vi.mock 伪造（fetchWithRetry / rateLimiter / videoService）。
// ────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/fetchWithRetry", () => ({
  fetchWithRetry: vi.fn(),
}));
vi.mock("@/services/rateLimit", () => ({
  rateLimiter: { acquire: vi.fn().mockResolvedValue(undefined) },
  imageSizeToTier: vi.fn().mockReturnValue("1K"),
}));
vi.mock("@/services/videoService", () => ({
  generateVideo: vi.fn(),
}));

import { fetchWithRetry } from "@/lib/fetchWithRetry";
import { OpenAIService } from "@/services/ai/openai";

const mockedFetch = vi.mocked(fetchWithRetry);

/** 构造 OpenAI 兼容 images/generations 成功响应 */
function makeOkResponse() {
  return {
    ok: true,
    headers: {
      get: (k: string) =>
        k.toLowerCase() === "content-type" ? "application/json" : null,
    },
    json: async () => ({ data: [{ url: "https://img.example.com/x.png" }] }),
  } as unknown as Response;
}

function getLastRequestBody(): Record<string, unknown> {
  const call = mockedFetch.mock.calls.at(-1);
  expect(call).toBeDefined();
  return JSON.parse(call![1].body as string) as Record<string, unknown>;
}

const svc = new OpenAIService({ apiKey: "sk-test", baseUrl: "https://api.example.com/v1" });

beforeEach(() => {
  mockedFetch.mockReset();
  mockedFetch.mockResolvedValue(makeOkResponse());
});

describe("OpenAIService.generateImage 请求体结构", () => {
  it("referenceImageUrls ≥1：写入 extra_body.image 数组，ratio 透传", async () => {
    await svc.generateImage({
      prompt: "a fox in a forest",
      size: "1K",
      ratio: "9:16",
      referenceImageUrls: ["http://img/a.png", "http://img/b.png"],
    });

    const body = getLastRequestBody();
    expect(body.model).toBeDefined();
    expect(body.prompt).toBe("a fox in a forest");
    expect(body.size).toBe("1K");
    expect(body.ratio).toBe("9:16");
    const extra = body.extra_body as Record<string, unknown>;
    expect(extra.image).toEqual(["http://img/a.png", "http://img/b.png"]);
    expect(extra.response_format).toBe("url");
  });

  it("referenceImageUrls 为空数组：不设置 extra_body.image", async () => {
    await svc.generateImage({
      prompt: "plain text-to-image",
      size: "2K",
      ratio: "16:9",
      referenceImageUrls: [],
    });

    const body = getLastRequestBody();
    const extra = body.extra_body as Record<string, unknown>;
    expect("image" in extra).toBe(false);
    expect(body.size).toBe("2K");
  });

  it("referenceImageUrls 缺省：不设置 extra_body.image；ratio 缺省回退 1:1", async () => {
    await svc.generateImage({ prompt: "minimal", size: "1K" });

    const body = getLastRequestBody();
    const extra = body.extra_body as Record<string, unknown>;
    expect("image" in extra).toBe(false);
    expect(body.ratio).toBe("1:1");
  });
});
