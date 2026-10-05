// ────────────────────────────────────────────────────────────────────────────
// tests/lib/batchRunner.test.ts
// createBatchRunner / hasActiveTask / runWithConcurrency 单元测试：
// 幂等守卫、并发上限、取消、空任务分支、生命周期顺序、单任务异常不外抛。
// ────────────────────────────────────────────────────────────────────────────

import { describe, expect, it, vi } from "vitest";
import {
  createBatchRunner,
  hasActiveTask,
  stopActiveBatch,
  runWithConcurrency,
} from "@/lib/batchRunner";

/** 创建一个可手动 resolve 的延迟任务 */
function makeDeferredTask(signal?: AbortSignal) {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  const done = vi.fn(() => promise);
  const finish = () => resolve();
  return { done, finish, signal };
}

describe("hasActiveTask", () => {
  it("注册表命中返回 true，删除后返回 false", () => {
    const registry = new Map<string, AbortController>();
    expect(hasActiveTask(registry, "p1")).toBe(false);
    registry.set("p1", new AbortController());
    expect(hasActiveTask(registry, "p1")).toBe(true);
    registry.delete("p1");
    expect(hasActiveTask(registry, "p1")).toBe(false);
  });
});

describe("stopActiveBatch", () => {
  it("注册表未命中时返回 false", () => {
    const registry = new Map<string, AbortController>();
    expect(stopActiveBatch(registry, "missing")).toBe(false);
  });

  it("命中时 abort，但保留注册表供 runner finally 清理", () => {
    const registry = new Map<string, AbortController>();
    const controller = new AbortController();
    registry.set("p1", controller);

    expect(stopActiveBatch(registry, "p1")).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    expect(registry.get("p1")).toBe(controller);
  });
});

describe("runWithConcurrency", () => {
  it("并发进行中的任务数不超过 n", async () => {
    let running = 0;
    let peak = 0;
    const tasks = Array.from({ length: 7 }, () => async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running -= 1;
    });
    await runWithConcurrency(tasks, 3);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBe(3);
  });

  it("signal abort 后 worker 停止领取新任务", async () => {
    const controller = new AbortController();
    const executed: number[] = [];
    const tasks = Array.from({ length: 5 }, (_, i) => async () => {
      executed.push(i);
      if (i === 0) controller.abort();
    });
    await runWithConcurrency(tasks, 1, controller.signal);
    expect(executed).toEqual([0]);
  });
});

