import { useCallback } from "react";
import {
  useProjectStore,
  selectActiveProject,
} from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { resolvePlan, videoConcurrencyFor, videoInFlightCapFor, type PlanId } from "@/lib/plans";
import { generateVideo, aspectRatioToVideoAspect, pollVideoTaskById, VideoTaskCreatedError } from "@/services/videoService";
import { planShotVideoMedia } from "@/lib/videoPlan";
import { extractTailFrameUrl } from "@/services/renderService";
import { releaseTailFrames, setTailFrame, snapshotTailFrames } from "@/lib/tailFrameStore";
import { pendingVideoShots, inFlightVideoShots, hasResumableVideoTask, canStartSingleReroll, canStartVideoBatch, canGiveUpVideoTask, canAutoRetryVanishedTask, isShotInFlight, type ResumableVideoShot } from "@/lib/shotQueue";
import { getTranslation } from "@/i18n";
import { composeMotionPrompt } from "@/lib/promptUtils";
import { createBatchRunner, hasActiveTask } from "@/lib/batchRunner";
import { appendRegistryRules, type RegistryRuleText } from "@/lib/promptComposer";
import { getActiveRenderRules } from "@/lib/promptRules";
import { restoreProjectStatusIfReady } from "./wizardActionUtils";

const activeVideoTasks = new Map<string, AbortController>();

/**
 * 刷新恢复轮询的本地登记表：key = `${pid}::${shotId}`。
 * 2026-10-03 审计 P2-5：恢复轮询**故意不进** activeVideoTasks 注册表（那是批量互斥判据，
 * 注册进去会让挂死的恢复轮询永久禁用按钮、也让「放弃」不可达——2026-09-28 设计取舍）。
 * 但放弃/重建必须能掐掉这条只读通道：给它单独的轻量登记表，只用于 abort。
 */
const resumeControllers = new Map<string, AbortController>();
const resumeKey = (pid: string, shotId: string) => `${pid}::${shotId}`;

/**
 * 从注册表提取视频提示词所需的正向约束文本（negativeStrategy）。
 * motionPrompt 恒为英文，故取 en；调用方读 store，lib 保持纯函数。
 * 不新增 API negative 字段、不污染 stylePrompt。
 */
/**
 * 取视频提示词的正向质量约束文本（negativeStrategy 的渲染文本）。
 * 只收 renderContent，作者向元指令不进请求体；motionPrompt 的否定句式仍按英文实测口径。
 */
function extractVideoRules(): RegistryRuleText {
  return {
    negativeStrategy: getActiveRenderRules("negativeStrategy", "en"),
  };
}

/**
 * 视频成功写回（批量创建 / 批量续轮询 / 单镜头重摇共用）。
 * 完成即清任务 ID：镜头已有成片，旧任务 ID 再留着会被判成"在飞"而不进待补做集合。
 */
async function commitVideoResult(
  pid: string,
  shotId: string,
  expectedRevision: number,
  videoUrl: string,
  signal?: AbortSignal,
): Promise<void> {
  const applied = useProjectStore.getState().updateShotByProjectIdIfRevision(
    pid,
    shotId,
    expectedRevision,
    { videoUrl, status: "videoed", videoTaskId: undefined, videoTaskModel: undefined },
  );
  if (!applied) return;
  // 末帧只服务后续镜头的首帧衔接：抽取失败静默降级，绝不影响本镜结果
  try {
    setTailFrame(shotId, await extractTailFrameUrl(videoUrl, signal));
  } catch {
    /* 无末帧可用，下一镜自动退回仅锁首帧 */
  }
}

/**
 * 视频失败写回（同上三条路径共用）。
 * 「任务仍在跑」保留 `videoTaskId` 与 `videoing` 状态，让下一轮批量/恢复接着轮询同一个任务；
 * 终态失败必须一并清掉任务 ID —— 否则该镜头既不在 `pendingVideoShots`（若状态被复位）
 * 也无人续轮询，会永久卡在已计费但无人认领的状态。
 *
 * 返回值 = 调用方是否应当**立刻为该镜头重建一次**。只有服务端确认任务不存在
 * （`err.taskVanished`，即轮询持续 404）且该镜头还有额度时才为 true；额度在这里就扣掉
 * （`videoRetryCount +1`），所以批量、单项重摇、刷新恢复三条通道共用同一份预算，
 * 不会各重试一次。超时 / 429 / 5xx / 服务端 failed / 创建失败一律 false ——
 * 那些情形重发就是重复扣秒数或白扣额度。
 */
