// ────────────────────────────────────────────────────────────────────────────
// tests/lib/logStorage.test.ts
// 日志持久化单测：条目收敛（截断 / 条数 / 字节上限）、读取校验、adapter 往返。
// 纯函数 + 内存 adapter，不触碰浏览器 API。
// ────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import {
  PERSIST_MAX_ENTRIES,
  createLocalStorageLogAdapter,
  createMemoryLogAdapter,
  parseStoredEntries,
  selectEntriesForStorage,
  shrinkEntry,
} from "@/lib/logStorage";
import type { LogEntry } from "@/lib/logger";

function entry(id: number, overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id,
    ts: 1_700_000_000_000 + id,
    level: "info",
    scope: "app",
    message: "logmsg.sessionStart",
    ...overrides,
  };
}

describe("shrinkEntry：超长字段截断", () => {
  it("截断超长字符串值并标注，短值保持原样", () => {
    const long = "x".repeat(5000);
    const shrunk = shrinkEntry(entry(1, { data: { prompt: long, short: "ok" } }));
    expect(shrunk.data?.short).toBe("ok");
    const prompt = shrunk.data?.prompt as string;
    expect(prompt.length).toBeLessThan(long.length);
    expect(prompt).toContain("[truncated");
  });

  it("无 data 时原样返回（同一引用，不做无谓拷贝）", () => {
    const e = entry(2);
    expect(shrinkEntry(e)).toBe(e);
  });

  it("非字符串字段不受影响", () => {
    const shrunk = shrinkEntry(entry(3, { data: { count: 123, ok: true, list: [1, 2] } }));
    expect(shrunk.data).toEqual({ count: 123, ok: true, list: [1, 2] });
  });
});

describe("selectEntriesForStorage：条数与字节上限", () => {
  it("超过条数上限时保留最新的 N 条，且按时间正序返回", () => {
    const entries = Array.from({ length: PERSIST_MAX_ENTRIES + 50 }, (_, i) => entry(i));
    const picked = selectEntriesForStorage(entries);
    expect(picked).toHaveLength(PERSIST_MAX_ENTRIES);
    // 保留的是尾部（最新），顺序仍为正序
    expect(picked[0].id).toBe(50);
    expect(picked[picked.length - 1].id).toBe(PERSIST_MAX_ENTRIES + 49);
  });

  it("总字节上限触发提前截断，但至少保留最新一条", () => {
    const big = "y".repeat(2000);
    const entries = Array.from({ length: 100 }, (_, i) => entry(i, { data: { prompt: big } }));
    const picked = selectEntriesForStorage(entries, 300, 10 * 1024);
    expect(picked.length).toBeGreaterThan(0);
    expect(picked.length).toBeLessThan(100);
    expect(picked[picked.length - 1].id).toBe(99);
  });

  it("空输入返回空数组", () => {
    expect(selectEntriesForStorage([])).toEqual([]);
  });
});

describe("parseStoredEntries：读取校验（防手改 / 结构过期）", () => {
  it("合法 JSON 数组正常解析", () => {
    const raw = JSON.stringify([entry(1)]);
    expect(parseStoredEntries(raw)?.length).toBe(1);
  });

  it("null / 空串 / 非法 JSON / 非数组 一律返回 null", () => {
    expect(parseStoredEntries(null)).toBeNull();
    expect(parseStoredEntries("")).toBeNull();
    expect(parseStoredEntries("{oops")).toBeNull();
    expect(parseStoredEntries('{"a":1}')).toBeNull();
  });

  it("过滤缺失必需字段的条目；全部非法时返回 null", () => {
    const raw = JSON.stringify([
      entry(1),
      { id: 2 }, // 缺 ts/level/scope/message
      "not-an-object",
    ]);
    const parsed = parseStoredEntries(raw);
    expect(parsed?.length).toBe(1);
    expect(parsed?.[0].id).toBe(1);
    expect(parseStoredEntries(JSON.stringify([{ id: 9 }]))).toBeNull();
  });

  it("空数组返回 null（视为无历史）", () => {
    expect(parseStoredEntries("[]")).toBeNull();
  });
});

describe("adapter 行为", () => {
  it("内存 adapter：save → load 往返一致，clear 后为空", () => {
    const adapter = createMemoryLogAdapter();
    expect(adapter.load()).toBeNull();
    expect(adapter.save([entry(1), entry(2)])).toBe(true);
    expect(adapter.load()?.map((e) => e.id)).toEqual([1, 2]);
    adapter.clear();
    expect(adapter.load()).toBeNull();
  });

  it("内存 adapter：可带初始数据构造", () => {
    const adapter = createMemoryLogAdapter(JSON.stringify([entry(7)]));
    expect(adapter.load()?.[0].id).toBe(7);
  });

  it("localStorage adapter 在无 localStorage 环境（单测/node）安全降级", () => {
    const adapter = createLocalStorageLogAdapter("wxhb:test:log");
    expect(() => adapter.load()).not.toThrow();
    expect(adapter.load()).toBeNull();
    expect(adapter.save([entry(1)])).toBe(false);
    expect(() => adapter.clear()).not.toThrow();
  });
});
