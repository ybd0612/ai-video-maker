// ────────────────────────────────────────────────────────────────────────────
// src/lib/logger.ts
// 统一日志 + 链路追踪内核（内存环形缓冲，零依赖，不上报网络）。
//
// 结构：
//   一次用户动作（提取资产 / 生成资产图 / …）= 一个 trace
//   该动作内的每次模型调用（文本 / 图片 / 视频）= 一个 span（挂在 trace 下）
//
// 用法：
//   await withTrace("提取资产", async (trace) => {
//     const span = trace.start("llm", "chat.completions", { purpose });
//     try { ... span.end({ tokens }); } catch (e) { span.fail(e); throw e; }
//   });
//   服务层无需改签名：currentTrace() 自动挂到当前 trace 上。
//
// 开关：
//   settingsStore.loggingEnabled（默认开启）—— 关闭后所有写入变为空操作。
// 持久化：内存环形缓冲（1000 条）为主，变更后防抖写入 localStorage（收敛到 300 条、
//   单条超长字段截断、总字节封顶）；页面隐藏 / 卸载时立即落盘，避免丢失尾部日志。
//   持久化是系统固有行为（刷新 / 重开标签页日志仍在），**不设开关**。
// ────────────────────────────────────────────────────────────────────────────

import { useSettingsStore } from "@/stores/settingsStore";
import {
  createLocalStorageLogAdapter,
  selectEntriesForStorage,
  type LogStorageAdapter,
} from "@/lib/logStorage";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  id: number;
  ts: number;
  level: LogLevel;
  /** 来源分类：trace / llm / image / video / app / error */
  scope: string;
  traceId?: string;
  spanId?: string;
  message: string;
  durationMs?: number;
  data?: Record<string, unknown>;
}

const MAX_ENTRIES = 1000;

let nextId = 1;
let buffer: LogEntry[] = [];
let snapshot: readonly LogEntry[] = [];
const listeners = new Set<() => void>();

/** 让 lib 层不依赖 React：直接读设置里的开关 */
function loggingEnabled(): boolean {
  try {
    return useSettingsStore.getState().loggingEnabled !== false;
  } catch {
    return true;
  }
}

function emit(entry: Omit<LogEntry, "id" | "ts">): LogEntry {
  const full: LogEntry = { ...entry, id: nextId++, ts: Date.now() };
  if (!loggingEnabled()) return full;
  buffer.push(full);
  if (buffer.length > MAX_ENTRIES) buffer = buffer.slice(buffer.length - MAX_ENTRIES);
  snapshot = buffer.slice();
  for (const listener of listeners) listener();
  schedulePersist();
  return full;
}

/** React 订阅（配合 useSyncExternalStore） */
export function subscribeLog(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLogSnapshot(): readonly LogEntry[] {
  return snapshot;
}

export function clearLog(): void {
  buffer = [];
  snapshot = [];
  clearPersistedLog();
  for (const listener of listeners) listener();
}

/* ── 浏览器侧持久化（刷新后日志仍在） ──────────────────────────────────── */

const PERSIST_FLUSH_MS = 800;

let storage: LogStorageAdapter | null = null;
let persistTimer: ReturnType<typeof setTimeout> | undefined;
let hydrated = false;

/** 持久化跟随采集开关：采集关闭时既不写盘，也不恢复历史 */
function persistenceEnabled(): boolean {
  return loggingEnabled();
}

function getStorage(): LogStorageAdapter {
  if (!storage) storage = createLocalStorageLogAdapter();
  return storage;
}

/**
 * 注入存储实现（单测用内存 adapter，或需要换用其它存储介质时）。
 * 传 null 恢复默认的 localStorage 适配器。
 */
export function setLogStorage(adapter: LogStorageAdapter | null): void {
  storage = adapter;
}

/** 立即把当前缓冲写入存储（幂等、可反复调用） */
export function flushLogPersist(): void {
  if (persistTimer !== undefined) {
    clearTimeout(persistTimer);
    persistTimer = undefined;
  }
  if (!persistenceEnabled()) return;
  const adapter = getStorage();
  const entries = selectEntriesForStorage(buffer);
  if (entries.length === 0) {
    adapter.clear();
    return;
  }
  if (adapter.save(entries)) return;
  // 配额超限：逐级减半重试，尽量保住最近的日志
  let reduced = entries;
  while (reduced.length > 1) {
    reduced = reduced.slice(Math.ceil(reduced.length / 2));
    if (adapter.save(reduced)) return;
  }
  console.warn("[logger] 日志持久化失败：浏览器存储配额不足，已放弃本次写入");
}

function schedulePersist(): void {
  if (!persistenceEnabled()) return;
  if (persistTimer !== undefined) return;
  persistTimer = setTimeout(() => {
    persistTimer = undefined;
    flushLogPersist();
  }, PERSIST_FLUSH_MS);
}

/** 清空持久化日志（不影响内存缓冲） */
export function clearPersistedLog(): void {
  try {
    getStorage().clear();
  } catch {
    /* 存储不可用时忽略 */
  }
}

/**
 * 从存储恢复历史日志（幂等：重复调用只生效一次）。
 * force=true 时忽略幂等标记，用于测试或手动重载历史。
 */
export function hydrateLog(opts?: { force?: boolean }): void {
  if (hydrated && !opts?.force) return;
  hydrated = true;
  if (!persistenceEnabled()) return;
  const restored = getStorage().load();
  if (!restored || restored.length === 0) return;
  buffer = restored.slice(-MAX_ENTRIES);
  // id 从历史最大值续起，避免恢复后的新日志与历史 id 冲突（面板用它做 key）
  nextId = Math.max(...buffer.map((entry) => entry.id), 0) + 1;
  snapshot = buffer.slice();
  for (const listener of listeners) listener();
}

/**
 * 注册持久化：启动时恢复历史，并在页面隐藏 / 卸载时立即落盘。
 * 由 main.tsx 调用一次（SSR / 测试环境安全）。
 */
export function setupLogPersistence(): void {
  hydrateLog();
  if (typeof window === "undefined") return;
  // pagehide 比 beforeunload 更可靠（移动端与 bfcache 场景）
  window.addEventListener("pagehide", flushLogPersist);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushLogPersist();
  });
}