function commitVideoFailure(
  pid: string,
  shotId: string,
  expectedRevision: number,
  err: unknown,
): boolean {
  const store = useProjectStore.getState();
  if (err instanceof VideoTaskCreatedError) {
    if (err.stillRunning) {
      store.updateShotByProjectIdIfRevision(pid, shotId, expectedRevision, {
        videoProgress: 0,
        error: `${err.message} ${getTranslation("error.videoTaskKept")}`,
      });
      return false;
    }

    const shot = store.projects.find((p) => p.id === pid)?.shots.find((s) => s.id === shotId);
    const retryVanishedTask = !!shot && err.taskVanished && canAutoRetryVanishedTask(shot);
    const applied = store.updateShotByProjectIdIfRevision(pid, shotId, expectedRevision, {
      status: "failed",
      error: `${err.message} ${getTranslation(
        retryVanishedTask ? "error.videoTaskVanishedAutoRetry" : "error.videoTaskFailedManualRetry",
      )}`,
      videoTaskId: undefined,
      videoTaskModel: undefined,
      ...(retryVanishedTask ? { videoRetryCount: (shot.videoRetryCount ?? 0) + 1 } : {}),
    });
    // 写回没生效（镜头版本已被其他操作推进）时不得重建，否则会给一个已被改动的镜头建任务
    return retryVanishedTask && applied;
  }

  store.updateShotByProjectIdIfRevision(pid, shotId, expectedRevision, {
    status: "failed",
    error: `${err instanceof Error ? err.message : String(err)} ${getTranslation("error.videoCreateManualRetry")}`,
    videoTaskId: undefined,
    videoTaskModel: undefined,
  });
  return false;
}

/**
 * 只轮询已存在的服务端任务，绝不发 `POST /videos`：视频按秒计费，重建等于重复扣额度。
 * 与创建路径共用同一套写回，保证「谁在轮询这个镜头」始终只有一个所有者。
 *
 * 返回 true = 服务端确认该任务不存在且镜头还有重建额度，交由 `resumePendingVideoTasks`
 * 统一走批量通道重建一次（本函数绝不自己发创建请求）。
 */
async function resumeShotVideoTask(
  pid: string,
  shot: ResumableVideoShot,
  providerConfig: { apiKey: string; baseUrl: string },
  signal?: AbortSignal,
): Promise<boolean> {
  if (signal?.aborted) return false;
  const expectedRevision = shot.renderRevision ?? 0;
  try {
    const result = await pollVideoTaskById(
      providerConfig,
      shot.videoTaskId,
      shot.videoTaskModel,
      (progress) => {
        useProjectStore.getState().updateShotByProjectId(pid, shot.id, { videoProgress: progress });
      },
      signal,
    );
    await commitVideoResult(pid, shot.id, expectedRevision, result.videoUrl, signal);
  } catch (err) {
    return commitVideoFailure(pid, shot.id, expectedRevision, err);
  }
  return false;
}

