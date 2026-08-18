// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/useWizardActions.ts
// Wizard operation hooks: generate, re-roll, advance steps.
// ────────────────────────────────────────────────────────────────────────────

import { useCallback } from "react";
import { useProjectStore, selectActiveProject, newId, type Shot, type SceneReference, type Character } from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { resolvePlan, type PlanId } from "@/lib/plans";
import { generateScript } from "@/services/scriptService";
import { generateImage, aspectRatioToImageSize } from "@/services/imageService";
import { generateAssetNamespace } from "@/lib/assetNamespace";
import { generateVideo, aspectRatioToVideoSize, VideoTaskCreatedError } from "@/services/videoService";
import { injectCharacterDescriptions } from "@/lib/characterUtils";
import { composeVisualPrompt, composeMotionPrompt } from "@/lib/promptUtils";

/**
 * 正在运行的视频生成任务：projectId -> AbortController。
 * 模块级注册表（跨组件实例共享），用于：
 * 1. 幂等守卫：同一项目已有任务在跑时不重复启动，避免重复创建服务端视频任务；
 * 2. 刷新/新会话恢复：页面刷新后注册表清空，可将残留的 videoing 状态重置为可重试。
 */
const activeVideoTasks = new Map<string, AbortController>();

/** 正在运行的图片生成任务（同 video：幂等守卫 + 刷新恢复） */
const activeImageTasks = new Map<string, AbortController>();

/** 正在运行的资产生成任务（同 video：幂等守卫 + 刷新恢复） */
const activeAssetTasks = new Map<string, AbortController>();

