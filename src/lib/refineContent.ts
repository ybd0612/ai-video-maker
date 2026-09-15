// ────────────────────────────────────────────────────────────────────────────
// src/lib/refineContent.ts
// 通用内容精修循环：生成 → 审计 → 越界则采用重写 → 再审计，最多 maxRounds 轮。
//
// 原则（2026-09-15 用户确立）：允许慢、允许多次调用大模型来完善内容；
// 代码只做流程控制（轮数、终止条件、失败兜底），
// 是否越界、如何重写全部由大模型判断。
// ────────────────────────────────────────────────────────────────────────────

/** 一次审计结果：clean 为 true 时 value 无意义，false 时 value 为重写后的内容 */
export interface AuditOutcome<T> {
  clean: boolean;
  value: T;
}

export interface RefineWithAuditOptions<T> {
  /** 首次产出（调用一次） */
  produce: () => Promise<T>;
  /** 审计当前内容；返回 clean=true 结束，clean=false 时 value 作为下一轮输入 */
  audit: (current: T, round: number) => Promise<AuditOutcome<T>>;
  /** 最多审计轮数（>=1；轮数耗尽后返回最后一版内容） */
  maxRounds: number;
  onRound?: (info: { round: number; clean: boolean }) => void;
}

/**
 * 精修循环。审计抛错时保留当前内容并结束（不阻塞主链路）。
 * 轮数耗尽仍不 clean 时返回最后一次重写结果，由调用方决定是否提示用户。
 */
export async function refineWithAudit<T>(
  opts: RefineWithAuditOptions<T>,
): Promise<T> {
  // TS 泛型无法表达"T 本身不是 Promise"，Awaited<T> 与 T 在调用方均为普通值时等价。
  let current = (await opts.produce()) as T;
  const rounds = Math.max(1, Math.floor(opts.maxRounds));

  for (let round = 1; round <= rounds; round++) {
    let outcome: AuditOutcome<T>;
    try {
      outcome = await opts.audit(current, round);
    } catch (err) {
      console.warn("Content audit failed, keeping current value:", err);
      return current;
    }
    opts.onRound?.({ round, clean: outcome.clean });
    if (outcome.clean) return current;
    current = outcome.value;
  }

  return current;
}
