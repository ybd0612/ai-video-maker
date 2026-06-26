// ────────────────────────────────────────────────────────────────────────────
// src/lib/fetchWithRetry.ts
// Unified fetch wrapper with timeout, retry, and exponential backoff.
// ────────────────────────────────────────────────────────────────────────────

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 60_000; // 60s per attempt
const DEFAULT_BASE_DELAY_MS = 2_000; // 2s base delay

export interface FetchRetryOptions extends RequestInit {
  /** Max number of retries after the first attempt. Default: 3 */
  maxRetries?: number;
  /** Timeout per attempt in ms. Default: 60000 */
  timeoutMs?: number;
  /** Base delay for exponential backoff in ms. Default: 2000 */
  baseDelayMs?: number;
  /** AbortSignal for cancellation (merged with internal timeout) */
  signal?: AbortSignal;
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
 * Compute delay with exponential backoff + jitter.
 * For 429, respects Retry-After header if present.
 */
function computeDelay(
  attempt: number,
  baseDelayMs: number,
  retryAfterHeader?: string | null,
): number {
  // Respect Retry-After header (seconds)
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (!Number.isNaN(seconds) && seconds > 0) {
      return seconds * 1000;
    }
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
 */
export async function fetchWithRetry(
  url: string,
  options: FetchRetryOptions = {},
): Promise<Response> {
  const {
    maxRetries = DEFAULT_MAX_RETRIES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    signal: externalSignal,
    ...fetchInit
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Merge external signal with internal timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    // If external signal is already aborted, throw immediately
    if (externalSignal?.aborted) {
      clearTimeout(timeoutId);
      throw new Error("请求已取消。");
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
      lastError = new Error(
        `HTTP ${resp.status}: ${text.slice(0, 300)}`,
      );

      // Don't retry on the last attempt
      if (attempt >= maxRetries) break;

      const delay = computeDelay(
        attempt,
        baseDelayMs,
        resp.headers.get("retry-after"),
      );
      console.warn(
        `[fetchWithRetry] ${resp.status} on attempt ${attempt + 1}/${maxRetries + 1}, retrying in ${Math.round(delay / 1000)}s — ${url}`,
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
      console.warn(
        `[fetchWithRetry] "${message}" on attempt ${attempt + 1}/${maxRetries + 1}, retrying in ${Math.round(delay / 1000)}s — ${url}`,
      );
      await new Promise<void>((r) => setTimeout(r, delay));
    }
  }

  throw lastError ?? new Error("fetch failed after retries");
}