/** 导出为可下载的 JSON（用于问题反馈） */
/**
 * 日志消息的 i18n key 前缀（约定）。
 * message 以该前缀开头时视为词典 key，在**渲染 / 导出 / 落盘**时按当前语言翻译；
 * 其余 message（HTTP 端点名等技术标识）原样输出。
 * 如此 logger 仍与 i18n 解耦（只认前缀），而界面与 runtime.log 都保持可读。
 */
export const LOG_MESSAGE_PREFIX = "logmsg.";

/** 该 message 是否为待翻译的日志消息 key */
export function isLogMessageKey(message: string): boolean {
  return message.startsWith(LOG_MESSAGE_PREFIX);
}

/** 渲染日志消息：key 走翻译函数，非 key 原样返回 */
export function renderLogMessage(
  message: string,
  translate: (key: string) => string,
): string {
  return isLogMessageKey(message) ? translate(message) : message;
}

/**
 * 导出日志 JSON。传入 translate 时把 logmsg.* 消息翻译成当前语言，
 * 便于人工阅读与直接交给 AI 分析。
 */
export function exportLog(translate?: (message: string) => string): string {
  const entries = translate
    ? buffer.map((entry) =>
        isLogMessageKey(entry.message)
          ? { ...entry, message: translate(entry.message) }
          : entry,
      )
    : buffer;
  return JSON.stringify(
    { exportedAt: new Date().toISOString(), entries },
    null,
    2,
  );
}

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/* ── 直接记日志 ─────────────────────────────────────────────────────────── */

export const logger = {
  debug: (scope: string, message: string, data?: Record<string, unknown>) =>
    void emit({ level: "debug", scope, message, data }),
  info: (scope: string, message: string, data?: Record<string, unknown>) =>
    void emit({ level: "info", scope, message, data }),
  warn: (scope: string, message: string, data?: Record<string, unknown>) =>
    void emit({ level: "warn", scope, message, data }),
  error: (scope: string, message: string, data?: Record<string, unknown>) =>
    void emit({ level: "error", scope, message, data }),
};

/* ── Span / Trace ───────────────────────────────────────────────────────── */

export interface LogSpan {
  spanId: string;
  /** 正常结束：记录耗时与附加结果 */
  end: (data?: Record<string, unknown>) => void;
  /** 失败结束：记录耗时与错误信息 */
  fail: (error: unknown) => void;
}

export interface TraceContext {
  traceId: string;
  /** primitive：在 trace 下开一个 span */
  start: (scope: string, message: string, data?: Record<string, unknown>) => LogSpan;
  info: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, data?: Record<string, unknown>) => void;
}

function errorInfo(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { errorName: error.name, errorMessage: error.message };
  }
  return { errorMessage: String(error) };
}

