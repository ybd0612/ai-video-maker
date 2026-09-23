// ────────────────────────────────────────────────────────────────────────────
// src/lib/fetchWithRetry.ts
// Unified fetch wrapper with timeout, retry, and exponential backoff.
//
// 两条互不相干的重试预算：
//   - 通用通道（maxRetries）：超时 / 网络错误 / 5xx / 408。这类失败**无法证明服务端
//     没有处理请求**，非幂等 POST 必须关闭（见 rateLimit.ts 头部与 AGENTS.md P1 红线）。
//   - 限流通道（rateLimitRetries + onRateLimited）：仅 429。服务端在创建任务前就拒绝，
//     未建任务也未扣费，因此对非幂等 POST 同样可安全重发；等待时长按限流窗口尺度
//     由调用方注入（秒级指数退避对 60s 窗口无效，2026-09-23 实测见 rateLimit.ts）。
// ────────────────────────────────────────────────────────────────────────────

import { getTranslation } from "@/i18n";

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 60_000; // 60s per attempt
const DEFAULT_BASE_DELAY_MS = 2_000; // 2s base delay

/** 服务端按状态码拒绝（响应已到达），区别于网络错误与超时。 */
export class HttpError extends Error {
  readonly status: number;
  /** 服务端 Retry-After 换算出的毫秒数（未给出时为 undefined） */
  readonly retryAfterMs?: number;

  constructor(status: number, body: string, retryAfterMs?: number) {
    super(`HTTP ${status}: ${body.slice(0, 300)}`);
    this.name = "HttpError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface RateLimitedInfo {
  /** 服务端 Retry-After（秒）换算出的毫秒数；未给出时为 undefined */
  retryAfterMs?: number;
  /** 本次请求已第几次因 429 等待（从 1 开始） */
  attempt: number;
}

export interface FetchRetryOptions extends RequestInit {
  /** Max number of retries after the first attempt. Default: 3 */
  maxRetries?: number;
  /** Timeout per attempt in ms. Default: 60000 */
  timeoutMs?: number;
  /** Base delay for exponential backoff in ms. Default: 2000 */
  baseDelayMs?: number;
  /** AbortSignal for cancellation (merged with internal timeout) */
  signal?: AbortSignal;
  /** 429 专用重试次数（不占用 maxRetries 预算）。Default: 0 */
  rateLimitRetries?: number;
  /**
   * 收到 429 时的等待策略 —— 由调用方负责等待（通常是限流器登记冷却并睡到窗口解除）。
   * 本函数等待其完成后立即重发；抛错（如用户取消）则直接上抛，不再重试。
   */
  onRateLimited?: (info: RateLimitedInfo) => Promise<void>;
}

/**
 * Check if an error or HTTP status is transient and worth retrying.
 */
function isRetriable(status?: number, message?: string): boolean {
  // Network errors
  if (message) {
    const lower = message.toLowerCase();
    if (
      lower.includes("failed to fetch") ||
      lower.includes("networkerror") ||
      lower.includes("network request failed") ||
      lower.includes("load failed") ||
      lower.includes("econnrefused") ||
      lower.includes("econnreset") ||
      lower.includes("enetunreach") ||
      lower.includes("ehostunreach") ||
      lower.includes("etimedout") ||
      lower.includes("socket hang up") ||
      lower.includes("aborted") ||
      lower.includes("timeout")
    ) {
      return true;
    }
  }

  // HTTP status codes worth retrying
  if (status !== undefined) {
    // 429 Too Many Requests
    if (status === 429) return true;
    // 5xx Server errors
    if (status >= 500) return true;
    // 408 Request Timeout
    if (status === 408) return true;
  }

  return false;
}

/**
 * Parse a Retry-After header into milliseconds. Accepts both delta-seconds
 * and HTTP-date forms; returns undefined when absent or unparseable.
 */
function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(header);
  return Number.isNaN(at) ? undefined : Math.max(at - Date.now(), 0);
}

/**
 * Compute delay with exponential backoff + jitter.
 * For 429, respects Retry-After header if present.
 */
