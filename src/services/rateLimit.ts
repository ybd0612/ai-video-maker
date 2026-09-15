// ────────────────────────────────────────────────────────────────────────────
// src/services/rateLimit.ts
// 集中式用量限制器：RPM 节流 + Token Plan 订阅配额追踪。
//
// 在真实 API 调用前调用 rateLimiter.acquire(kind, opts)：
//   - 文本（chatCompletion）、图片（generateImage）、视频（生成任务创建）三类入口统一经过此处。
//   - RPM：按模型种类（图片再按 1K/2K/3K/4K 档位）做 60s 滑动窗口节流；
//          达到上限则等待到最早的请求滑出窗口（天然把并发串行化，避免触发 429）。
//   - 配额：仅 Token Plan（Starter/Plus/Pro）生效，对文本(每5h/每周)、图片(每日张数)、
//          视频(每日秒数) 计数并持久化到 localStorage；用尽则抛出 RateLimitError（不可重试）。
//
// 设计取舍：以「实际 RPM」作安全上限；用量在 acquire 时即记账（保守，与服务器计数一致）。
// ────────────────────────────────────────────────────────────────────────────

import { getTranslation } from "@/i18n";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  WINDOW,
  resolvePlan,
  rpmFor,
  imageSizeToTier,
  type PlanConfig,
  type PlanId,
  type ModelKind,
  type SizeTier,
} from "@/lib/plans";

export type { SizeTier } from "@/lib/plans";

const STORAGE_KEY = "wxhb-usage";

/* ── 错误类型 ─────────────────────────────────────────────────────────────── */

export type RateLimitReason = "rpm" | "quota" | "aborted";

export class RateLimitError extends Error {
  readonly reason: RateLimitReason;
  readonly kind: ModelKind;
  /** 距限制重置的毫秒数（quota 用尽时给出，便于 UI 提示） */
  readonly resetMs?: number;
  readonly plan?: PlanId;

  constructor(opts: {
    reason: RateLimitReason;
    kind: ModelKind;
    message: string;
    resetMs?: number;
    plan?: PlanId;
  }) {
    super(opts.message);
    this.name = "RateLimitError";
    this.reason = opts.reason;
    this.kind = opts.kind;
    this.resetMs = opts.resetMs;
    this.plan = opts.plan;
  }
}

/* ── 内部类型 ─────────────────────────────────────────────────────────────── */

interface UsageEntry {
  t: number; // 时间戳 ms
  v: number; // 计数额（文本/图片=1，视频=秒数）
}

interface QuotaBucket {
  key: string;
  windowMs: number;
  limit: number;
  kind: ModelKind;
}

export interface AcquireOptions {
  /** 图片尺寸档位（图片种类必填，否则按 1K） */
  sizeTier?: SizeTier;
  /** 计费的用量成本：文本/图片 = 1，视频 = 请求时长（秒） */
  cost?: number;
  signal?: AbortSignal;
}

/* ── 工具：可中断的 sleep ──────────────────────────────────────────────────── */

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new RateLimitError({ reason: "aborted", kind: "text", message: getTranslation("error.requestCancelled") }));
      return;
    }
    const id = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(id);
      reject(new RateLimitError({ reason: "aborted", kind: "text", message: getTranslation("error.requestCancelled") }));
    };
    signal?.addEventListener("abort", onAbort);
  });
}

/* ── 限流器 ──────────────────────────────────────────────────────────────── */

class RateLimiter {
  /** 每模型种类一个串行队列，保证 RPM 等待按到达顺序进行 */
  private chain: Map<ModelKind, Promise<void>> = new Map();
  /** RPM 滑动窗口（内存，按会话）：key -> 时间戳数组 */
  private rpmLog: Map<string, number[]> = new Map();
  /** 持久化配额用量：bucketKey -> 计数项数组 */
  private usage: Record<string, UsageEntry[]> = {};

  constructor() {
    this.load();
  }

  /* ── 对外入口 ────────────────────────────────────────────────────────── */

  async acquire(kind: ModelKind, opts: AcquireOptions = {}): Promise<void> {
    const plan = resolvePlan(useSettingsStore.getState().providerConfig.plan as PlanId | undefined);
    const prev = this.chain.get(kind) ?? Promise.resolve();
    const run = prev.then(() => this.guard(kind, plan, opts));
    // 保持队列不中断（避免上一个请求的 reject 影响后续）
    this.chain.set(kind, run.then(() => {}, () => {}));
    await run; // 等待本请求自身的节流 + 配额检查完成（throw 会上抛）
  }

  /* ── 核心流程 ────────────────────────────────────────────────────────── */

  private async guard(kind: ModelKind, plan: PlanConfig, opts: AcquireOptions): Promise<void> {
    // 1) RPM 节流（可能等待）
    await this.throttleRpm(kind, plan, opts.sizeTier, opts.signal);
    // 2) 配额检查（超限直接抛错）
    this.checkQuota(kind, plan, opts.cost ?? 1);
    // 3) 记账
    this.recordRpm(kind, opts.sizeTier);
    this.recordQuota(kind, plan, opts.cost ?? 1);
  }

  /* ── RPM 滑动窗口 ───────────────────────────────────────────────────── */

  private async throttleRpm(
    kind: ModelKind,
    plan: PlanConfig,
    tier: SizeTier | undefined,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const limit = rpmFor(plan, kind, tier);
    const key = kind === "image" ? `img:${tier ?? "1K"}` : kind;
    // 默认档视频 RPM=1，会把并发串行化到约 1 次/分钟；其余档位通常无需等待
    for (;;) {
      const now = Date.now();
      const log = (this.rpmLog.get(key) ?? []).filter((t) => now - t < WINDOW.MINUTE);
      this.rpmLog.set(key, log);
      if (log.length < limit) return;
      const waitMs = WINDOW.MINUTE - (now - log[0]) + 50; // 等最早一条滑出窗口
      await sleep(waitMs, signal);
    }
  }