function makeSpan(
  traceId: string,
  scope: string,
  message: string,
  data?: Record<string, unknown>,
): LogSpan {
  const spanId = newId();
  const startedAt = Date.now();
  emit({ level: "debug", scope, traceId, spanId, message: `${message} …`, data });
  let closed = false;
  return {
    spanId,
    end(extra) {
      if (closed) return;
      closed = true;
      emit({
        level: "info",
        scope,
        traceId,
        spanId,
        message,
        durationMs: Date.now() - startedAt,
        data: { ...data, ...extra },
      });
    },
    fail(error) {
      if (closed) return;
      closed = true;
      emit({
        level: "error",
        scope,
        traceId,
        spanId,
        message,
        durationMs: Date.now() - startedAt,
        data: { ...data, ...errorInfo(error) },
      });
    },
  };
}

export function createTrace(name: string, data?: Record<string, unknown>): TraceContext {
  const traceId = newId();
  emit({ level: "info", scope: "trace", traceId, message: name, data });
  return {
    traceId,
    start: (scope, message, spanData) => makeSpan(traceId, scope, message, spanData),
    info: (message, extra) => void emit({ level: "info", scope: "trace", traceId, message, data: extra }),
    warn: (message, extra) => void emit({ level: "warn", scope: "trace", traceId, message, data: extra }),
    error: (message, extra) => void emit({ level: "error", scope: "trace", traceId, message, data: extra }),
  };
}

/** 当前激活的 trace（栈式嵌套，服务层据此自动挂 span） */
let activeTrace: TraceContext | null = null;

export function currentTrace(): TraceContext | null {
  return activeTrace;
}

/**
 * 开一个 span：优先挂到当前激活的 trace 上；没有激活 trace 时（散落的
 * 单次调用，如字段润色）自动创建一个"独立调用"trace，保证调用不被漏记。
 */
export function startSpan(
  scope: string,
  message: string,
  data?: Record<string, unknown>,
): LogSpan {
  const trace = activeTrace ?? createTrace(`${scope} · 独立调用`);
  return trace.start(scope, message, data);
}

/**
 * 开启一次 trace 但不接管控制流：调用方在结束时调用 finish()。
 * 用于不便整体包裹的老函数（栈式嵌套：LIFO 顺序 finish 即可正确复原）。
 */
export function beginTrace(
  name: string,
  data?: Record<string, unknown>,
): { trace: TraceContext; finish: (error?: unknown) => void } {
  const previous = activeTrace;
  const trace = createTrace(name, data);
  activeTrace = trace;
  const startedAt = Date.now();
  let closed = false;
  return {
    trace,
    finish: (error?: unknown) => {
      if (closed) return;
      closed = true;
      emit(
        error === undefined
          ? {
              level: "info",
              scope: "trace",
              traceId: trace.traceId,
              message: `${name} · 完成`,
              durationMs: Date.now() - startedAt,
            }
          : {
              level: "error",
              scope: "trace",
              traceId: trace.traceId,
              message: `${name} · 失败`,
              durationMs: Date.now() - startedAt,
              data: errorInfo(error),
            },
      );
      activeTrace = previous;
    },
  };
}

/**
 * 以一次 trace 包裹异步动作：自动结束、自动记录异常，并保证嵌套后正确复原。
 * trace 只做观测，任何日志异常都不影响主流程（emit 内部已兜底）。
 */
export async function withTrace<T>(
  name: string,
  fn: (trace: TraceContext) => Promise<T>,
  data?: Record<string, unknown>,
): Promise<T> {
  const previous = activeTrace;
  const trace = createTrace(name, data);
  activeTrace = trace;
  const startedAt = Date.now();
  try {
    const result = await fn(trace);
    emit({
      level: "info",
      scope: "trace",
      traceId: trace.traceId,
      message: `${name} · 完成`,
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    emit({
      level: "error",
      scope: "trace",
      traceId: trace.traceId,
      message: `${name} · 失败`,
      durationMs: Date.now() - startedAt,
      data: errorInfo(error),
    });
    throw error;
  } finally {
    activeTrace = previous;
  }
}

/**
 * 同步动作的 trace 包装（无 await 的写回、清理等）。
 * 与 withTrace 共用同一套 span 机制。
 */
export function withTraceSync<T>(
  name: string,
  fn: (trace: TraceContext) => T,
  data?: Record<string, unknown>,
): T {
  const previous = activeTrace;
  const trace = createTrace(name, data);
  activeTrace = trace;
  const startedAt = Date.now();
  try {
    const result = fn(trace);
    emit({
      level: "info",
      scope: "trace",
      traceId: trace.traceId,
      message: `${name} · 完成`,
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    emit({
      level: "error",
      scope: "trace",
      traceId: trace.traceId,
      message: `${name} · 失败`,
      durationMs: Date.now() - startedAt,
      data: errorInfo(error),
    });
    throw error;
  } finally {
    activeTrace = previous;
  }
}
