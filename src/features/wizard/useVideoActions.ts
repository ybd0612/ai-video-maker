import { useCallback } from "react";
import {
  useProjectStore,
  selectActiveProject,
} from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { resolvePlan, type PlanId } from "@/lib/plans";
import { generateVideo, aspectRatioToVideoAspect, VideoTaskCreatedError } from "@/services/videoService";
import { composeMotionPrompt } from "@/lib/promptUtils";
import { createBatchRunner } from "@/lib/batchRunner";
import { restoreProjectStatusIfReady } from "./wizardActionUtils";

const activeVideoTasks = new Map<string, AbortController>();

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
    const { providerConfig } = useSettingsStore.getState();
    const latestProject = useProjectStore.getState().projects.find((p) => p.id === pid);
    if (!latestProject) return [];
    const shotsNeedingVideos = latestProject.shots.filter(
      (shot) =>
        !shot.videoUrl &&
        shot.imageUrl &&
        shot.status !== "videoing" &&
        (shot.motionPrompt.trim() || shot.actionDesc?.trim()),
    );
    const videoAspect = aspectRatioToVideoAspect(latestProject.aspectRatio);

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
          const motionPrompt = composeMotionPrompt(shot);
          const result = await generateVideo(
            {
              apiKey: providerConfig.apiKey,
              baseUrl: providerConfig.baseUrl,
              prompt: motionPrompt,
              imageUrl: shot.imageUrl!,
              ...(shot.useDualFrame && shot.lastFrameUrl ? { lastFrameUrl: shot.lastFrameUrl } : {}),
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
    const { providerConfig } = useSettingsStore.getState();
    if (!providerConfig.apiKey || !providerConfig.baseUrl) return;

    const store = useProjectStore.getState();
    const project = selectActiveProject(store);
    if (!project) return;
    const targetProjectId = project.id;

    const shot = project.shots.find((item) => item.id === shotId);
    if (!shot || !shot.imageUrl) return;

    const expectedRevision = shot.renderRevision ?? 0;
    store.setShotStatusByProjectId(targetProjectId, shotId, "videoing");
    store.updateShotByProjectId(targetProjectId, shotId, { videoProgress: 0 });

    // 单镜头重试用独立 controller，不干扰批量生成任务。
    const controller = new AbortController();
    const signal = controller.signal;

    try {
      const motionPrompt = composeMotionPrompt(shot);
      const result = await generateVideo(
        {
          apiKey: providerConfig.apiKey,
          baseUrl: providerConfig.baseUrl,
          prompt: motionPrompt,
          imageUrl: shot.imageUrl,
          ...(shot.useDualFrame && shot.lastFrameUrl ? { lastFrameUrl: shot.lastFrameUrl } : {}),
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
