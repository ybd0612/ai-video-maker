// ────────────────────────────────────────────────────────────────────────────
// tests/services/videoService.test.ts
// generateVideo 请求体单测：mode 选择与素材互斥。
// 依据 2026-09-21 实测：reference 与 first_frame / last_frame 同时传会被
// 服务端 400 拒绝，因此服务层必须自行保证两者不同时出现。
// 网络与限流用 vi.mock 伪造；轮询前的 5 秒等待用 fake timers 跨过。
// ────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/fetchWithRetry", () => ({ fetchWithRetry: vi.fn() }));
vi.mock("@/services/rateLimit", () => ({
  rateLimiter: { acquire: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("@/lib/logger", () => ({
  startSpan: () => ({ end: vi.fn(), fail: vi.fn() }),
}));

import { fetchWithRetry } from "@/lib/fetchWithRetry";
import { generateVideo } from "@/services/videoService";

const mockedFetch = vi.mocked(fetchWithRetry);

function jsonResponse(payload: unknown) {
  return {
    ok: true,
    status: 200,
    headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "application/json" : null) },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

/** 第一次调用是创建，第二次是轮询（直接 completed） */
function stubHappyPath(videoId = "task_x") {
  mockedFetch
    .mockResolvedValueOnce(jsonResponse({ video_id: videoId }))
    .mockResolvedValueOnce(jsonResponse({ status: "completed", progress: 100, url: "https://cdn.test/out.mp4" }));
}

function createBody(): Record<string, unknown> {
  const init = mockedFetch.mock.calls[0][1] as { body: string };
  return JSON.parse(init.body);
}

const base = {
  apiKey: "k", baseUrl: "https://api.test/v1", prompt: "motion text",
  aspectRatio: "9:16", duration: 5,
};

beforeEach(() => {
  vi.useFakeTimers();
  mockedFetch.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

async function run(opts: Parameters<typeof generateVideo>[0]) {
  const pending = generateVideo(opts);
  await vi.runAllTimersAsync();
  return pending;
}

describe("generateVideo 请求体", () => {
  it("只有首帧 → keyframe + first_frame，不带 images", async () => {
    stubHappyPath();
    await run({ ...base, imageUrl: "https://cdn.test/a.png" });
    expect(createBody()).toMatchObject({
      mode: "keyframe", first_frame: "https://cdn.test/a.png", size: "720P", seconds: "5", n: 1,
    });
    expect(createBody().images).toBeUndefined();
  });

  it("首尾帧都给 → keyframe 带 first_frame 与 last_frame", async () => {
    stubHappyPath();
    await run({ ...base, imageUrl: "https://cdn.test/a.png", lastFrameUrl: "https://cdn.test/b.png" });
    expect(createBody()).toMatchObject({
      mode: "keyframe", first_frame: "https://cdn.test/a.png", last_frame: "https://cdn.test/b.png",
    });
  });

  it("有参考图 → reference + images，且丢弃首尾帧（服务端互斥）", async () => {
    stubHappyPath();
    await run({
      ...base,
      imageUrl: "https://cdn.test/a.png",
      lastFrameUrl: "https://cdn.test/b.png",
      referenceImageUrls: ["https://cdn.test/char.png", "https://cdn.test/style.png"],
    });
    const body = createBody();
    expect(body.mode).toBe("reference");
    expect(body.images).toEqual(["https://cdn.test/char.png", "https://cdn.test/style.png"]);
    expect(body.first_frame).toBeUndefined();
    expect(body.last_frame).toBeUndefined();
  });

  it("参考图超过 Flash 上限 5 张时截断", async () => {
    stubHappyPath();
    const many = Array.from({ length: 8 }, (_, i) => `https://cdn.test/r${i}.png`);
    await run({ ...base, referenceImageUrls: many });
    expect((createBody().images as string[])).toHaveLength(5);
  });

  it("无任何素材 → text 模式", async () => {
    stubHappyPath();
    await run({ ...base });
    const body = createBody();
    expect(body.mode).toBe("text");
    expect(body.first_frame).toBeUndefined();
    expect(body.images).toBeUndefined();
  });

  it("时长仍按官方范围收敛为字符串 seconds", async () => {
    stubHappyPath();
    await run({ ...base, duration: 99, imageUrl: "https://cdn.test/a.png" });
    expect(createBody().seconds).toBe("12");
  });
});
