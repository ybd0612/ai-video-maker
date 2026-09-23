// ────────────────────────────────────────────────────────────────────────────
// tests/services/rateLimit.test.ts
// 集中式用量限制器的单测：RPM 滑动窗口节流、Token Plan 配额、持久化、取消。
//
// 关键手法：rateLimiter 是模块级单例，内部状态（RPM 日志、配额用量）会跨用例残留。
// 因此每个用例都用 vi.resetModules() + 动态 import 取一份全新的单例，
// 并先装好 localStorage 桩（构造函数会立即读取持久化用量）。
// ────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installLocalStorageStub, removeLocalStorageStub } from "../helpers/localStorage";

/** 重置模块图并取一份全新的限流器单例 */
async function freshRateLimit() {
  vi.resetModules();
  const settings = await import("@/stores/settingsStore");
  const rateLimit = await import("@/services/rateLimit");

  return {
    rateLimiter: rateLimit.rateLimiter,
    RateLimitError: rateLimit.RateLimitError,
    getQuotaUsageSnapshot: rateLimit.getQuotaUsageSnapshot,
    setPlan: (plan: string) =>
      settings.useSettingsStore.getState().setProviderConfig({ plan: plan as never }),
  };
}

let backing: Map<string, string>;

beforeEach(() => {
  backing = installLocalStorageStub();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  removeLocalStorageStub();
});

describe("配额限制（仅 Token Plan 生效）", () => {
  it("免费档无订阅配额，不限制用量", async () => {
    const { rateLimiter, setPlan } = await freshRateLimit();
    setPlan("default");

    await expect(rateLimiter.acquire("video", { cost: 1000 })).resolves.toBeUndefined();
  });

  it("免费档不产生配额记账，快照返回 null", async () => {
    const { rateLimiter, setPlan, getQuotaUsageSnapshot } = await freshRateLimit();
    setPlan("default");

    await rateLimiter.acquire("image", { sizeTier: "1K", cost: 1 });

    expect(getQuotaUsageSnapshot()).toBeNull();
  });

  it("图片每日张数超限时抛出配额错误，并带上套餐与重置时间", async () => {
    const { rateLimiter, setPlan, RateLimitError } = await freshRateLimit();
    setPlan("pro");

    await rateLimiter.acquire("image", { sizeTier: "1K", cost: 4000 });

    const err = await rateLimiter
      .acquire("image", { sizeTier: "1K", cost: 1 })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RateLimitError);
    expect(err).toMatchObject({ reason: "quota", kind: "image", plan: "pro" });
    expect((err as Error).message).toContain("图片每日张数配额已用尽");
    expect((err as Error).message).toContain("4000/4000");
    expect((err as { resetMs?: number }).resetMs).toBeGreaterThanOrEqual(1000);
  });

  it("视频配额按秒累计", async () => {
    const { rateLimiter, setPlan } = await freshRateLimit();
    setPlan("pro");

    await rateLimiter.acquire("video", { cost: 500 });

    const err = await rateLimiter.acquire("video", { cost: 1 }).catch((e: unknown) => e);

    expect((err as { reason?: string }).reason).toBe("quota");
    expect((err as { kind?: string }).kind).toBe("video");
    expect((err as Error).message).toContain("视频每日时长配额已用尽");
    expect((err as Error).message).toContain("500/500");
  });

  it("配额恰好用尽时允许，超出一单位即拒绝（边界行为）", async () => {
    const { rateLimiter, setPlan } = await freshRateLimit();
    setPlan("pro");

    // 4000 张恰好等于上限，应通过
    await expect(
      rateLimiter.acquire("image", { sizeTier: "1K", cost: 4000 }),
    ).resolves.toBeUndefined();
    // 再加 1 张即超限
    await expect(rateLimiter.acquire("image", { sizeTier: "1K", cost: 1 })).rejects.toThrow(
      /配额已用尽/,
    );
  });

  it("前序请求被配额拒绝后，后续排队请求仍能正常执行（队列不会卡死）", async () => {
    const { rateLimiter, setPlan } = await freshRateLimit();
    setPlan("pro");

    await rateLimiter.acquire("image", { sizeTier: "1K", cost: 4000 });

    const first = await rateLimiter
      .acquire("image", { sizeTier: "1K", cost: 1 })
      .catch((e: unknown) => e);
    const second = await rateLimiter
      .acquire("image", { sizeTier: "1K", cost: 1 })
      .catch((e: unknown) => e);

    expect((first as { reason?: string }).reason).toBe("quota");
    expect((second as { reason?: string }).reason).toBe("quota");
  });
});