const runVideoBatch = createBatchRunner({
  registry: activeVideoTasks,
  recoverStuck: (pid) => {
    const latestProject = useProjectStore.getState().projects.find((p) => p.id === pid);
    // 只复位「没有可续轮询任务」的在飞镜头。带 videoTaskId 的必须留给
    // resumePendingVideoTasks 续轮询同一个任务：复位成 imaged 会让它重新进
    // pendingVideoShots 集合 → 再发一次 POST /videos → 旧任务被覆盖 ID 后无人问，
    // 服务端白多一个按秒计费的任务（2026-09-26 实测：同一镜头三次刷新三次重建）。
    const stuckVideoing = (latestProject?.shots ?? []).filter(
      (shot) => shot.status === "videoing" && !hasResumableVideoTask(shot),
    );
    for (const shot of stuckVideoing) {
      useProjectStore.getState().updateShotByProjectId(pid, shot.id, {
        status: "imaged",
        videoProgress: 0,
        error: undefined,
      });
    }
  },
  buildTasks: (pid, signal, onlyShotIds) => {
    const { providerConfig, videoConsistency } = useSettingsStore.getState();
    const latestProject = useProjectStore.getState().projects.find((p) => p.id === pid);
    if (!latestProject) return [];
    let shotsNeedingVideos = pendingVideoShots(latestProject.shots);
    // 自动重建只针对刚被确认「服务端已不存在」的镜头，不得顺带把其他待补做镜头一起开跑
    if (onlyShotIds) shotsNeedingVideos = shotsNeedingVideos.filter((s) => onlyShotIds.includes(s.id));
    // 在飞任务数达到上限才不开工（2026-09-28 由「有在飞就整批停摆」改为按上限放行）。
    // 仍然绝不把在飞镜头排进本列表：它们是 resumePendingVideoTasks 并发续轮询的专属对象
    // （pendingVideoShots 已按 status==="videoing" 排除），批量 worker 顺序领取任务，
    // 一个卡死的任务最长占住 worker 30 分钟（2026-09-26 实测 6 个在飞任务 progress 全 0）。
    // 但「只要有一条没偿清就整批陪绑」没有边界：服务端可能受理任务后既不吐片也不给
    // 终态（2026-09-28 实测 200 + in_progress + internal_progress 0 + expires_at null
    // 挂 2 小时 14 分），其余镜头两小时无法开工且按钮被禁用，等于没有出路。
    // 上限 = 并发 + 1，见 plans.ts:videoInFlightCapFor。
    const inFlightCount = inFlightVideoShots(latestProject.shots).length;
    if (!canStartVideoBatch({
      inFlightCount,
      cap: videoInFlightCapFor(resolvePlan(providerConfig.plan as PlanId | undefined)),
    })) return [];
    const videoAspect = aspectRatioToVideoAspect(latestProject.aspectRatio);
    const rules = extractVideoRules();

    const createTasks = shotsNeedingVideos.map((shot) => async () => {
      if (signal.aborted) return;
      // 列表是启动时快照：期间该镜头可能已被单项重摇拥有，再建一次就是第二个按秒计费任务
      const live = useProjectStore.getState().projects
        .find((p) => p.id === pid)?.shots.find((s) => s.id === shot.id);
      if (live && isShotInFlight(live)) return;
      const expectedRevision = shot.renderRevision ?? 0;

      // 创建请求非幂等：POST /videos 按秒计费，超时 / 5xx 时服务端可能已经建了任务，
      // 重发就是重复扣秒数 —— 因此**不做**通用创建重试；任务已建的场景由
      // VideoTaskCreatedError + shot.videoTaskId 承接（见 pollVideoTaskById 恢复）。
      // 唯一的自动重建例外：服务端确认任务不存在（持续 404，产出已不可回收，也没有东西
      // 在跑），此时按 commitVideoFailure 的额度立刻重建一次，额度跨通道只扣一次。
      const attempt = async (): Promise<boolean> => {
        if (signal.aborted) return false;
        useProjectStore.getState().setShotStatusByProjectId(pid, shot.id, "videoing");
        // 清掉上一轮遗留的任务 ID：它同时是「本镜头由谁在轮询」的判据 —— 留着旧 ID，
        // 挂载时的 resumePendingVideoTasks 会把本批量正在轮询的镜头误判成上一会话的孤儿，
        // 于是同一个镜头被两处轮询，旧任务一报错就把在飞镜头打成 failed。
        useProjectStore.getState().updateShotByProjectId(pid, shot.id, {
          videoProgress: 0,
          videoTaskId: undefined,
          videoTaskModel: undefined,
        });

        try {
          const motionPrompt = appendRegistryRules(
            composeMotionPrompt(shot),
            rules,
          );
          const { media } = planShotVideoMedia({
            shot,
            shots: latestProject.shots,
            assets: latestProject.assets,
            styleReferenceUrl: latestProject.styleReferenceUrl,
            consistency: videoConsistency,
            // Task 4 接入 tailFrameStore 前恒空：衔接判定通过但取不到末帧时自动降级为仅锁首帧
            tailFrames: snapshotTailFrames(),
          });
          const result = await generateVideo(
            {
              apiKey: providerConfig.apiKey,
              baseUrl: providerConfig.baseUrl,
              prompt: motionPrompt,
              ...media,
              aspectRatio: videoAspect,
              duration: shot.duration,
              onTaskCreated: (videoId, modelName) => {
                useProjectStore.getState().updateShotByProjectId(pid, shot.id, {
                  videoTaskId: videoId,
                  videoTaskModel: modelName,
                });
              },
            },
            (progress) => {
              useProjectStore.getState().updateShotByProjectId(pid, shot.id, { videoProgress: progress });
            },
            signal,
          );

          await commitVideoResult(pid, shot.id, expectedRevision, result.videoUrl, signal);
        } catch (err) {
          return commitVideoFailure(pid, shot.id, expectedRevision, err);
        }
        return false;
      };

      if (await attempt()) await attempt();
    });

    return createTasks;
  },
  onBeforeRun: (pid) => {
    useProjectStore.getState().setVideoGenerationStartedByProjectId(pid, true);
    useProjectStore.getState().setProjectStatusById(pid, "videoing");
  },
  onFinally: (pid) => {
    const updatedProject = useProjectStore.getState().projects.find((p) => p.id === pid);
    const allVideoed = updatedProject?.shots.every((shot) => !!shot.videoUrl);
    const allSettled = updatedProject?.shots.every(
      (shot) => !!shot.videoUrl || shot.status === "failed",
    );
    if (allSettled) {
      useProjectStore.getState().setVideoGenerationStartedByProjectId(pid, false);
    }
    if (allVideoed) {
      useProjectStore.getState().setProjectStatusById(pid, "idle");
    } else if (allSettled) {
      const failedCount = (updatedProject?.shots ?? []).filter((shot) => shot.status === "failed").length;
      useProjectStore.getState().setProjectStatusById(
        pid,
        "failed",
        getTranslation("error.videoBatchFailed", { count: failedCount }),
      );
    }
  },
});

