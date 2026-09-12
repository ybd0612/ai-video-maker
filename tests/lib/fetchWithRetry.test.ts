// ────────────────────────────────────────────────────────────────────────────
// tests/lib/fetchWithRetry.test.ts
// 统一 fetch 封装的重试/超时/退避行为单测。
// 全部通过 vi.stubGlobal 伪造 fetch，不产生任何真实网络请求。
// ────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWithRetry } from "@/lib/fetchWithRetry";

const fetchMock = vi.fn();

const respondOk = (body = "ok") => new Response(body, { status: 200 });
const respondStatus = (status: number, headers?: Record<string, string>) =>
  new Response("server-error-body", { status, headers });

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  // 重试会打 console.warn，测试输出里不需要噪音
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  fetchMock.mockReset();
});

describe("fetchWithRetry", () => {
  it("首次成功时直接返回，不产生重试", async () => {
    fetchMock.mockResolvedValueOnce(respondOk());

    const res = await fetchWithRetry("/api", { baseDelayMs: 1 });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("5xx 视为临时故障并重试，成功后返回", async () => {
    fetchMock.mockResolvedValueOnce(respondStatus(500)).mockResolvedValueOnce(respondOk());

    const res = await fetchWithRetry("/api", { baseDelayMs: 1 });

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("429 与 408 可重试", async () => {
    fetchMock.mockResolvedValueOnce(respondStatus(429)).mockResolvedValueOnce(respondOk());
    expect((await fetchWithRetry("/api", { baseDelayMs: 1 })).status).toBe(200);

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(respondStatus(408)).mockResolvedValueOnce(respondOk());
    expect((await fetchWithRetry("/api", { baseDelayMs: 1 })).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("普通 4xx 属于客户端错误，不重试而是原样返回", async () => {
    fetchMock.mockResolvedValueOnce(respondStatus(404));

    const res = await fetchWithRetry("/api", { baseDelayMs: 1 });

    expect(res.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("重试次数用尽后抛出错误，信息包含状态码", async () => {
    fetchMock.mockResolvedValue(respondStatus(503));

    await expect(fetchWithRetry("/api", { maxRetries: 2, baseDelayMs: 1 })).rejects.toThrow(
      /HTTP 503/,
    );
    // 首次尝试 + 2 次重试 = 3 次
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("maxRetries 为 0 时只尝试一次", async () => {
    fetchMock.mockResolvedValueOnce(respondStatus(500));

    await expect(fetchWithRetry("/api", { maxRetries: 0 })).rejects.toThrow(/HTTP 500/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("网络类错误（Failed to fetch）会重试", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(respondOk());

    const res = await fetchWithRetry("/api", { baseDelayMs: 1 });

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("非网络类的未知错误不重试，立即抛出", async () => {
    fetchMock.mockRejectedValueOnce(new Error("boom"));

    await expect(fetchWithRetry("/api", { baseDelayMs: 1 })).rejects.toThrow("boom");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("外部 signal 已取消时立即抛错，且不发起请求", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(fetchWithRetry("/api", { signal: controller.signal })).rejects.toThrow(
      "请求已取消。",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("尊重 Retry-After 响应头指定的等待时长", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(respondStatus(429, { "retry-after": "3" }))
      .mockResolvedValueOnce(respondOk());

    const startedAt = Date.now();
    const pending = fetchWithRetry("/api", { baseDelayMs: 1, maxRetries: 1 });

    // 头里写的是 3 秒，因此不足 3 秒时不应完成
    await vi.advanceTimersByTimeAsync(2_999);
    await vi.advanceTimersByTimeAsync(2);
    const res = await pending;

    expect(res.status).toBe(200);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(3_000);
  });

  it("单次请求超时后会中止并抛错", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal as AbortSignal;
          signal.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError")),
          );
        }),
    );

    const pending = fetchWithRetry("/api", { maxRetries: 0, timeoutMs: 100 });
    const assertion = expect(pending).rejects.toThrow(/abort/i);

    await vi.advanceTimersByTimeAsync(101);
    await assertion;

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