  private recordRpm(kind: ModelKind, tier: SizeTier | undefined): void {
    const key = kind === "image" ? `img:${tier ?? "1K"}` : kind;
    const log = this.rpmLog.get(key) ?? [];
    log.push(Date.now());
    this.rpmLog.set(key, log);
  }

  /* ── 配额（仅 Token Plan） ───────────────────────────────────────────── */

  private quotaBuckets(plan: PlanConfig): QuotaBucket[] {
    if (plan.accessType !== "tokenplan") return [];
    const tier = plan.id; // starter | plus | pro
    const q = plan.quota;
    const buckets: QuotaBucket[] = [];
    if (q.textPer5h)
      buckets.push({ key: `tokenplan:${tier}:text:5h`, windowMs: WINDOW.FIVE_HOURS, limit: q.textPer5h, kind: "text" });
    if (q.textPerWeek)
      buckets.push({ key: `tokenplan:${tier}:text:week`, windowMs: WINDOW.WEEK, limit: q.textPerWeek, kind: "text" });
    if (q.imagePerDay)
      buckets.push({ key: `tokenplan:${tier}:image:day`, windowMs: WINDOW.DAY, limit: q.imagePerDay, kind: "image" });
    if (q.videoSecondsPerDay)
      buckets.push({ key: `tokenplan:${tier}:video:day`, windowMs: WINDOW.DAY, limit: q.videoSecondsPerDay, kind: "video" });
    return buckets;
  }

  private prune(key: string, windowMs: number): UsageEntry[] {
    const now = Date.now();
    const entries = (this.usage[key] ?? []).filter((e) => now - e.t < windowMs);
    this.usage[key] = entries;
    return entries;
  }

  private checkQuota(kind: ModelKind, plan: PlanConfig, cost: number): void {
    for (const b of this.quotaBuckets(plan)) {
      if (b.kind !== kind) continue;
      const entries = this.prune(b.key, b.windowMs);
      const sum = entries.reduce((s, e) => s + e.v, 0);
      if (sum + cost > b.limit) {
        const oldest = entries[0]?.t ?? Date.now();
        const resetMs = Math.max(oldest + b.windowMs - Date.now(), 1000);
        throw new RateLimitError({
          reason: "quota",
          kind,
          plan: plan.id,
          resetMs,
          message:
            kind === "video"
              ? `视频每日时长配额已用尽（${sum}/${b.limit} 秒），预计 ${this.fmtReset(resetMs)} 后重置。可在设置中升级套餐或次日再试。`
              : kind === "image"
                ? `图片每日张数配额已用尽（${sum}/${b.limit} 张），预计 ${this.fmtReset(resetMs)} 后重置。可在设置中升级套餐或次日再试。`
                : `文本请求配额已用尽，预计 ${this.fmtReset(resetMs)} 后重置。可在设置中升级套餐。`,
        });
      }
    }
  }

  private recordQuota(kind: ModelKind, plan: PlanConfig, cost: number): void {
    for (const b of this.quotaBuckets(plan)) {
      if (b.kind !== kind) continue;
      const entries = this.usage[b.key] ?? [];
      entries.push({ t: Date.now(), v: cost });
      this.usage[b.key] = entries;
    }
    this.save();
  }

  /* ── 持久化 ─────────────────────────────────────────────────────────── */

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) this.usage = JSON.parse(raw) as Record<string, UsageEntry[]>;
    } catch {
      this.usage = {};
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.usage));
    } catch {
      /* 忽略持久化失败（隐私模式等） */
    }
  }

  /* ── 辅助 ───────────────────────────────────────────────────────────── */

  /**
   * 当前套餐的每日配额用量快照（供 UI 在审核卡点等处展示成本）。
   * 非 Token Plan（default/enterprise，无每日配额）时返回 null。
   */
  getQuotaUsageSnapshot(): { imageUsed: number; imageLimit: number; videoUsed: number; videoLimit: number } | null {
    const plan = resolvePlan(useSettingsStore.getState().providerConfig.plan as PlanId | undefined);
    if (plan.accessType !== "tokenplan") return null;
    const now = Date.now();
    const imageKey = `tokenplan:${plan.id}:image:day`;
    const videoKey = `tokenplan:${plan.id}:video:day`;
    const sum = (key: string) =>
      (this.usage[key] ?? [])
        .filter((e) => now - e.t < WINDOW.DAY)
        .reduce((s, e) => s + e.v, 0);
    return {
      imageUsed: sum(imageKey),
      imageLimit: plan.quota.imagePerDay ?? 0,
      videoUsed: sum(videoKey),
      videoLimit: plan.quota.videoSecondsPerDay ?? 0,
    };
  }

  private fmtReset(ms: number): string {
    const min = Math.ceil(ms / 60000);
    if (min < 60) return `${min} 分钟`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h < 24) return m ? `${h} 小时 ${m} 分` : `${h} 小时`;
    const d = Math.floor(h / 24);
    return `${d} 天 ${h % 24} 小时`;
  }
}

/* ── 单例 ───────────────────────────────────────────────────────────────── */

export const rateLimiter = new RateLimiter();

/** 当前套餐每日配额用量快照（非 Token Plan 返回 null），供审核卡点等处展示 */
export function getQuotaUsageSnapshot() {
  return rateLimiter.getQuotaUsageSnapshot();
}

/** 便捷：把像素尺寸字符串映射为图片档位（供调用方使用） */
export { imageSizeToTier };