/**
 * 刷新恢复：模块级注册表随页面销毁清空，但服务端任务还在跑（按秒计费）。
 * 归属规则（一个镜头只能有一个轮询者）：
 * - 该项目有批量正在跑创建 → 整项目跳过（批量见有在飞任务就不新建、也不注册，故此守卫只挡真正在创建的情形）；
 * - 否则本项目所有「`videoing` + 任务 ID 齐备」的镜头**并发**续轮询同一个任务，绝不重建；
 * - `videoing` 但缺 ID 的（创建请求在飞的窗口内被刷新）复位为 `imaged`，交批量正常新建。
 *
 * 旧实现是 `for` + `await` 串行：一次只真正盯一个任务，其余挂着 ID 的镜头各等最长 30 分钟
 * 才轮到（2026-09-26 实测同项目 6 个在飞任务全部 progress 0，界面上就是"一个都没成功"）。
 */
export async function resumePendingVideoTasks(): Promise<void> {
  const { providerConfig } = useSettingsStore.getState();
  if (!providerConfig.apiKey || !providerConfig.baseUrl) return;

  for (const project of useProjectStore.getState().projects) {
    if (hasActiveTask(activeVideoTasks, project.id)) continue;
    const targetProjectId = project.id;

    const waiting: ResumableVideoShot[] = [];
    for (const shot of project.shots) {
      if (shot.status !== "videoing") continue;
      if (hasResumableVideoTask(shot)) {
        waiting.push(shot);
      } else {
        useProjectStore.getState().updateShotByProjectId(targetProjectId, shot.id, {
          status: "imaged",
          videoProgress: 0,
          error: undefined,
        });
      }
    }

    const resumeResults = await Promise.allSettled(
      waiting.map((shot) => {
        // P2-5：恢复轮询登记进独立轻量表（不进 activeVideoTasks：2026-09-28 设计
        // 取舍保持「放弃」在挂死轮询下仍可达），供放弃/重摇掐掉这条只读通道。
        const controller = new AbortController();
        const key = resumeKey(targetProjectId, shot.id);
        resumeControllers.set(key, controller);
        return resumeShotVideoTask(targetProjectId, shot, providerConfig, controller.signal).finally(
          () => {
            if (resumeControllers.get(key) === controller) resumeControllers.delete(key);
          },
        );
      }),
    );

    // 服务端确认「任务已不存在」且额度还在的镜头：立刻只重建这几个
    // （走批量通道，因此在飞上限、注册表互斥、并发按套餐都继续生效）
    const vanishedShotIds: string[] = [];
    waiting.forEach((shot, index) => {
      const result = resumeResults[index];
      if (result.status === "fulfilled" && result.value) vanishedShotIds.push(shot.id);
    });
    if (vanishedShotIds.length > 0) {
      await runVideoBatch({
        projectId: targetProjectId,
        concurrency: videoConcurrencyFor(resolvePlan(providerConfig.plan as PlanId | undefined)),
        onlyShotIds: vanishedShotIds,
      });
    }

    restoreProjectStatusIfReady(targetProjectId, (currentProject) =>
      currentProject.shots.every((item) => !!item.videoUrl),
    );
  }
}

