// ────────────────────────────────────────────────────────────────────────────
// src/lib/logStorage.ts
// 日志的浏览器侧持久化（刷新 / 重新打开标签页后日志仍在）。
//
// 设计要点：
//   - 沿用项目既有约定（zustand persist 用 localStorage），不引入新依赖；
//   - 存储实现做成 adapter，便于单测注入内存实现（本项目只做 Vitest 单测）；
//   - 日志条目含完整请求/响应（prompt 可能极长），故按「条数上限 + 单条截断 +
//     总字节上限」三重收敛，避免撑爆 localStorage 配额；
//   - 任何存储异常都不影响主流程（load 返回 null / save 返回 false，由调用方决定策略）。
// ────────────────────────────────────────────────────────────────────────────

import type { LogEntry } from "@/lib/logger";

/** 存储键。带版本号：条目结构变更时递增，旧数据自然失效而非解析崩溃。 */
export const LOG_STORAGE_KEY = "wxhb:log:v1";

/** 持久化保留的最大条数（内存里是 1000，落盘收敛到更少，避免每次刷新读入过慢） */
export const PERSIST_MAX_ENTRIES = 300;

/** 单条日志序列化后的字节上限：超出则截断超长字段 */
export const PERSIST_MAX_ENTRY_BYTES = 8 * 1024;

/** 整体上限：约 1.5MB，留足 localStorage（通常 5MB）余量 */
export const PERSIST_MAX_TOTAL_BYTES = 1536 * 1024;

/** 单个字符串值的截断阈值（data 里的 prompt / raw 等） */
const MAX_STRING_VALUE_BYTES = 2000;

export interface LogStorageAdapter {
  /** 读取历史条目；无数据或读取失败返回 null */
  load(): LogEntry[] | null;
  /** 写入条目；失败（如配额超限）返回 false */
  save(entries: readonly LogEntry[]): boolean;
  /** 清空存储 */
  clear(): void;
}

/* ── 纯函数（可单测，不触碰任何浏览器 API） ─────────────────────────────── */

function byteLength(text: string): number {
  // Blob 在部分环境不可用，用 TextEncoder 计算真实字节数（中文 3 字节）
  return new TextEncoder().encode(text).length;
}

/** 截断字符串到指定字节数内（按字符边界安全裁剪） */
function truncateString(text: string, maxBytes: number): string {
  if (byteLength(text) <= maxBytes) return text;
  let result = text;
  while (result.length > 0 && byteLength(result) > maxBytes) {
    result = result.slice(0, Math.floor(result.length * 0.8));
  }
  return `${result}…[truncated ${text.length - result.length} chars]`;
}

/**
 * 收敛单条日志：data 里的超长字符串值（prompt / 响应全文）截断并标注，
 * 保留条目其余结构，避免整条日志因一个长字段被丢弃。
 */
export function shrinkEntry(
  entry: LogEntry,
  maxStringBytes = MAX_STRING_VALUE_BYTES,
): LogEntry {
  if (!entry.data) return entry;
  let changed = false;
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry.data)) {
    if (typeof value === "string" && byteLength(value) > maxStringBytes) {
      data[key] = truncateString(value, maxStringBytes);
      changed = true;
    } else {
      data[key] = value;
    }
  }
  return changed ? { ...entry, data } : entry;
}

/**
 * 选出要持久化的条目：从最新往回取，受条数与总字节双重限制；
 * 至少保留 1 条（即使单条就超总上限，也保留截断后的最新一条，便于排查）。
 */
export function selectEntriesForStorage(
  entries: readonly LogEntry[],
  maxEntries = PERSIST_MAX_ENTRIES,
  maxBytes = PERSIST_MAX_TOTAL_BYTES,
): LogEntry[] {
  const picked: LogEntry[] = [];
  let total = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (picked.length >= maxEntries) break;
    const entry = shrinkEntry(entries[i]);
    if (byteLength(JSON.stringify(entry)) > PERSIST_MAX_ENTRY_BYTES) {
      // 单条仍然过大（极端长 message）→ 去掉 data 再试
      const minimal: LogEntry = { ...entry };
      delete minimal.data;
      const size = byteLength(JSON.stringify(minimal));
      if (picked.length > 0 && total + size > maxBytes) break;
      picked.unshift(minimal);
      total += size;
      continue;
    }
    const size = byteLength(JSON.stringify(entry));
    if (picked.length > 0 && total + size > maxBytes) break;
    picked.unshift(entry);
    total += size;
  }
  return picked;
}

/** 校验从存储读回的原始数据（用户可能手改过 localStorage，或结构已过期） */
export function parseStoredEntries(raw: string | null): LogEntry[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const entries = parsed.filter((item): item is LogEntry => {
      if (!item || typeof item !== "object") return false;
      const e = item as Partial<LogEntry>;
      return (
        typeof e.id === "number" &&
        typeof e.ts === "number" &&
        typeof e.message === "string" &&
        typeof e.level === "string" &&
        typeof e.scope === "string"
      );
    });
    return entries.length > 0 ? entries : null;
  } catch {
    return null;
  }
}

/* ── Adapter 实现 ───────────────────────────────────────────────────────── */

function safeLocalStorage(): Storage | null {
  try {
    // 隐私模式下访问会抛错，故包一层
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** 浏览器 localStorage 适配器；不可用时降级为「不持久化」 */
export function createLocalStorageLogAdapter(
  key = LOG_STORAGE_KEY,
): LogStorageAdapter {
  return {
    load(): LogEntry[] | null {
      const store = safeLocalStorage();
      if (!store) return null;
      try {
        return parseStoredEntries(store.getItem(key));
      } catch {
        return null;
      }
    },
    save(entries: readonly LogEntry[]): boolean {
      const store = safeLocalStorage();
      if (!store) return false;
      try {
        store.setItem(key, JSON.stringify(entries));
        return true;
      } catch {
        // 配额超限：由调用方减半重试
        return false;
      }
    },
    clear(): void {
      const store = safeLocalStorage();
      if (!store) return;
      try {
        store.removeItem(key);
      } catch {
        /* 忽略 */
      }
    },
  };
}

/** 内存适配器（单测用）：行为与 localStorage 版一致 */
export function createMemoryLogAdapter(
  initial: string | null = null,
): LogStorageAdapter & { raw: () => string | null } {
  let data = initial;
  return {
    load: () => parseStoredEntries(data),
    save: (entries) => {
      data = JSON.stringify(entries);
      return true;
    },
    clear: () => {
      data = null;
    },
    raw: () => data,
  };
}