describe("配额用量快照", () => {
  it("反映当前套餐已用用量与上限", async () => {
    const { rateLimiter, setPlan, getQuotaUsageSnapshot } = await freshRateLimit();
    setPlan("pro");

    await rateLimiter.acquire("video", { cost: 30 });

    const snapshot = getQuotaUsageSnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot!.videoUsed).toBe(30);
    expect(snapshot!.videoLimit).toBe(500);
    expect(snapshot!.imageUsed).toBe(0);
    expect(snapshot!.imageLimit).toBe(4000);
  });
});

describe("配额持久化", () => {
  it("用量写入 localStorage，并在重新加载后恢复", async () => {
    const first = await freshRateLimit();
    first.setPlan("pro");
    await first.rateLimiter.acquire("image", { sizeTier: "1K", cost: 7 });

    expect(backing.has("wxhb-usage")).toBe(true);
    const persisted = JSON.parse(backing.get("wxhb-usage")!) as Record<string, { v: number }[]>;
    expect(persisted["tokenplan:pro:image:day"]).toHaveLength(1);
    expect(persisted["tokenplan:pro:image:day"][0].v).toBe(7);

    // 模拟页面刷新：重置模块后新单例应从 localStorage 读回用量
    const reloaded = await freshRateLimit();
    reloaded.setPlan("pro");
    expect(reloaded.getQuotaUsageSnapshot()!.imageUsed).toBe(7);
  });
});

