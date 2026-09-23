import { useCallback } from "react";
import {
  useProjectStore,
  selectActiveProject,
} from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { resolvePlan, type PlanId } from "@/lib/plans";
import { generateVideo, aspectRatioToVideoAspect, VideoTaskCreatedError } from "@/services/videoService";
import { planShotVideoMedia } from "@/lib/videoPlan";
import { extractTailFrameUrl } from "@/services/renderService";
import { releaseTailFrames, setTailFrame, snapshotTailFrames } from "@/lib/tailFrameStore";
import { pendingVideoShots } from "@/lib/shotQueue";
import { composeMotionPrompt } from "@/lib/promptUtils";
import { createBatchRunner } from "@/lib/batchRunner";
import { appendRegistryRules, type RegistryRuleText } from "@/lib/promptComposer";
import { getActiveRenderRules } from "@/lib/promptRules";
import { restoreProjectStatusIfReady } from "./wizardActionUtils";

const activeVideoTasks = new Map<string, AbortController>();

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

const runVideoBatch = createBatchRunner({
  registry: activeVideoTasks,
  recoverStuck: (pid) => {
    const latestProject = useProjectStore.getState().projects.find((p) => p.id === pid);
    const stuckVideoing = (latestProject?.shots ?? []).filter((shot) => shot.status === "videoing");
    for (const shot of stuckVideoing) {
      useProjectStore.getState().updateShotByProjectId(pid, shot.id, {
        status: "imaged",
        videoProgress: 0,
        error: undefined,
      });
    }
  },
  buildTasks: (pid, signal) => {
    const { providerConfig, videoConsistency } = useSettingsStore.getState();
    const latestProject = useProjectStore.getState().projects.find((p) => p.id === pid);
    if (!latestProject) return [];
    const shotsNeedingVideos = pendingVideoShots(latestProject.shots);
    const videoAspect = aspectRatioToVideoAspect(latestProject.aspectRatio);
    const rules = extractVideoRules();

    return shotsNeedingVideos.map((shot) => async () => {
      if (signal.aborted) return;
      const expectedRevision = shot.renderRevision ?? 0;
      useProjectStore.getState().setShotStatusByProjectId(pid, shot.id, "videoing");
      useProjectStore.getState().updateShotByProjectId(pid, shot.id, { videoProgress: 0 });

      // 任务已创建但轮询超时/异常时，不再创建重复任务；继续等待同一个任务。
      const MAX_TASK_RETRIES = 2;
      const RETRY_DELAY_MS = 8_000;

      for (let attempt = 0; attempt <= MAX_TASK_RETRIES; attempt++) {
        if (signal.aborted) return;

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
            },
            (progress) => {
              useProjectStore.getState().updateShotByProjectId(pid, shot.id, { videoProgress: progress });
            },
            signal,
          );

          const applied = useProjectStore.getState().updateShotByProjectIdIfRevision(
            pid,
            shot.id,
            expectedRevision,
            { videoUrl: result.videoUrl, status: "videoed" },
          );
          if (!applied) return;
          // 末帧只服务后续镜头的首帧衔接：抽取失败静默降级，绝不影响本镜结果
          try {
            setTailFrame(shot.id, await extractTailFrameUrl(result.videoUrl, signal));
          } catch {
            /* 无末帧可用，下一镜自动退回仅锁首帧 */
          }
          return;
        } catch (err) {
          // 任务已在服务端创建：继续等待同一个任务，不创建重复任务。
          if (err instanceof VideoTaskCreatedError) {
            if (!err.stillRunning) {
              useProjectStore.getState().setShotStatusByProjectIdIfRevision(
                pid,
                shot.id,
                expectedRevision,
                "failed",
                err.message,
              );
            } else {
              useProjectStore.getState().updateShotByProjectIdIfRevision(
                pid,
                shot.id,
                expectedRevision,
                {
                  videoProgress: 0,
                  videoRetryCount: attempt + 1,
                  error: `${err.message} 已保留服务端任务，不重复创建。`,
                },
              );
            }
            return;
          }

          const isLastAttempt = attempt >= MAX_TASK_RETRIES;
          if (isLastAttempt) {
            useProjectStore.getState().setShotStatusByProjectIdIfRevision(
              pid,
              shot.id,
              expectedRevision,
              "failed",
              err instanceof Error ? err.message : String(err),
            );
          } else {
            useProjectStore.getState().updateShotByProjectIdIfRevision(
              pid,
              shot.id,
              expectedRevision,
              { videoProgress: 0, videoRetryCount: attempt + 1 },
            );
            await new Promise<void>((resolve, reject) => {
              const delay = RETRY_DELAY_MS * (attempt + 1);
              const timer = window.setTimeout(() => {
                signal.removeEventListener("abort", onAbort);
                resolve();
              }, delay);
              const onAbort = () => {
                window.clearTimeout(timer);
                reject(new DOMException("Video generation aborted", "AbortError"));
              };
              if (signal.aborted) onAbort();
              else signal.addEventListener("abort", onAbort, { once: true });
            });
          }
        }
      }
    });
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
        `视频生成失败 ${failedCount} 个镜头，请重试失败项。`,
      );
    }
  },
});

