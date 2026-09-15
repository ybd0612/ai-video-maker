// ────────────────────────────────────────────────────────────────────────────
// tests/lib/refineContent.test.ts
// 内容精修循环单测：轮数控制、越界改判、失败兜底、onRound 回调。
// 断言来自 src/lib/refineContent.ts 真实实现。
// ────────────────────────────────────────────────────────────────────────────

import { describe, expect, it, vi } from "vitest";
import { refineWithAudit, type AuditOutcome } from "@/lib/refineContent";

/** 构造"前 n 次不 clean，之后 clean"的审计器 */
function auditSequence<T>(outcomes: Array<AuditOutcome<T>>) {
  let index = 0;
  return vi.fn(async (): Promise<AuditOutcome<T>> => {
    const outcome = outcomes[Math.min(index, outcomes.length - 1)];
    index++;
    return outcome;
  });
}

describe("refineWithAudit", () => {
  it("首轮即 clean 时只调用一次审计，并返回原始产出", async () => {
    const produce = vi.fn(async () => "draft");
    const audit = auditSequence<string>([{ clean: true, value: "unused" }]);

    const result = await refineWithAudit({ produce, audit, maxRounds: 3 });

    expect(result).toBe("draft");
    expect(produce).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledTimes(1);
  });

  it("越界时采用重写结果，下一轮 clean 即结束", async () => {
    const produce = vi.fn(async () => "draft");
    const audit = auditSequence<string>([
      { clean: false, value: "rewritten-1" },
      { clean: true, value: "unused" },
    ]);

    const result = await refineWithAudit({ produce, audit, maxRounds: 3 });

    expect(result).toBe("rewritten-1");
    expect(audit).toHaveBeenCalledTimes(2);
    // 第二轮审计收到的是上一轮重写结果
    expect(audit.mock.calls[1][0]).toBe("rewritten-1");
  });

  it("轮数耗尽仍不 clean 时返回最后一版重写结果", async () => {
    const produce = vi.fn(async () => "draft");
    const audit = auditSequence<string>([
      { clean: false, value: "rewritten-1" },
      { clean: false, value: "rewritten-2" },
    ]);

    const result = await refineWithAudit({ produce, audit, maxRounds: 2 });

    expect(result).toBe("rewritten-2");
    expect(audit).toHaveBeenCalledTimes(2);
  });

  it("审计抛错时保留当前内容并结束，不向上抛异常", async () => {
    const produce = vi.fn(async () => "draft");
    const audit = vi.fn(async () => {
      throw new Error("network down");
    });

    await expect(
      refineWithAudit({ produce, audit, maxRounds: 3 }),
    ).resolves.toBe("draft");
    expect(audit).toHaveBeenCalledTimes(1);
  });

  it("maxRounds 小于 1 时按 1 轮处理；回调报告每轮 clean 状态", async () => {
    const onRound = vi.fn();
    const audit = auditSequence<string>([{ clean: false, value: "rewritten" }]);

    const result = await refineWithAudit({
      produce: async () => "draft",
      audit,
      maxRounds: 0,
      onRound,
    });

    expect(result).toBe("rewritten");
    expect(onRound).toHaveBeenCalledTimes(1);
    expect(onRound).toHaveBeenCalledWith({ round: 1, clean: false });
  });

  it("支持结构化产出（对象）且保持引用替换语义", async () => {
    type Payload = { name: string; details: { tone: string } };
    const audit = auditSequence<Payload>([
      { clean: false, value: { name: "n2", details: { tone: "cool" } } },
      { clean: true, value: { name: "unused", details: { tone: "" } } },
    ]);

    const result = await refineWithAudit<Payload>({
      produce: async () => ({ name: "n1", details: { tone: "warm" } }),
      audit,
      maxRounds: 2,
    });

    expect(result).toEqual({ name: "n2", details: { tone: "cool" } });
  });
});