function computeDelay(
  attempt: number,
  baseDelayMs: number,
  retryAfterMs?: number,
): number {
  if (retryAfterMs !== undefined && retryAfterMs > 0) {
    return retryAfterMs;
  }
  // Exponential backoff: base * 2^attempt + random jitter (0~25% of delay)
  const exponential = baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * exponential * 0.25;
  return exponential + jitter;
}

/**
 * Fetch with automatic timeout, retry, and exponential backoff.
 *
 * Retries on: network errors, 5xx, 429, 408, timeout/abort.
 * Does NOT retry on: 4xx (except 429/408) — those are client errors.
 * 429 走独立预算（rateLimitRetries + onRateLimited），不消耗 maxRetries。
 */
export async function fetchWithRetry(
  url: string,
  options: FetchRetryOptions = {},
): Promise<Response> {
  const {
    maxRetries = DEFAULT_MAX_RETRIES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    rateLimitRetries = 0,
    onRateLimited,
    signal: externalSignal,
    ...fetchInit
  } = options;

  let lastError: Error | undefined;
  /** 通用通道已用的重试次数（超时 / 网络 / 5xx / 408 / 未挂通道的 429） */
  let attempt = 0;
  /** 429 通道已用的重试次数 */
  let rateLimitAttempt = 0;

  for (;;) {
    // Merge external signal with internal timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    // If external signal is already aborted, throw immediately
    if (externalSignal?.aborted) {
      clearTimeout(timeoutId);
      throw new Error(getTranslation("error.requestCancelled"));
    }

    // Forward external abort to internal controller
    const onExternalAbort = () => controller.abort();
    externalSignal?.addEventListener("abort", onExternalAbort);

    try {
      const resp = await fetch(url, {
        ...fetchInit,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      externalSignal?.removeEventListener("abort", onExternalAbort);

      // Success or non-retriable HTTP error → return as-is
      if (resp.ok || !isRetriable(resp.status)) {
        return resp;
      }

      // Retriable HTTP error (429, 5xx, 408)
      const text = await resp.text().catch(() => "");
      const retryAfterMs = resp.status === 429
        ? parseRetryAfterMs(resp.headers.get("retry-after"))
        : undefined;
      lastError = new HttpError(resp.status, text, retryAfterMs);

      // 429 专用通道：等待由调用方决定（登记冷却 + 睡到窗口解除），且不吃通用预算
      if (resp.status === 429 && onRateLimited) {
        if (rateLimitAttempt >= rateLimitRetries) break;
        rateLimitAttempt += 1;
        console.warn(
          `[fetchWithRetry] 429 on attempt ${rateLimitAttempt}/${rateLimitRetries}, waiting for rate-limit cooldown — ${url}`,
        );
        await onRateLimited({ retryAfterMs, attempt: rateLimitAttempt });
        continue;
      }

      // Don't retry on the last attempt
      if (attempt >= maxRetries) break;

      const delay = computeDelay(attempt, baseDelayMs, retryAfterMs);
      attempt += 1;
      console.warn(
        `[fetchWithRetry] ${resp.status} on attempt ${attempt}/${maxRetries}, retrying in ${Math.round(delay / 1000)}s — ${url}`,
      );
      await new Promise<void>((r) => setTimeout(r, delay));
    } catch (err) {
      clearTimeout(timeoutId);
      externalSignal?.removeEventListener("abort", onExternalAbort);

      const message = err instanceof Error ? err.message : String(err);
      lastError = err instanceof Error ? err : new Error(message);

      // Non-retriable error (e.g. 4xx from a prior resp path, or user abort)
      if (!isRetriable(undefined, message)) {
        throw lastError;
      }

      // Don't retry on the last attempt
      if (attempt >= maxRetries) break;

      const delay = computeDelay(attempt, baseDelayMs);
      attempt += 1;
      console.warn(
        `[fetchWithRetry] "${message}" on attempt ${attempt}/${maxRetries}, retrying in ${Math.round(delay / 1000)}s — ${url}`,
      );
      await new Promise<void>((r) => setTimeout(r, delay));
    }
  }

  throw lastError ?? new Error("fetch failed after retries");
}