export interface VideoActions {
  generateVideosForStep: () => Promise<void>;
  rerollVideo: (shotId: string) => Promise<void>;
}

export function useVideoActions(): VideoActions {
  const generateVideosForStep = useCallback(async () => {
    const { providerConfig } = useSettingsStore.getState();
    if (!providerConfig.apiKey || !providerConfig.baseUrl) return;

    const store = useProjectStore.getState();
    const project = selectActiveProject(store);
    if (!project) return;

    const plan = resolvePlan(providerConfig.plan as PlanId | undefined);
    const videoConcurrency =
      plan.accessType === "tokenplan" ? 3 : plan.rpm.video <= 1 ? 1 : 2;

    await runVideoBatch({ projectId: project.id, concurrency: videoConcurrency });
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

    const expectedRevision = shot.renderRevision ?? 0;
    // 旧视频即将作废：先释放它的末帧，下一镜不会再接到过期画面
    releaseTailFrames([shotId]);
    store.setShotStatusByProjectId(targetProjectId, shotId, "videoing");
    store.updateShotByProjectId(targetProjectId, shotId, { videoProgress: 0 });

    // 单镜头重试用独立 controller，不干扰批量生成任务。
    const controller = new AbortController();
    const signal = controller.signal;

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
        },
        (progress) => {
          useProjectStore.getState().updateShotByProjectId(targetProjectId, shotId, {
            videoProgress: progress,
          });
        },
        signal,
      );

      const applied = useProjectStore.getState().updateShotByProjectIdIfRevision(
        targetProjectId,
        shotId,
        expectedRevision,
        { videoUrl: result.videoUrl, status: "videoed" },
      );
      if (!applied) return;
      try {
        setTailFrame(shotId, await extractTailFrameUrl(result.videoUrl, signal));
      } catch {
        /* 无末帧可用，下一镜自动退回仅锁首帧 */
      }
      restoreProjectStatusIfReady(targetProjectId, (currentProject) =>
        currentProject.shots.every((item) => !!item.videoUrl),
      );
    } catch (err) {
      if (err instanceof VideoTaskCreatedError) {
        if (!err.stillRunning) {
          useProjectStore.getState().setShotStatusByProjectIdIfRevision(
            targetProjectId,
            shotId,
            expectedRevision,
            "failed",
            err.message,
          );
        } else {
          useProjectStore.getState().updateShotByProjectIdIfRevision(
            targetProjectId,
            shotId,
            expectedRevision,
            {
              videoProgress: 0,
              error: `${err.message} 已保留服务端任务，不重复创建。`,
            },
          );
        }
      } else {
        useProjectStore.getState().setShotStatusByProjectIdIfRevision(
          targetProjectId,
          shotId,
          expectedRevision,
          "failed",
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }, []);

  return { generateVideosForStep, rerollVideo };
}