export interface VideoActions {
  generateVideosForStep: () => Promise<void>;
  rerollVideo: (shotId: string) => Promise<void>;
  /** 显式放弃本镜的服务端在飞任务：清任务 ID 并落 failed，使镜头回到待补做集合 */
  giveUpVideoTask: (shotId: string) => void;
}

/**
 * 该项目当前是否有视频批量在跑（模块级注册表）。
 * UI 的按钮禁用条件必须用这条真实互斥判据，而不是持久状态 `status==="videoing"` ——
 * 后者会因服务端不给终态而永远为真，把「补做缺失」永久禁掉（2026-09-28）。
 * 与 useAssetActions 的 hasActiveAssetTask 同形态。
 */
export function hasActiveVideoTask(projectId: string): boolean {
  return hasActiveTask(activeVideoTasks, projectId);
}

export function useVideoActions(): VideoActions {
  const generateVideosForStep = useCallback(async () => {
    const { providerConfig } = useSettingsStore.getState();
    if (!providerConfig.apiKey || !providerConfig.baseUrl) return;

    const store = useProjectStore.getState();
    const project = selectActiveProject(store);
    if (!project) return;

    const plan = resolvePlan(providerConfig.plan as PlanId | undefined);
    await runVideoBatch({ projectId: project.id, concurrency: videoConcurrencyFor(plan) });
  }, []);

  const rerollVideo = useCallback(async (shotId: string) => {
    const { providerConfig, videoConsistency } = useSettingsStore.getState();
    if (!providerConfig.apiKey || !providerConfig.baseUrl) return;

    const store = useProjectStore.getState();
    const project = selectActiveProject(store);
    if (!project) return;
    const targetProjectId = project.id;

    const shot = project.shots.find((item) => item.id === shotId);
    if (!shot || !shot.imageUrl) return;
    // §12-3 幂等守卫（与视频域「在飞任务单一所有权」同一条取舍）：
    // 批量在跑、或本镜正被批量续轮询 / 上一个单项请求拥有时一律不发起 ——
    // 下面的清理会抹掉 videoTaskId，等于丢弃已计费任务再建第二个（按秒双扣）。
    if (!canStartSingleReroll({ batchActive: hasActiveTask(activeVideoTasks, targetProjectId), shot })) return;

    const expectedRevision = shot.renderRevision ?? 0;
    // P2-5：重摇即宣告旧任务作废。刷新恢复的续轮询不在 activeVideoTasks 互斥表内
    // （canStartSingleReroll 只挡批量），这里显式掐掉该镜头的只读轮询通道，
    // 避免它带着旧 revision 快照与新创建路径并行写回。
    resumeControllers.get(resumeKey(targetProjectId, shotId))?.abort();
    // 旧视频即将作废：先释放它的末帧，下一镜不会再接到过期画面
    releaseTailFrames([shotId]);

    // 单镜头重试用独立 controller，不干扰批量生成任务。
    const controller = new AbortController();
    const signal = controller.signal;

    // 用户手点重摇 = 新的明确意图，自动重建额度重新给一份（否则上一次用掉的额度
    // 会让这次重摇遇到 404 也不再自愈）
    useProjectStore.getState().updateShotByProjectId(targetProjectId, shotId, {
      videoRetryCount: undefined,
    });

    const attempt = async (): Promise<boolean> => {
      useProjectStore.getState().setShotStatusByProjectId(targetProjectId, shotId, "videoing");
      // 与批量创建路径同口径：重摇即放弃旧任务，遗留 ID 会让镜头被误判成"上一轮在飞、只该续轮询"
      useProjectStore.getState().updateShotByProjectId(targetProjectId, shotId, {
        videoProgress: 0,
        videoTaskId: undefined,
        videoTaskModel: undefined,
      });

      try {
        const motionPrompt = appendRegistryRules(
          composeMotionPrompt(shot),
          extractVideoRules(),
        );
        const { media } = planShotVideoMedia({
          shot,
          shots: project.shots,
          assets: project.assets,
          styleReferenceUrl: project.styleReferenceUrl,
          consistency: videoConsistency,
          tailFrames: {},
        });
        const result = await generateVideo(
          {
            apiKey: providerConfig.apiKey,
            baseUrl: providerConfig.baseUrl,
            prompt: motionPrompt,
            ...media,
            aspectRatio: aspectRatioToVideoAspect(project.aspectRatio),
            duration: shot.duration,
            onTaskCreated: (videoId, modelName) => {
              useProjectStore.getState().updateShotByProjectId(targetProjectId, shotId, {
                videoTaskId: videoId,
                videoTaskModel: modelName,
              });
            },
          },
          (progress) => {
            useProjectStore.getState().updateShotByProjectId(targetProjectId, shotId, {
              videoProgress: progress,
            });
          },
          signal,
        );

        await commitVideoResult(targetProjectId, shotId, expectedRevision, result.videoUrl, signal);
        restoreProjectStatusIfReady(targetProjectId, (currentProject) =>
          currentProject.shots.every((item) => !!item.videoUrl),
        );
      } catch (err) {
        return commitVideoFailure(targetProjectId, shotId, expectedRevision, err);
      }
      return false;
    };

    if (await attempt()) await attempt();
  }, []);

  /**
   * 显式放弃本镜的服务端在飞任务：**只写状态，不发任何请求**。
   *
   * 服务端受理任务后可以既不吐片也不给终态（2026-09-28 实测 `in_progress` +
   * `internal_progress:0` + `expires_at:null` 挂 2 小时 14 分），此时代码不该猜时长
   * 判死——那会白扔已计费额度并让同一镜头二次扣秒数——所以把判死权交回用户。
   * 清掉 `videoTaskId` 后镜头回到 `pendingVideoShots` 集合，可再次发起生成。
   */
  const giveUpVideoTask = useCallback((shotId: string) => {
    const store = useProjectStore.getState();
    const project = selectActiveProject(store);
    if (!project) return;
    const targetProjectId = project.id;

    const shot = project.shots.find((item) => item.id === shotId);
    if (!shot) return;
    if (!canGiveUpVideoTask({ batchActive: hasActiveVideoTask(targetProjectId), shot })) return;

    const abandonedTaskId = shot.videoTaskId;
    // P2-5：显式推进 renderRevision，让任何迟到的旧轮询写回（commitVideoResult/
    // commitVideoFailure 的 IfRevision 守卫）作废；同步先落状态，再 abort 恢复轮询，
    // 被中断的 poll 走 catch → 守卫失败 → 不会覆盖本镜的放弃结论。
    // updates 不含 visual/motion/output 字段，applyShotUpdates 不会二次改这个值。
    store.updateShotByProjectId(targetProjectId, shotId, {
      status: "failed",
      videoProgress: 0,
      videoTaskId: undefined,
      videoTaskModel: undefined,
      renderRevision: (shot.renderRevision ?? 0) + 1,
      error: getTranslation("error.videoTaskGivenUp", { videoId: abandonedTaskId ?? "" }),
    });
    resumeControllers.get(resumeKey(targetProjectId, shotId))?.abort();

    // 放弃后若已无在飞镜头，项目状态不该继续挂着 videoing（界面会显示「生成中」）
    // 必须重新取 store：上面的 store 是写回前的快照，按它数会把刚放弃的镜头算成在飞
    const latest = useProjectStore.getState().projects.find((item) => item.id === targetProjectId);
    const stillInFlight = latest?.shots.filter((item) => hasResumableVideoTask(item)).length ?? 0;
    if (stillInFlight === 0) {
      useProjectStore.getState().setProjectStatusById(targetProjectId, "idle");
    }
  }, []);

  return { generateVideosForStep, rerollVideo, giveUpVideoTask };
}
