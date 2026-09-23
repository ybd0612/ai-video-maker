// ────────────────────────────────────────────────────────────────────────────
// tests/services/videoTaskResume.test.ts
// 视频任务创建即上报 ID + 按 ID 续轮询（Task 10）。
// 断言来自 src/services/videoService.ts 真实实现：
// ① onTaskCreated 必须在开始轮询前触发（否则刷新后 ID 丢失）；
// ② pollVideoTaskById 只发 GET，绝不发 POST /videos（按秒计费）。
// 限流与日志用 vi.mock 屏蔽，网络用 fetch 桩，定时器伪造。
// ────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { acquireMock } = vi.hoisted(() => ({ acquireMock: vi.fn(async () => {}) }));

vi.mock("@/services/rateLimit", () => ({
  rateLimiter: { acquire: acquireMock, notifyRateLimited: vi.fn() },
  RATE_LIMIT_RETRY_BUDGET: 2,
}));

vi.mock("@/lib/logger", () => ({
  startSpan: () => ({ end: () => undefined, fail: () => undefined }),
  beginTrace: () => ({ end: () => undefined, fail: () => undefined }),
  logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
}));

import { generateVideo, pollVideoTaskById } from "@/services/videoService";
import { MODELS } from "@/lib/models";

const BASE = {
  apiKey: "sk-test",
  baseUrl: "https://api.test",
  prompt: "p",
  aspectRatio: "16:9",
  duration: 5,
};

function json(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  acquireMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("视频任务 ID 落盘与恢复", () => {
  it("创建成功后、开始轮询前就回调 onTaskCreated", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json({ video_id: "task_A", status: "queued" }))
        .mockResolvedValueOnce(json({ status: "completed", url: "https://cdn.test/a.mp4" })),
    );

    const pending = generateVideo({
      ...BASE,
      onTaskCreated: (id, model) => seen.push(`${id}:${model}`),
    });
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(seen).toEqual([`task_A:${MODELS.video}`]);
    expect(result.videoUrl).toBe("https://cdn.test/a.mp4");
  });

  it("pollVideoTaskById 只发轮询请求，绝不 POST /videos", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        urls.push(url);
        return json({ status: "completed", url: "https://cdn.test/a.mp4" });
      }),
    );

    const pending = pollVideoTaskById(
      { apiKey: "sk-test", baseUrl: "https://api.test" },
      "task_A",
      MODELS.video,
    );
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((u) => !u.endsWith("/videos"))).toBe(true);
    expect(result.videoUrl).toBe("https://cdn.test/a.mp4");
  });
});
