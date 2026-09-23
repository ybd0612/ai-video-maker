// ────────────────────────────────────────────────────────────────────────────
// tests/services/openaiImage.test.ts
// OpenAIService.generateImage 请求体结构单测（QA 边界补测）：
// - referenceImageUrls ≥1 时写入 extra_body.image（数组）
// - referenceImageUrls 为空数组 / 缺省时不设置 extra_body.image
// - size 直通档位串；ratio 缺省回退 "1:1"，显式传入时透传
// - 创建请求（非幂等 POST）必须显式关闭自动重试 + 给足单次超时
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

  it("seed 传入：写入 extra_body.seed（实测同 seed 同 prompt 输出字节级一致）", async () => {
    await svc.generateImage({ prompt: "seeded", size: "1K", seed: 42 });

    const body = getLastRequestBody();
    const extra = body.extra_body as Record<string, unknown>;
    expect(extra.seed).toBe(42);
  });

  it("seed 缺省 / 非有限值：不设置 extra_body.seed", async () => {
    await svc.generateImage({ prompt: "no seed", size: "1K" });

    const body = getLastRequestBody();
    const extra = body.extra_body as Record<string, unknown>;
    expect("seed" in extra).toBe(false);

    await svc.generateImage({ prompt: "bad seed", size: "1K", seed: Number.NaN });
    const body2 = getLastRequestBody();
    const extra2 = body2.extra_body as Record<string, unknown>;
    expect("seed" in extra2).toBe(false);
  });
});

/* ── 创建请求的重试与超时策略 ─────────────────────────────────────────────── */

describe("生图创建请求的重试与超时（非幂等 POST）", () => {
  /** 取最近一次 fetchWithRetry 的选项 */
  function lastFetchOptions(): Record<string, unknown> {
    const call = mockedFetch.mock.calls.at(-1);
    expect(call).toBeDefined();
    return call![1] as unknown as Record<string, unknown>;
  }

  // 缺陷成因（2026-09-23 实测）：生图 POST 未传 maxRetries / timeoutMs，落到
  // fetchWithRetry 默认 60s/次 × 4 次；单张 1K 实测 29-59s 已贴天花板，一旦超时
  // 就重发——而这是创建请求，每次重发都会在服务端重复建任务并重复计配额。
  it("显式关闭自动重试：maxRetries 为 0", async () => {
    await svc.generateImage({ prompt: "x", size: "1K" });

    // fetchWithRetry 在 maxRetries=0 时只发一次请求（见 tests/lib/fetchWithRetry.test.ts）
    expect(lastFetchOptions().maxRetries).toBe(0);
  });

  it("单次尝试超时 ≥ 180s，避免正常慢响应被掐断后重发创建请求", async () => {
    await svc.generateImage({ prompt: "x", size: "1K" });

    const timeoutMs = lastFetchOptions().timeoutMs;
    expect(typeof timeoutMs).toBe("number");
    expect(timeoutMs as number).toBeGreaterThanOrEqual(180_000);
  });
});
