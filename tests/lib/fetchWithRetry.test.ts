// ────────────────────────────────────────────────────────────────────────────
// tests/lib/fetchWithRetry.test.ts
// 统一 fetch 封装的重试/超时/退避行为单测。
// 全部通过 vi.stubGlobal 伪造 fetch，不产生任何真实网络请求。
// ────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWithRetry, HttpError } from "@/lib/fetchWithRetry";

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

  /* ── 429 独立通道 ────────────────────────────────────────────────────────
     成因（2026-09-23 实测 debug-dump/runtime.log）：免费档 429 的封锁窗口在 16-20s
     内自愈（429 之后紧邻的下一个请求即成功），而通用通道的 2/4/8s 退避总跨度 ~17s
     整段落在窗口内 → 三次重试必然全败。故 429 必须由调用方注入窗口级等待，
     且不吃通用预算（非幂等创建的通用预算恒为 0）。 */
  describe("429 独立通道", () => {
    it("maxRetries 为 0 时 429 仍能等窗口重发（非幂等创建可用）", async () => {
      const onRateLimited = vi.fn().mockResolvedValue(undefined);
      fetchMock
        .mockResolvedValueOnce(respondStatus(429, { "retry-after": "7" }))
        .mockResolvedValueOnce(respondOk());

      const res = await fetchWithRetry("/api", {
        maxRetries: 0,
        rateLimitRetries: 2,
        onRateLimited,
      });

      expect(res.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      // Retry-After 以毫秒交给调用方，等待由调用方（限流器）负责
      expect(onRateLimited).toHaveBeenCalledWith({ retryAfterMs: 7_000, attempt: 1 });
    });

    it("429 通道不消耗通用重试预算", async () => {
      const onRateLimited = vi.fn().mockResolvedValue(undefined);
      fetchMock
        .mockResolvedValueOnce(respondStatus(429))
        .mockResolvedValueOnce(respondStatus(429))
        .mockResolvedValueOnce(respondStatus(503))
        .mockResolvedValueOnce(respondOk());

      const res = await fetchWithRetry("/api", {
        maxRetries: 1,
        baseDelayMs: 1,
        rateLimitRetries: 2,
        onRateLimited,
      });

      expect(res.status).toBe(200);
      // 2 次 429 重发 + 1 次 503 重发 + 首次 = 4 次；通用预算只被 503 用掉 1 次
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(onRateLimited.mock.calls.map((c) => c[0].attempt)).toEqual([1, 2]);
    });

    it("429 通道用尽后抛 HttpError，带状态码与 Retry-After", async () => {
      fetchMock.mockResolvedValue(respondStatus(429, { "retry-after": "2" }));
      const onRateLimited = vi.fn().mockResolvedValue(undefined);

      const err = (await fetchWithRetry("/api", {
        maxRetries: 3,
        rateLimitRetries: 1,
        onRateLimited,
      }).catch((e: unknown) => e)) as HttpError;

      expect(err).toBeInstanceOf(HttpError);
      expect(err.status).toBe(429);
      expect(err.retryAfterMs).toBe(2_000);
      expect(err.message).toMatch(/^HTTP 429:/);
      // 首次 + 1 次通道重发后即放弃，剩余请求不得继续打
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("挂了 429 通道也不会让 5xx 重发（非幂等红线不被打开）", async () => {
      fetchMock.mockResolvedValue(respondStatus(503));
      const onRateLimited = vi.fn();

      await expect(
        fetchWithRetry("/api", { maxRetries: 0, rateLimitRetries: 3, onRateLimited }),
      ).rejects.toThrow(/HTTP 503/);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(onRateLimited).not.toHaveBeenCalled();
    });

    it("等待冷却期间抛错（如用户取消）时立即上抛，不再重发", async () => {
      fetchMock.mockResolvedValue(respondStatus(429));
      const onRateLimited = vi.fn().mockRejectedValue(new Error("请求已取消。"));

      await expect(
        fetchWithRetry("/api", { rateLimitRetries: 3, onRateLimited }),
      ).rejects.toThrow("请求已取消。");

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("未提供等待钩子时 429 退回通用通道（旧行为，轮询等调用点不受影响）", async () => {
      fetchMock.mockResolvedValue(respondStatus(429));

      await expect(fetchWithRetry("/api", { maxRetries: 2, baseDelayMs: 1 })).rejects.toThrow(
        /HTTP 429/,
      );
      // 通用预算 1 + 2 次重试
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });
});
