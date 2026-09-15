// ────────────────────────────────────────────────────────────────────────────
// tests/lib/logger.test.ts
// 日志/链路追踪内核单测：环形缓冲上限、级别与耗时、链路嵌套复原、开关与清空。
// 断言来自 src/lib/logger.ts 真实实现（纯内存，不触网）。
// ────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginTrace,
  clearLog,
  createTrace,
  exportLog,
  getLogSnapshot,
  logger,
  startSpan,
  subscribeLog,
  withTrace,
} from "@/lib/logger";
import { useSettingsStore } from "@/stores/settingsStore";

beforeEach(() => {
  clearLog();
  useSettingsStore.setState({ loggingEnabled: true });
});

describe("logger 基础记录", () => {
  it("按级别记录，并带上 scope / message / data", () => {
    logger.info("app", "启动");
    logger.warn("llm", "重试", { attempt: 2 });
    logger.error("image", "失败", { status: 500 });

    const entries = getLogSnapshot();
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({ level: "info", scope: "app", message: "启动" });
    expect(entries[1]).toMatchObject({ level: "warn", data: { attempt: 2 } });
    expect(entries[2]).toMatchObject({ level: "error", data: { status: 500 } });
  });

  it("关闭开关后不再写入", () => {
    useSettingsStore.setState({ loggingEnabled: false });
    logger.info("app", "应被忽略");
    expect(getLogSnapshot()).toHaveLength(0);
  });

  it("清空后列表为空，并通知订阅者", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLog(listener);
    logger.info("app", "a");
    expect(listener).toHaveBeenCalledTimes(1);
    clearLog();
    expect(getLogSnapshot()).toHaveLength(0);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("环形缓冲超过上限时丢弃最旧记录", () => {
    for (let i = 0; i < 1100; i++) logger.debug("app", `n${i}`);
    const entries = getLogSnapshot();
    expect(entries).toHaveLength(1000);
    // 最旧的 100 条被丢弃
    expect(entries[0].message).toBe("n100");
    expect(entries[entries.length - 1].message).toBe("n1099");
  });

  it("exportLog 输出包含导出时间与全部条目", () => {
    logger.info("app", "x");
    const parsed = JSON.parse(exportLog()) as { exportedAt: string; entries: unknown[] };
    expect(typeof parsed.exportedAt).toBe("string");
    expect(parsed.entries).toHaveLength(1);
  });
});

describe("span 与 trace", () => {
  it("span.end 记录耗时与结果，级别为 info", () => {
    const trace = createTrace("生成资产图", { projectId: "p1" });
    const span = trace.start("image", "POST /images/generations", { size: "2K" });
    span.end({ imageUrl: "http://x/1.png" });

    const done = getLogSnapshot().find(
      (e) => e.message === "POST /images/generations" && e.level === "info",
    );
    expect(done).toBeDefined();
    expect(done?.traceId).toBe(trace.traceId);
    expect(typeof done?.durationMs).toBe("number");
    expect(done?.data).toMatchObject({ size: "2K", imageUrl: "http://x/1.png" });
  });

  it("span.fail 记录错误信息，级别为 error", () => {
    const span = createTrace("t").start("llm", "chat");
    span.fail(new Error("boom"));

    const failed = getLogSnapshot().find((e) => e.level === "error");
    expect(failed?.data).toMatchObject({ errorName: "Error", errorMessage: "boom" });
  });

  it("span 重复结束只记录一次", () => {
    const span = createTrace("t").start("llm", "chat");
    span.end();
    span.end();
    span.fail(new Error("late"));
    expect(getLogSnapshot().filter((e) => e.message === "chat" && e.level !== "debug")).toHaveLength(1);
  });

  it("startSpan 无激活 trace 时自动创建独立链路", () => {
    const span = startSpan("llm", "chat");
    span.end();
    const done = getLogSnapshot().find((e) => e.message === "chat" && e.level === "info");
    expect(done?.traceId).toBeTruthy();
  });
});

describe("withTrace 链路包裹", () => {
  it("成功时产出完成记录，span 自动挂在同一 traceId 下", async () => {
    const result = await withTrace("生成视觉方向图", async (trace) => {
      const span = startSpan("image", "POST /images/generations");
      span.end({ imageUrl: "u" });
      return trace.traceId;
    });

    const entries = getLogSnapshot();
    const done = entries.find((e) => e.message === "生成视觉方向图 · 完成");
    expect(done?.traceId).toBe(result);
    expect(entries.every((e) => e.traceId === result)).toBe(true);
  });

  it("失败时记录失败并向外抛出", async () => {
    await expect(
      withTrace("生成资产图", async () => {
        throw new Error("api down");
      }),
    ).rejects.toThrow("api down");

    const failed = getLogSnapshot().find((e) => e.message === "生成资产图 · 失败");
    expect(failed?.data).toMatchObject({ errorMessage: "api down" });
  });

  it("嵌套链路各自独立 traceId，结束后外层仍为激活链路", async () => {
    let innerTraceId = "";
    let outer = "";
    await withTrace("外层", async (trace) => {
      outer = trace.traceId;
      await withTrace("内层", async (inner) => {
        innerTraceId = inner.traceId;
      });
      // 内层结束后，startSpan 应重新挂回外层
      startSpan("llm", "after-inner").end();
    });

    expect(innerTraceId).not.toBe(outer);
    const afterInner = getLogSnapshot().find((e) => e.message === "after-inner");
    expect(afterInner?.traceId).toBe(outer);
  });
});

describe("beginTrace 手动开合", () => {
  it("finish 记录完成并按 LIFO 复原激活链路", () => {
    const a = beginTrace("A");
    const b = beginTrace("B");
    b.finish();
    startSpan("llm", "in-a").end();
    a.finish();

    const inA = getLogSnapshot().find((e) => e.message === "in-a");
    expect(inA?.traceId).toBe(a.trace.traceId);
  });

  it("finish(error) 记录失败；重复 finish 只生效一次", () => {
    const t = beginTrace("X");
    t.finish(new Error("bad"));
    t.finish();

    const entries = getLogSnapshot().filter((e) => e.message.startsWith("X ·"));
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe("error");
  });
});