describe("RPM 滑动窗口节流", () => {
  it("免费档视频 RPM=1，第二次调用会等待到窗口滑出", async () => {
    const { rateLimiter, setPlan } = await freshRateLimit();
    setPlan("default");
    vi.useFakeTimers();

    await rateLimiter.acquire("video");

    let settled = false;
    const second = rateLimiter.acquire("video").then(() => {
      settled = true;
    });

    // 窗口未滑出（60s）前不得放行
    await vi.advanceTimersByTimeAsync(60_000);
    expect(settled).toBe(false);

    // 越过窗口 + 50ms 余量后放行
    await vi.advanceTimersByTimeAsync(200);
    await second;
    expect(settled).toBe(true);
  });

  it("同一档位下限额未用满时不产生等待", async () => {
    const { rateLimiter, setPlan } = await freshRateLimit();
    setPlan("pro");
    vi.useFakeTimers();

    // pro 档视频 RPM=5，连续 5 次都不应等待
    for (let i = 0; i < 5; i++) {
      await rateLimiter.acquire("video", { cost: 1 });
    }

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("取消", () => {
  it("等待节流期间可被 AbortSignal 取消", async () => {
    const { rateLimiter, setPlan, RateLimitError } = await freshRateLimit();
    setPlan("default");

    // 占满免费档视频 RPM=1，使下一次调用进入等待
    await rateLimiter.acquire("video");

    const controller = new AbortController();
    controller.abort();

    const err = await rateLimiter
      .acquire("video", { signal: controller.signal })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as { reason?: string }).reason).toBe("aborted");
    expect((err as Error).message).toBe("请求已取消。");
  });
});

/* ── 429 闭环冷却 ──────────────────────────────────────────────────────────
   成因（2026-09-23 实测 debug-dump/runtime.log）：RPM 阈值表按官方文档取值，
   免费档 text RPM=20 时服务端在 12 请求/38s 就返回 429，acquire 的等待分支
   一次都没触发；而封锁窗口 16-20s 后自愈。因此 429 必须由入口回报给限流器，
   按分钟级登记冷却并让同 kind 的请求一律等窗口解除 —— 阈值表只作粗过滤。 */
describe("429 闭环冷却", () => {
  it("登记冷却后，同 kind 的 acquire 必须等到窗口解除才放行", async () => {
    const { rateLimiter, setPlan } = await freshRateLimit();
    setPlan("default");
    vi.useFakeTimers();

    // 不 await：notify 内部会睡到窗口解除
    void rateLimiter.notifyRateLimited("text");
    await vi.advanceTimersByTimeAsync(0);

    let released = false;
    const pending = rateLimiter.acquire("text").then(() => {
      released = true;
    });

    await vi.advanceTimersByTimeAsync(29_900);
    expect(released).toBe(false);

    await vi.advanceTimersByTimeAsync(200);
    await pending;
    expect(released).toBe(true);
  });

  it("Retry-After 过小会被抬到下限，避免退避回到秒级", async () => {
    const { rateLimiter } = await freshRateLimit();
    vi.useFakeTimers();

    let done = false;
    const pending = rateLimiter
      .notifyRateLimited("text", { retryAfterMs: 1_000 })
      .then(() => {
        done = true;
      });

    await vi.advanceTimersByTimeAsync(14_999);
    expect(done).toBe(false);

    await vi.advanceTimersByTimeAsync(2);
    await pending;
    expect(done).toBe(true);
  });

  it("Retry-After 过大时截断到上限，不无限挂起请求", async () => {
    const { rateLimiter } = await freshRateLimit();
    vi.useFakeTimers();

    let done = false;
    const pending = rateLimiter
      .notifyRateLimited("text", { retryAfterMs: 10 * 60_000 })
      .then(() => {
        done = true;
      });

    await vi.advanceTimersByTimeAsync(119_900);
    expect(done).toBe(false);

    await vi.advanceTimersByTimeAsync(200);
    await pending;
    expect(done).toBe(true);
  });

  it("并发 429 只延长冷却，第二次更早的窗口不得把放行时间提前", async () => {
    const { rateLimiter, setPlan } = await freshRateLimit();
    setPlan("default");
    vi.useFakeTimers();

    void rateLimiter.notifyRateLimited("text", { retryAfterMs: 60_000 });
    await vi.advanceTimersByTimeAsync(0);
    void rateLimiter.notifyRateLimited("text", { retryAfterMs: 20_000 });

    let released = false;
    const pending = rateLimiter.acquire("text").then(() => {
      released = true;
    });

    await vi.advanceTimersByTimeAsync(40_000);
    expect(released).toBe(false);

    await vi.advanceTimersByTimeAsync(20_100);
    await pending;
    expect(released).toBe(true);
  });

  it("冷却按模型种类隔离，图片被限流不阻塞文本", async () => {
    const { rateLimiter, setPlan } = await freshRateLimit();
    setPlan("pro");
    vi.useFakeTimers();

    void rateLimiter.notifyRateLimited("image");
    await vi.advanceTimersByTimeAsync(0);

    let textReleased = false;
    const textPending = rateLimiter.acquire("text").then(() => {
      textReleased = true;
    });
    let imageReleased = false;
    const imagePending = rateLimiter.acquire("image", { sizeTier: "1K" }).then(() => {
      imageReleased = true;
    });

    await vi.advanceTimersByTimeAsync(10);
    await textPending;
    expect(textReleased).toBe(true);
    expect(imageReleased).toBe(false);

    await vi.advanceTimersByTimeAsync(30_000);
    await imagePending;
    expect(imageReleased).toBe(true);
  });

  it("冷却等待可被 AbortSignal 取消", async () => {
    const { rateLimiter, RateLimitError } = await freshRateLimit();
    const controller = new AbortController();
    controller.abort();

    const err = await rateLimiter
      .notifyRateLimited("text", { signal: controller.signal })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as { reason?: string }).reason).toBe("aborted");
  });
});