describe("createBatchRunner", () => {
  it("幂等守卫：在飞时二次调用不启动新任务", async () => {
    const registry = new Map<string, AbortController>();
    const deferred = makeDeferredTask();
    const buildTasks = vi.fn(
      (_pid: string, _signal: AbortSignal) => [deferred.done],
    );
    const runner = createBatchRunner({ registry, buildTasks });

    const first = runner({ projectId: "p1", concurrency: 1 });
    expect(buildTasks).toHaveBeenCalledTimes(1);
    expect(registry.has("p1")).toBe(true);

    // 第一轮在飞（任务未结束）时再次调用 → 幂等返回，不重复 build、不覆盖注册表
    await runner({ projectId: "p1", concurrency: 1 });
    expect(buildTasks).toHaveBeenCalledTimes(1);
    expect(registry.size).toBe(1);

    deferred.finish();
    await first;
    expect(registry.has("p1")).toBe(false);
  });

  it("幂等守卫：第一轮结束后可再次启动", async () => {
    const registry = new Map<string, AbortController>();
    const buildTasks = vi.fn((_pid: string, _signal: AbortSignal) => [
      async () => {},
    ]);
    const runner = createBatchRunner({ registry, buildTasks });

    await runner({ projectId: "p1", concurrency: 1 });
    expect(registry.has("p1")).toBe(false);
    await runner({ projectId: "p1", concurrency: 1 });
    expect(buildTasks).toHaveBeenCalledTimes(2);
  });

  it("并发上限：同时进行的任务 ≤ concurrency", async () => {
    const registry = new Map<string, AbortController>();
    let running = 0;
    let peak = 0;
    const runner = createBatchRunner({
      registry,
      buildTasks: () =>
        Array.from({ length: 6 }, () => async () => {
          running += 1;
          peak = Math.max(peak, running);
          await new Promise((r) => setTimeout(r, 5));
          running -= 1;
        }),
    });

    await runner({ projectId: "p1", concurrency: 2 });
    expect(peak).toBe(2);
  });

  it("取消：abort 后剩余任务跳过，registry 已清", async () => {
    const registry = new Map<string, AbortController>();
    const executed: string[] = [];
    const deferred = makeDeferredTask();

    const runner = createBatchRunner({
      registry,
      buildTasks: () => [
        deferred.done,
        async () => {
          executed.push("second");
        },
      ],
    });

    const runPromise = runner({ projectId: "p1", concurrency: 1 });
    // 经注册表拿到 runner 内部的 controller 执行取消
    // （当前 Node 运行时的 AbortSignal 实例被裁剪了 abort 方法，必须走 controller.abort()）
    registry.get("p1")!.abort();
    deferred.finish();
    await runPromise;

    expect(executed).toEqual([]); // 第二个任务被跳过
    expect(registry.has("p1")).toBe(false);
  });

  it("stopActiveBatch 会让未开始任务跳过并执行 finally 收尾", async () => {
    const registry = new Map<string, AbortController>();
    const started: string[] = [];
    const onFinally = vi.fn();
    const deferred = makeDeferredTask();

    const runner = createBatchRunner({
      registry,
      buildTasks: () => [
        async () => {
          started.push("in-flight");
          await deferred.done();
        },
        async () => { started.push("unstarted"); },
      ],
      onFinally,
    });

    const runPromise = runner({ projectId: "p1", concurrency: 1 });
    expect(stopActiveBatch(registry, "p1")).toBe(true);
    deferred.finish();
    await runPromise;

    expect(started).toEqual(["in-flight"]);
    expect(onFinally).toHaveBeenCalledWith("p1");
    expect(registry.has("p1")).toBe(false);
  });

  it("零任务走 onEmpty，不注册、不触发 onBeforeRun/onFinally", async () => {
    const registry = new Map<string, AbortController>();
    const onEmpty = vi.fn();
    const onBeforeRun = vi.fn();
    const onFinally = vi.fn();

    const runner = createBatchRunner({
      registry,
      buildTasks: () => [],
      onEmpty,
      onBeforeRun,
      onFinally,
    });

    await runner({ projectId: "p1", concurrency: 3 });

    expect(onEmpty).toHaveBeenCalledWith("p1");
    expect(onBeforeRun).not.toHaveBeenCalled();
    expect(onFinally).not.toHaveBeenCalled();
    expect(registry.has("p1")).toBe(false);
  });

  it("生命周期顺序：onBeforeRun → 任务 → registry.delete → onFinally", async () => {
    const registry = new Map<string, AbortController>();
    const events: string[] = [];

    const runner = createBatchRunner({
      registry,
      buildTasks: () => [
        async () => {
          events.push("task");
          expect(registry.has("p1")).toBe(true); // 执行期间在注册表中
        },
      ],
      onBeforeRun: () => events.push("onBeforeRun"),
      onFinally: () => {
        events.push("onFinally");
        expect(registry.has("p1")).toBe(false); // finally-delete 先于 onFinally
      },
    });

    await runner({ projectId: "p1", concurrency: 1 });
    expect(events).toEqual(["onBeforeRun", "task", "onFinally"]);
  });

  it("recoverStuck 在守卫通过后、buildTasks 之前调用", async () => {
    const registry = new Map<string, AbortController>();
    const order: string[] = [];
    const recoverStuck = vi.fn(() => order.push("recoverStuck"));
    const buildTasks = vi.fn(() => {
      order.push("buildTasks");
      return [async () => {}];
    });

    const runner = createBatchRunner({ registry, recoverStuck, buildTasks });
    await runner({ projectId: "p1", concurrency: 1 });

    expect(order).toEqual(["recoverStuck", "buildTasks"]);
    expect(recoverStuck).toHaveBeenCalledWith("p1");
  });

  it("单任务异常不 reject 整体，其余任务照常执行", async () => {
    const registry = new Map<string, AbortController>();
    const executed: string[] = [];
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const runner = createBatchRunner({
      registry,
      buildTasks: () => [
        async () => {
          throw new Error("boom");
        },
        async () => {
          executed.push("ok");
        },
      ],
    });

    await expect(runner({ projectId: "p1", concurrency: 2 })).resolves.toBeUndefined();
    expect(executed).toEqual(["ok"]);
    expect(registry.has("p1")).toBe(false);

    consoleError.mockRestore();
  });

  it("onFinally 在任务抛异常时依然执行（finally 语义）", async () => {
    const registry = new Map<string, AbortController>();
    const onFinally = vi.fn();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const runner = createBatchRunner({
      registry,
      buildTasks: () => [
        async () => {
          throw new Error("boom");
        },
      ],
      onFinally,
    });

    await expect(runner({ projectId: "p1", concurrency: 1 })).resolves.toBeUndefined();
    expect(onFinally).toHaveBeenCalledWith("p1");
    expect(registry.has("p1")).toBe(false);

    consoleError.mockRestore();
  });
});
