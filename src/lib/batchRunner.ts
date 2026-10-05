// ────────────────────────────────────────────────────────────────────────────
// src/lib/batchRunner.ts
// 批量任务执行器：幂等守卫 + 独立 AbortController + 受控并发。
// 从 useWizardActions 的三套批量生成函数（图片/视频/资产）收敛而来，
// 执行序与原实现逐行对齐（行为保持型重构）。
// ────────────────────────────────────────────────────────────────────────────

/** 查询某项目是否仍有存活的批量任务（注册表命中即视为在飞） */
export function hasActiveTask(
  registry: Map<string, AbortController>,
  projectId: string,
): boolean {
  return registry.has(projectId);
}

/**
 * 用户侧「停止批量生成」的统一入口：对注册表中的 AbortController 调用 abort()。
 * 语义边界（诚实文案的前提）：
 * - 只能阻止【尚未开始】的任务；已发出的生成请求不会由此函数中止，具体请求
 *   的完成/写回行为由任务自身负责。
 * - 不删除注册表条目：对应流程的 finally 会统一 delete 并执行 onFinally 收尾，避免
 *   在旧任务仍运行时允许同项目启动第二批。
 * - 命中返回 true，未命中（任务已结束/从未启动）返回 false，调用方据此决定按钮态。
 */
export function stopActiveBatch(
  registry: Map<string, AbortController>,
  projectId: string,
): boolean {
  const controller = registry.get(projectId);
  if (!controller) return false;
  controller.abort();
  return true;
}

/**
 * 受控并发执行：n 个 worker 共享任务队列，全部结束后返回。
 * - signal.aborted 时 worker 停止领取新任务（已开始的任务由其内部响应取消）；
 * - allSettled 语义：单任务/单 worker 异常不外抛，不 reject 整体。
 * 自 useWizardActions.ts 的 runWithConcurrency 原样迁入。
 */
export async function runWithConcurrency(
  tasks: Array<() => Promise<void>>,
  concurrency: number,
  signal?: AbortSignal,
): Promise<void> {
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      if (signal?.aborted) return;
      const current = index++;
      await tasks[current]();
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => worker(),
  );
  await Promise.allSettled(workers);
}

export interface BatchRunnerConfig {
  /** 项目级任务注册表（模块级共享，跨组件实例幂等守卫） */
  registry: Map<string, AbortController>;
  /** 刷新/新会话恢复：注册表为空但存在残留中间状态时复位（守卫通过后、建任务前调用） */
  recoverStuck?: (projectId: string) => void;
  /**
   * 构建本轮任务列表（空数组 → onEmpty 分支：不注册、不执行）。
   * `onlyShotIds` 由调用方透传：给了就**只**为这些业务对象建任务。用于刷新恢复通道
   * 只重建刚被判「服务端已不存在」的那几个镜头，避免顺带把项目里其他待补做对象
   * 一起自动开跑（对视频而言等于页面一加载就按秒计费）。
   */
  buildTasks: (
    projectId: string,
    signal: AbortSignal,
    onlyShotIds?: readonly string[],
  ) => Array<() => Promise<void>>;
  /** 注册后、执行前调用（设置生成标记 / 项目状态） */
  onBeforeRun?: (projectId: string) => void;
  /** 任务列表为空时调用（不注册，不触发 onBeforeRun/onFinally） */
  onEmpty?: (projectId: string) => void;
  /** 执行结束（含异常/取消）后调用（收尾状态复位） */
  onFinally?: (projectId: string) => void;
}

/**
 * 创建批量任务执行函数。执行序与原 useWizardActions 实现逐行对齐：
 * 1. registry.has 幂等守卫（在飞时直接返回，不重复启动）；
 * 2. recoverStuck（可选，残留中间状态复位）；
 * 3. 新建独立 AbortController（每批量任务独立，不误杀其他在飞任务）；
 * 4. buildTasks —— 空列表走 onEmpty 后返回（不注册）；
 * 5. registry.set → try { onBeforeRun → runWithConcurrency }
 *    finally { registry.delete → onFinally }。
 * 任务级错误各自 catch 不外抛（allSettled 语义），整体调用方不会因单任务失败被 reject。
 */
export function createBatchRunner(
  cfg: BatchRunnerConfig,
): (opts: { projectId: string; concurrency: number; onlyShotIds?: readonly string[] }) => Promise<void> {
  return async ({ projectId, concurrency, onlyShotIds }) => {
    // 幂等守卫：同一项目已有任务在跑时不重复启动
    if (cfg.registry.has(projectId)) return;

    cfg.recoverStuck?.(projectId);

    // 独立 AbortController：只取消本轮任务
    const controller = new AbortController();
    const signal = controller.signal;

    const tasks = cfg.buildTasks(projectId, signal, onlyShotIds);
    if (tasks.length === 0) {
      cfg.onEmpty?.(projectId);
      return;
    }

    cfg.registry.set(projectId, controller);
    try {
      cfg.onBeforeRun?.(projectId);
      await runWithConcurrency(tasks, concurrency, signal);
    } finally {
      cfg.registry.delete(projectId);
      cfg.onFinally?.(projectId);
    }
  };
}
