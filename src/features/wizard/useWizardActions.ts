// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/useWizardActions.ts
// Wizard operation hooks: generate, re-roll, advance steps.
// ────────────────────────────────────────────────────────────────────────────

import { useCallback, useRef } from "react";
import { useProjectStore, selectActiveProject, type Shot } from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { generateScript } from "@/services/scriptService";
import { generateImage, aspectRatioToImageSize } from "@/services/imageService";
import { generateVideo, aspectRatioToVideoSize, VideoTaskCreatedError } from "@/services/videoService";
import { injectCharacterDescriptions } from "@/lib/characterUtils";
import { composeVisualPrompt, composeMotionPrompt } from "@/lib/promptUtils";

export function useWizardActions() {
  const abortRef = useRef<AbortController | null>(null);

  /** Generate script from prompt and advance to Step 2 */
  const generateAndAdvance = useCallback(async (prompt: string) => {
    const { providerConfig } = useSettingsStore.getState();
    if (!providerConfig.apiKey || !providerConfig.baseUrl) {
      throw new Error("API key is not configured.");
    }

    const store = useProjectStore.getState();
    const project = selectActiveProject(store);
    if (!project) throw new Error("No active project.");

    store.setProjectStatus("scripting");

    const rawShots = await generateScript({
      apiKey: providerConfig.apiKey,
      baseUrl: providerConfig.baseUrl,
      prompt,
      language: project.language,
      aspectRatio: project.aspectRatio,
      mode: project.mode,
      characters: project.characters,
    });

    const shots: Shot[] = rawShots.map((s, i) => ({
      id: `shot_${Date.now()}_${i}`,
      index: i,
      status: "scripted" as const,
      ...s,
    }));

    store.setShots(shots);
    store.setWizardStep(2);
  }, []);

  /** Re-roll a single shot's script */
  const rerollShot = useCallback(async (shotId: string) => {
    const { providerConfig } = useSettingsStore.getState();
    if (!providerConfig.apiKey || !providerConfig.baseUrl) return;

    const store = useProjectStore.getState();
    const project = selectActiveProject(store);
    if (!project) return;

    const shot = project.shots.find((s) => s.id === shotId);
    if (!shot) return;

    store.setShotStatus(shotId, "scripting");

    try {
      const rawShots = await generateScript({
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        prompt: `Regenerate this shot: ${shot.scriptText}`,
        language: project.language,
        aspectRatio: project.aspectRatio,
        mode: project.mode,
        characters: project.characters,
      });

      if (rawShots.length > 0) {
        const newShot = rawShots[0];
        store.updateShot(shotId, {
          scriptText: newShot.scriptText,
          visualPrompt: newShot.visualPrompt,
          motionPrompt: newShot.motionPrompt,
          subjectDesc: newShot.subjectDesc,
          sceneDesc: newShot.sceneDesc,
          detailDesc: newShot.detailDesc,
          lightingDesc: newShot.lightingDesc,
          styleDesc: newShot.styleDesc,
          negativePrompt: newShot.negativePrompt,
          actionDesc: newShot.actionDesc,
          cameraDesc: newShot.cameraDesc,
          envChangeDesc: newShot.envChangeDesc,
          motionSpeedDesc: newShot.motionSpeedDesc,
          negativeMotionPrompt: newShot.negativeMotionPrompt,
          duration: newShot.duration,
          status: "scripted",
          error: undefined,
        });
      }
    } catch (err) {
      store.setShotStatus(shotId, "failed", err instanceof Error ? err.message : String(err));
    }
  }, []);

  /** Generate images for all shots that don't have images yet */
  const generateImagesForStep = useCallback(async () => {
    const { providerConfig } = useSettingsStore.getState();
    if (!providerConfig.apiKey || !providerConfig.baseUrl) return;

    const store = useProjectStore.getState();
    const project = selectActiveProject(store);
    if (!project) return;

    const shotsNeedingImages = project.shots.filter(
      (s) => !s.imageUrl && s.visualPrompt.trim(),
    );
    if (shotsNeedingImages.length === 0) return;

    store.setProjectStatus("imaging");
    const imageSize = aspectRatioToImageSize(project.aspectRatio);
    const signal = abortRef.current?.signal;

    // Generate images with concurrency 3
    const tasks = shotsNeedingImages.map((shot) => async () => {
      if (signal?.aborted) return;
      store.setShotStatus(shot.id, "imaging");

      try {
        const enrichedPrompt = injectCharacterDescriptions(
          composeVisualPrompt(shot),
          shot.activeCharacterIds ?? [],
          project.characters,
        );

        const imageUrl = await generateImage({
          apiKey: providerConfig.apiKey,
          baseUrl: providerConfig.baseUrl,
          prompt: enrichedPrompt,
          size: imageSize,
        });

        store.updateShot(shot.id, { imageUrl, status: "imaged" });
      } catch (err) {
        store.setShotStatus(shot.id, "failed", err instanceof Error ? err.message : String(err));
      }
    });

    // Simple concurrency control
    await runWithConcurrency(tasks, 3, signal);

    // Check if all images are ready
    const updatedProject = selectActiveProject(useProjectStore.getState());
    const allImaged = updatedProject?.shots.every((s) => !!s.imageUrl);
    if (allImaged) {
      store.setProjectStatus("done");
    }
  }, []);

  /** Re-roll a single shot's image */
  const rerollImage = useCallback(async (shotId: string) => {
    const { providerConfig } = useSettingsStore.getState();
    if (!providerConfig.apiKey || !providerConfig.baseUrl) return;

    const store = useProjectStore.getState();
    const project = selectActiveProject(store);
    if (!project) return;

    const shot = project.shots.find((s) => s.id === shotId);
    if (!shot) return;

    store.setShotStatus(shotId, "imaging");

    try {
      const enrichedPrompt = injectCharacterDescriptions(
        composeVisualPrompt(shot),
        shot.activeCharacterIds ?? [],
        project.characters,
      );

      const imageUrl = await generateImage({
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        prompt: enrichedPrompt,
        size: aspectRatioToImageSize(project.aspectRatio),
      });

      store.updateShot(shotId, { imageUrl, status: "imaged" });
    } catch (err) {
      store.setShotStatus(shotId, "failed", err instanceof Error ? err.message : String(err));
    }
  }, []);

  /** Generate videos for all shots that don't have videos yet */
  const generateVideosForStep = useCallback(async () => {
    const { providerConfig } = useSettingsStore.getState();
    if (!providerConfig.apiKey || !providerConfig.baseUrl) return;

    const store = useProjectStore.getState();
    const project = selectActiveProject(store);
    if (!project) return;

    const shotsNeedingVideos = project.shots.filter(
      (s) => !s.videoUrl && s.imageUrl && (s.motionPrompt.trim() || s.actionDesc?.trim()),
    );
    if (shotsNeedingVideos.length === 0) return;

    store.setProjectStatus("videoing");
    const videoSize = aspectRatioToVideoSize(project.aspectRatio);
    const signal = abortRef.current?.signal;

    const tasks = shotsNeedingVideos.map((shot) => async () => {
      if (signal?.aborted) return;
      store.setShotStatus(shot.id, "videoing");
      store.updateShot(shot.id, { videoProgress: 0 });

      const MAX_TASK_RETRIES = 2;
      const RETRY_DELAY_MS = 8_000;

      for (let attempt = 0; attempt <= MAX_TASK_RETRIES; attempt++) {
        if (signal?.aborted) return;

        try {
          const motionPrompt = composeMotionPrompt(shot);
          const result = await generateVideo(
            {
              apiKey: providerConfig.apiKey,
              baseUrl: providerConfig.baseUrl,
              prompt: motionPrompt,
              imageUrl: shot.imageUrl!,
              size: videoSize,
              duration: shot.duration,
            },
            (progress) => {
              useProjectStore.getState().updateShot(shot.id, { videoProgress: progress });
            },
            signal,
          );

          store.updateShot(shot.id, { videoUrl: result.videoUrl, status: "videoed" });
          return; // Success — exit retry loop
        } catch (err) {
          // If the task was already created on the server, do NOT retry
          // (the server task may still be running — retrying would create duplicate tasks)
          if (err instanceof VideoTaskCreatedError) {
            store.setShotStatus(shot.id, "failed", err.message);
            return;
          }

          const isLastAttempt = attempt >= MAX_TASK_RETRIES;
          if (isLastAttempt) {
            store.setShotStatus(shot.id, "failed", err instanceof Error ? err.message : String(err));
          } else {
            // Wait before retrying
            store.updateShot(shot.id, {
              videoProgress: 0,
              videoRetryCount: attempt + 1,
            });
            await new Promise<void>((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
          }
        }
      }
    });

    await runWithConcurrency(tasks, 2, signal);
  }, []);

  /** Re-roll a single shot's video */
  const rerollVideo = useCallback(async (shotId: string) => {
    const { providerConfig } = useSettingsStore.getState();
    if (!providerConfig.apiKey || !providerConfig.baseUrl) return;

    const store = useProjectStore.getState();
    const project = selectActiveProject(store);
    if (!project) return;

    const shot = project.shots.find((s) => s.id === shotId);
    if (!shot || !shot.imageUrl) return;

    store.setShotStatus(shotId, "videoing");
    store.updateShot(shotId, { videoProgress: 0 });

    try {
      const motionPrompt = composeMotionPrompt(shot);
      const result = await generateVideo(
        {
          apiKey: providerConfig.apiKey,
          baseUrl: providerConfig.baseUrl,
          prompt: motionPrompt,
          imageUrl: shot.imageUrl,
          size: aspectRatioToVideoSize(project.aspectRatio),
          duration: shot.duration,
        },
        (progress) => {
          useProjectStore.getState().updateShot(shotId, { videoProgress: progress });
        },
        abortRef.current?.signal,
      );

      store.updateShot(shotId, { videoUrl: result.videoUrl, status: "videoed" });
    } catch (err) {
      if (err instanceof VideoTaskCreatedError) {
        store.setShotStatus(shotId, "failed",
          "视频任务已创建但获取结果失败，请稍后重试。");
      } else {
        store.setShotStatus(shotId, "failed", err instanceof Error ? err.message : String(err));
      }
    }
  }, []);

  return {
    abortRef,
    generateAndAdvance,
    rerollShot,
    generateImagesForStep,
    rerollImage,
    generateVideosForStep,
    rerollVideo,
  };
}

/* ── Concurrency helper ─────────────────────────────────────────────────── */

async function runWithConcurrency(
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
