// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/useWizardActions.ts
// Wizard operation hooks: generate, re-roll, advance steps.
// ────────────────────────────────────────────────────────────────────────────

import { useCallback, useRef } from "react";
import { useProjectStore, selectActiveProject, newId, type Shot, type SceneReference, type Character } from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { generateScript } from "@/services/scriptService";
import { generateImage, aspectRatioToImageSize } from "@/services/imageService";
import { generateAssetNamespace } from "@/lib/assetNamespace";
import { generateVideo, aspectRatioToVideoSize, VideoTaskCreatedError } from "@/services/videoService";
import { injectCharacterDescriptions } from "@/lib/characterUtils";
import { composeVisualPrompt, composeMotionPrompt } from "@/lib/promptUtils";

export function useWizardActions() {
  const abortRef = useRef<AbortController | null>(null);

  /** Ensure a fresh AbortController exists and return its signal */
  const ensureAbortController = useCallback(() => {
    // Abort any previous in-flight operation
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    return abortRef.current.signal;
  }, []);

  /** Step 1→2: Extract characters from idea, advance to assets step */
  const extractCharactersFromIdea = useCallback(async (prompt: string) => {
    const { providerConfig } = useSettingsStore.getState();
    if (!providerConfig.apiKey || !providerConfig.baseUrl) {
      throw new Error("API key is not configured.");
    }

    const store = useProjectStore.getState();
    const project = selectActiveProject(store);
    if (!project) throw new Error("No active project.");

    // 捕获发起项目的 ID：异步完成后结果必须写回该项目，
    // 即使用户在生成期间切换/创建了新项目，也不会污染其他项目。
    const targetProjectId = project.id;

    store.setProjectStatus("scripting");

    try {
      // Use generateScript to extract characters (shots are discarded)
      const result = await generateScript({
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        prompt,
        language: project.language,
        aspectRatio: project.aspectRatio,
        characters: project.characters,
      });

      // 构造提取到的角色（带唯一 ID）
      const newCharacters: Character[] = result.characters.map((char) => ({
        id: newId("char"),
        name: char.name,
        description: char.description,
        appearancePrompt: char.appearancePrompt,
        assetNamespace: generateAssetNamespace(char.name),
        fullPrompt: `a character named ${char.name}, ${char.appearancePrompt}`,
      }));

      // 原子地写回发起项目：追加角色 + 复位状态 + 推进到资产步骤
      useProjectStore.getState().updateProjectById(targetProjectId, (p) => ({
        ...p,
        characters: [...p.characters, ...newCharacters],
        status: "idle",
        error: undefined,
        wizardStep: 2,
      }));
    } catch (err) {
      // 失败时将发起项目复位为 failed，避免其状态永远停留在 scripting
      useProjectStore.getState().updateProjectById(targetProjectId, (p) => ({
        ...p,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      }));
      throw err;
    }
  }, []);

  /** Step 3: Generate storyboard shots using asset context */
  const generateStoryboard = useCallback(async (prompt: string) => {
    const { providerConfig } = useSettingsStore.getState();
    if (!providerConfig.apiKey || !providerConfig.baseUrl) {
      throw new Error("API key is not configured.");
    }

    const store = useProjectStore.getState();
    const project = selectActiveProject(store);
    if (!project) throw new Error("No active project.");

    store.setProjectStatus("scripting");

    const result = await generateScript({
      apiKey: providerConfig.apiKey,
      baseUrl: providerConfig.baseUrl,
      prompt,
      language: project.language,
      aspectRatio: project.aspectRatio,
      characters: project.characters,
      sceneReferences: project.sceneReferences,
    });

    const shots: Shot[] = result.shots.map((s, i) => ({
      id: `shot_${Date.now()}_${i}`,
      index: i,
      status: "scripted" as const,
      ...s,
    }));

    store.setShots(shots);

    // Auto-add any newly extracted characters
    if (result.characters.length > 0) {
      const existingNames = new Set(project.characters.map((c) => c.name));
      for (const char of result.characters) {
        if (!existingNames.has(char.name)) {
          const namespace = generateAssetNamespace(char.name);
          const fullPrompt = `a character named ${char.name}, ${char.appearancePrompt}`;
          store.addCharacter({
            name: char.name,
            description: char.description,
            appearancePrompt: char.appearancePrompt,
            assetNamespace: namespace,
            fullPrompt,
          });
        }
      }
    }

    store.setProjectStatus("idle");
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
      const result = await generateScript({
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        prompt: `Regenerate this shot: ${shot.scriptText}`,
        language: project.language,
        aspectRatio: project.aspectRatio,
        characters: project.characters,
      });

      if (result.shots.length > 0) {
        const newShot = result.shots[0];
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

  /** Step 2: Generate asset images (character portraits + scene references) */
  const generateAssetImages = useCallback(async (opts?: {
    generatePortraits?: boolean;
    generateScenes?: boolean;
    generateStyle?: boolean;
  }) => {
    const { providerConfig } = useSettingsStore.getState();
    if (!providerConfig.apiKey || !providerConfig.baseUrl) return;

    const store = useProjectStore.getState();
    const project = selectActiveProject(store);
    if (!project) return;

    const imageSize = aspectRatioToImageSize(project.aspectRatio);
    const signal = ensureAbortController();
    const generatePortraits = opts?.generatePortraits !== false;
    const generateScenes = opts?.generateScenes !== false;
    const generateStyle = opts?.generateStyle !== false;

    const tasks: Array<() => Promise<void>> = [];

    // Character portrait tasks
    if (generatePortraits) {
      for (const char of project.characters) {
        if (char.generatedPortraitUrl) continue; // skip already generated
        tasks.push(async () => {
          if (signal?.aborted) return;
          try {
            const portraitPrompt = `Portrait of ${char.appearancePrompt}, head and shoulders, looking at camera, high detail, photorealistic`;
            const url = await generateImage({
              apiKey: providerConfig.apiKey,
              baseUrl: providerConfig.baseUrl,
              prompt: portraitPrompt,
              size: imageSize,
            });
            store.updateCharacter(char.id, { generatedPortraitUrl: url });
          } catch (err) {
            console.error(`Failed to generate portrait for ${char.name}:`, err);
          }
        });
      }
    }

    // Scene reference tasks
    if (generateScenes) {
      for (const scene of project.sceneReferences ?? []) {
        if (scene.imageUrl) continue; // skip already generated
        tasks.push(async () => {
          if (signal?.aborted) return;
          try {
            const url = await generateImage({
              apiKey: providerConfig.apiKey,
              baseUrl: providerConfig.baseUrl,
              prompt: scene.prompt,
              size: imageSize,
            });
            store.updateSceneReference(scene.id, { imageUrl: url });
          } catch (err) {
            console.error(`Failed to generate scene image for ${scene.name}:`, err);
          }
        });
      }
    }

    // Style reference task
    if (generateStyle && !project.styleReferenceUrl) {
      tasks.push(async () => {
        if (signal?.aborted) return;
        try {
          const stylePrompt = project.style
            ? `${project.style} style reference, cohesive visual aesthetic, color palette, mood board`
            : `Cinematic style reference, cohesive visual aesthetic, warm tones, professional photography`;
          const url = await generateImage({
            apiKey: providerConfig.apiKey,
            baseUrl: providerConfig.baseUrl,
            prompt: stylePrompt,
            size: imageSize,
          });
          store.updateProject({ styleReferenceUrl: url });
        } catch (err) {
          console.error("Failed to generate style reference:", err);
        }
      });
    }

    if (tasks.length === 0) return;

    store.setAssetGenerationStarted(true);
    await runWithConcurrency(tasks, 3, signal);

    // 所有资产生成完成后清除标记
    const updatedProject = selectActiveProject(useProjectStore.getState());
    const allPortraitsDone = updatedProject?.characters.every((c) => !!c.generatedPortraitUrl);
    const allScenesDone = (updatedProject?.sceneReferences ?? []).every((s) => !!s.imageUrl);
    const styleDone = !!updatedProject?.styleReferenceUrl;
    if (allPortraitsDone && allScenesDone && styleDone) {
      store.setAssetGenerationStarted(false);
    }
  }, []);

  /** Step 4: Generate images for all shots (with img2img from scene/style references) */
  const generateImagesForStep = useCallback(async () => {
    const { providerConfig } = useSettingsStore.getState();
    if (!providerConfig.apiKey || !providerConfig.baseUrl) return;

    const store = useProjectStore.getState();
    const project = selectActiveProject(store);
    if (!project) return;

    // 跳过已在生成中的 shot（status="imaging"），防止导航切换后重复提交
    const shotsNeedingImages = project.shots.filter(
      (s) => !s.imageUrl && s.status !== "imaging" && s.visualPrompt.trim(),
    );
    if (shotsNeedingImages.length === 0) return;

    store.setImageGenerationStarted(true);
    store.setProjectStatus("imaging");
    const imageSize = aspectRatioToImageSize(project.aspectRatio);
    const signal = ensureAbortController();

    // Generate images with concurrency 3
    const tasks = shotsNeedingImages.map((shot) => async () => {
      if (signal?.aborted) return;
      store.setShotStatus(shot.id, "imaging");

      try {
        let enrichedPrompt = injectCharacterDescriptions(
          composeVisualPrompt(shot),
          shot.activeCharacterIds ?? [],
          project.characters,
        );

        // Prepend style reference description if available
        if (project.style) {
          enrichedPrompt = `${project.style} style. ${enrichedPrompt}`;
        }

        // Find best img2img reference: scene reference > character portrait > style reference
        const referenceImageUrl = findBestReference(shot, project);

        const imageUrl = await generateImage({
          apiKey: providerConfig.apiKey,
          baseUrl: providerConfig.baseUrl,
          prompt: enrichedPrompt,
          size: imageSize,
          inputImageUrl: referenceImageUrl,
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
      store.setImageGenerationStarted(false);
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
      let enrichedPrompt = injectCharacterDescriptions(
        composeVisualPrompt(shot),
        shot.activeCharacterIds ?? [],
        project.characters,
      );

      if (project.style) {
        enrichedPrompt = `${project.style} style. ${enrichedPrompt}`;
      }

      const referenceImageUrl = findBestReference(shot, project);

      const imageUrl = await generateImage({
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        prompt: enrichedPrompt,
        size: aspectRatioToImageSize(project.aspectRatio),
        inputImageUrl: referenceImageUrl,
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

    // 跳过已在生成中的 shot（status="videoing"），防止导航切换后重复提交
    const shotsNeedingVideos = project.shots.filter(
      (s) => !s.videoUrl && s.imageUrl && s.status !== "videoing" && (s.motionPrompt.trim() || s.actionDesc?.trim()),
    );
    if (shotsNeedingVideos.length === 0) return;

    store.setVideoGenerationStarted(true);
    store.setProjectStatus("videoing");
    const videoSize = aspectRatioToVideoSize(project.aspectRatio);
    const signal = ensureAbortController();

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
              // 双图流：同时传入首帧和尾帧
              ...(shot.useDualFrame && shot.lastFrameUrl ? { lastFrameUrl: shot.lastFrameUrl } : {}),
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

    // 所有视频生成完成后清除标记
    const updatedProject = selectActiveProject(useProjectStore.getState());
    const allVideoed = updatedProject?.shots.every((s) => !!s.videoUrl);
    if (allVideoed) {
      store.setVideoGenerationStarted(false);
    }
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
          // 双图流：同时传入首帧和尾帧
          ...(shot.useDualFrame && shot.lastFrameUrl ? { lastFrameUrl: shot.lastFrameUrl } : {}),
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
    extractCharactersFromIdea,
    generateStoryboard,
    generateAssetImages,
    rerollShot,
    generateImagesForStep,
    rerollImage,
    generateVideosForStep,
    rerollVideo,
  };
}

/* ── Reference image resolution ─────────────────────────────────────────── */

/**
 * Find the best img2img reference for a shot:
 * 1. Scene reference (if shot's sceneDesc matches a scene name)
 * 2. Character portrait (first active character with a portrait)
 * 3. Style reference (project-level style anchor)
 */
function findBestReference(
  shot: Shot,
  project: { sceneReferences?: SceneReference[]; styleReferenceUrl?: string; characters: Array<{ id: string; generatedPortraitUrl?: string; avatarUrl?: string }> },
): string | undefined {
  // Try scene reference match
  const scenes = project.sceneReferences ?? [];
  if (scenes.length > 0 && shot.sceneDesc) {
    const shotScene = shot.sceneDesc.toLowerCase();
    const matched = scenes.find((s) =>
      s.imageUrl && shotScene.includes(s.name.toLowerCase()),
    );
    if (matched?.imageUrl) return matched.imageUrl;
  }
  // Fall back to first scene reference with an image
  const firstScene = scenes.find((s) => !!s.imageUrl);
  if (firstScene?.imageUrl) return firstScene.imageUrl;

  // Fall back to character portrait
  const portraitUrls = (shot.activeCharacterIds ?? [])
    .map((id) => project.characters.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => c != null)
    .map((c) => c.generatedPortraitUrl ?? c.avatarUrl)
    .filter((url): url is string => !!url);
  if (portraitUrls[0]) return portraitUrls[0];

  // Fall back to style reference
  return project.styleReferenceUrl;
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