export function useWizardActions() {

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
      // AI 可能在重复点击“生成”时再次返回相同角色；按名称去重，避免资产列表重复。
      const existingNames = new Set(
        project.characters.map((character) => character.name.trim().toLocaleLowerCase()),
      );
      const newCharacters: Character[] = result.characters
        .filter((char) => {
          const normalizedName = char.name.trim().toLocaleLowerCase();
          if (!normalizedName || existingNames.has(normalizedName)) return false;
          existingNames.add(normalizedName);
          return true;
        })
        .map((char) => ({
          id: newId("char"),
          name: char.name,
          description: char.description,
          appearancePrompt: char.appearancePrompt,
          assetNamespace: generateAssetNamespace(char.name),
          fullPrompt: `a character named ${char.name}, ${char.appearancePrompt}`,
        }));

      // 原子地写回发起项目：追加新角色 + 复位状态 + 推进到资产步骤
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
    const targetProjectId = project.id;

    store.setProjectStatusById(targetProjectId, "scripting");

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

    store.setShotsByProjectId(targetProjectId, shots);

    // Auto-add any newly extracted characters
    if (result.characters.length > 0) {
      const existingNames = new Set(project.characters.map((c) => c.name));
      for (const char of result.characters) {
        if (!existingNames.has(char.name)) {
          const namespace = generateAssetNamespace(char.name);
          const fullPrompt = `a character named ${char.name}, ${char.appearancePrompt}`;
          const newCharacter: Character = {
            id: newId("char"),
            name: char.name,
            description: char.description,
            appearancePrompt: char.appearancePrompt,
            assetNamespace: namespace,
            fullPrompt,
          };
          useProjectStore.getState().updateProjectById(targetProjectId, (p) => ({
            ...p,
            characters: [...p.characters, newCharacter],
          }));
        }
      }
    }

    useProjectStore.getState().setProjectStatusById(targetProjectId, "idle");
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
    const targetProjectId = project.id;

    // 幂等守卫：同一项目已有资产生成任务在跑时不重复启动
    if (activeAssetTasks.has(targetProjectId)) return;

    const imageSize = aspectRatioToImageSize(project.aspectRatio);
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
            useProjectStore.getState().updateCharacterByProjectId(targetProjectId, char.id, { generatedPortraitUrl: url });
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
            useProjectStore.getState().updateSceneReferenceByProjectId(targetProjectId, scene.id, { imageUrl: url });
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
          useProjectStore.getState().updateProjectById(targetProjectId, (p) => ({ ...p, styleReferenceUrl: url }));
        } catch (err) {
          console.error("Failed to generate style reference:", err);
        }
      });
    }

    if (tasks.length === 0) {
      // 没有可生成的任务：清除可能卡住的生成标记
      useProjectStore.getState().setAssetGenerationStartedByProjectId(targetProjectId, false);
      return;
    }

    // 独立 AbortController：不误杀其他正在运行的任务
    const controller = new AbortController();
    const signal = controller.signal;
    activeAssetTasks.set(targetProjectId, controller);

    store.setAssetGenerationStartedByProjectId(targetProjectId, true);
    try {
      await runWithConcurrency(tasks, 3, signal);
    } finally {
      activeAssetTasks.delete(targetProjectId);
    }

    // 所有资产生成完成后清除标记
    const updatedProject = useProjectStore.getState().projects.find((p) => p.id === targetProjectId);
    const allPortraitsDone = updatedProject?.characters.every((c) => !!c.generatedPortraitUrl);
    const allScenesDone = (updatedProject?.sceneReferences ?? []).every((s) => !!s.imageUrl);
    const styleDone = !!updatedProject?.styleReferenceUrl;
    if (allPortraitsDone && allScenesDone && styleDone) {
      useProjectStore.getState().setAssetGenerationStartedByProjectId(targetProjectId, false);
    }
  }, []);

  /** Step 4: Generate images for all shots (with img2img from scene/style references) */
  const generateImagesForStep = useCallback(async () => {
    const { providerConfig } = useSettingsStore.getState();
    if (!providerConfig.apiKey || !providerConfig.baseUrl) return;

    const store = useProjectStore.getState();
    const project = selectActiveProject(store);
    if (!project) return;
    const targetProjectId = project.id;

    // 幂等守卫：同一项目已有图片任务在跑时不重复启动
    if (activeImageTasks.has(targetProjectId)) return;

    // 刷新/新会话恢复：残留 imaging 状态没有存活任务 → 重置为 scripted 重新生成
    const latestProject = useProjectStore.getState().projects.find((p) => p.id === targetProjectId);
    const stuckImaging = (latestProject?.shots ?? []).filter((s) => s.status === "imaging");
    if (stuckImaging.length > 0) {
      for (const s of stuckImaging) {
        useProjectStore.getState().updateShotByProjectId(targetProjectId, s.id, {
          status: "scripted",
          error: undefined,
        });
      }
    }

    // 跳过已在生成中的 shot（status="imaging"），防止导航切换后重复提交
    const shotsNeedingImages = (latestProject?.shots ?? []).filter(
      (s) => !s.imageUrl && s.status !== "imaging" && s.visualPrompt.trim(),
    );
    if (shotsNeedingImages.length === 0) return;

    // 独立 AbortController：不误杀其他正在运行的任务
    const controller = new AbortController();
    const signal = controller.signal;
    activeImageTasks.set(targetProjectId, controller);

    store.setImageGenerationStartedByProjectId(targetProjectId, true);
    store.setProjectStatusById(targetProjectId, "imaging");
    const imageSize = aspectRatioToImageSize(latestProject?.aspectRatio ?? project.aspectRatio);

    // Generate images with concurrency 3
    const tasks = shotsNeedingImages.map((shot) => async () => {
      if (signal?.aborted) return;
      useProjectStore.getState().setShotStatusByProjectId(targetProjectId, shot.id, "imaging");

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

        useProjectStore.getState().updateShotByProjectId(targetProjectId, shot.id, { imageUrl, status: "imaged" });
      } catch (err) {
        useProjectStore.getState().setShotStatusByProjectId(targetProjectId, shot.id, "failed", err instanceof Error ? err.message : String(err));
      }
    });

    // Simple concurrency control
    try {
      await runWithConcurrency(tasks, 3, signal);
    } finally {
      activeImageTasks.delete(targetProjectId);
    }

    // Check if all images are ready
    const updatedProject = useProjectStore.getState().projects.find((p) => p.id === targetProjectId);
    const allImaged = updatedProject?.shots.every((s) => !!s.imageUrl);
    if (allImaged) {
      useProjectStore.getState().setImageGenerationStartedByProjectId(targetProjectId, false);
      useProjectStore.getState().setProjectStatusById(targetProjectId, "done");
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
    const targetProjectId = project.id;

    // 幂等守卫：同一项目已有视频任务在跑时不重复启动，
    // 避免 effect 重入 / 导航切换导致重复创建服务端视频任务。
    if (activeVideoTasks.has(targetProjectId)) return;

    const plan = resolvePlan(providerConfig.plan as PlanId | undefined);
    // 免费档视频 RPM=1，限流器会串行排队；这里同步使用相同并发度，避免界面同时显示多个“生成中”。
    const videoConcurrency = plan.rpm.video <= 1 ? 1 : 2;

    // 刷新/新会话恢复：videoing 状态没有对应的存活任务（注册表为空）→ 重置为 imaged，
    // 让下面重新接管这些 shot，避免“永久加载中”卡死。
    const latestProject = useProjectStore.getState().projects.find((p) => p.id === targetProjectId);
    const stuckVideoing = (latestProject?.shots ?? []).filter((s) => s.status === "videoing");
    if (stuckVideoing.length > 0) {
      for (const s of stuckVideoing) {
        useProjectStore.getState().updateShotByProjectId(targetProjectId, s.id, {
          status: "imaged",
          videoProgress: 0,
          error: undefined,
        });
      }
    }

    // 跳过已在生成中的 shot（status="videoing"），防止导航切换后重复提交
    const shotsNeedingVideos = (latestProject?.shots ?? []).filter(
      (s) => !s.videoUrl && s.imageUrl && s.status !== "videoing" && (s.motionPrompt.trim() || s.actionDesc?.trim()),
    );
    if (shotsNeedingVideos.length === 0) return;

    // 独立 AbortController：只取消本轮任务，不误杀其他仍在运行的任务。
    const controller = new AbortController();
    const signal = controller.signal;
    activeVideoTasks.set(targetProjectId, controller);

    store.setVideoGenerationStartedByProjectId(targetProjectId, true);
    store.setProjectStatusById(targetProjectId, "videoing");
    const videoSize = aspectRatioToVideoSize(latestProject?.aspectRatio ?? project.aspectRatio);

    const tasks = shotsNeedingVideos.map((shot) => async () => {
      if (signal?.aborted) return;
      useProjectStore.getState().setShotStatusByProjectId(targetProjectId, shot.id, "videoing");
      useProjectStore.getState().updateShotByProjectId(targetProjectId, shot.id, { videoProgress: 0 });

      // 任务已创建但轮询超时/异常时，不再创建重复任务；继续等待同一个任务。
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
              useProjectStore.getState().updateShotByProjectId(targetProjectId, shot.id, { videoProgress: progress });
            },
            signal,
          );

          useProjectStore.getState().updateShotByProjectId(targetProjectId, shot.id, { videoUrl: result.videoUrl, status: "videoed" });
          return; // Success — exit retry loop
        } catch (err) {
          // 任务已在服务端创建：继续等待同一个任务，不创建重复任务。
          // generateVideo 的轮询已延长到 30 分钟；若仍超时则保留 videoing 状态，允许用户稍后继续等待/刷新恢复。
          if (err instanceof VideoTaskCreatedError) {
            if (!err.stillRunning) {
              useProjectStore.getState().setShotStatusByProjectId(targetProjectId, shot.id, "failed", err.message);
            } else {
              useProjectStore.getState().updateShotByProjectId(targetProjectId, shot.id, {
                videoProgress: 0,
                videoRetryCount: attempt + 1,
                error: `${err.message} 已保留服务端任务，不重复创建。`,
              });
            }
            return;
          }

          const isLastAttempt = attempt >= MAX_TASK_RETRIES;
          if (isLastAttempt) {
            useProjectStore.getState().setShotStatusByProjectId(targetProjectId, shot.id, "failed", err instanceof Error ? err.message : String(err));
          } else {
            // Wait before retrying
            useProjectStore.getState().updateShotByProjectId(targetProjectId, shot.id, {
              videoProgress: 0,
              videoRetryCount: attempt + 1,
            });
            await new Promise<void>((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
          }
        }
      }
    });

    try {
      await runWithConcurrency(tasks, videoConcurrency, signal);
    } finally {
      activeVideoTasks.delete(targetProjectId);
    }

    // 只有全部成功或明确失败后才清除标记；仍在服务端运行的任务继续保留“生成中”。
    const updatedProject = useProjectStore.getState().projects.find((p) => p.id === targetProjectId);
    const allSettled = updatedProject?.shots.every((s) => !!s.videoUrl || s.status === "failed");
    if (allSettled) {
      useProjectStore.getState().setVideoGenerationStartedByProjectId(targetProjectId, false);
    }
  }, []);

  /** Re-roll a single shot's video */
  const rerollVideo = useCallback(async (shotId: string) => {
    const { providerConfig } = useSettingsStore.getState();
    if (!providerConfig.apiKey || !providerConfig.baseUrl) return;

    const store = useProjectStore.getState();
    const project = selectActiveProject(store);
    if (!project) return;
    const targetProjectId = project.id;

    const shot = project.shots.find((s) => s.id === shotId);
    if (!shot || !shot.imageUrl) return;

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
          // 双图流：同时传入首帧和尾帧
          ...(shot.useDualFrame && shot.lastFrameUrl ? { lastFrameUrl: shot.lastFrameUrl } : {}),
          size: aspectRatioToVideoSize(project.aspectRatio),
          duration: shot.duration,
        },
        (progress) => {
          useProjectStore.getState().updateShotByProjectId(targetProjectId, shotId, { videoProgress: progress });
        },
        signal,
      );

      useProjectStore.getState().updateShotByProjectId(targetProjectId, shotId, { videoUrl: result.videoUrl, status: "videoed" });
    } catch (err) {
      if (err instanceof VideoTaskCreatedError) {
        if (!err.stillRunning) {
          useProjectStore.getState().setShotStatusByProjectId(targetProjectId, shotId, "failed", err.message);
        } else {
          // 服务端任务仍在运行：保持 videoing，不重复创建，也不误报失败。
          useProjectStore.getState().updateShotByProjectId(targetProjectId, shotId, {
            videoProgress: 0,
            error: `${err.message} 已保留服务端任务，不重复创建。`,
          });
        }
      } else {
        useProjectStore.getState().setShotStatusByProjectId(targetProjectId, shotId, "failed", err instanceof Error ? err.message : String(err));
      }
    }
  }, []);

  return {
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
