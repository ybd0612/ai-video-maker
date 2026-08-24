// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/useWizardActions.ts
// Wizard operation hooks: generate, re-roll, advance steps.
// ────────────────────────────────────────────────────────────────────────────

import { useCallback } from "react";
import { useProjectStore, selectActiveProject, newId, type Shot, type Asset, type Project } from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { resolvePlan, type PlanId } from "@/lib/plans";
import { generateScript } from "@/services/scriptService";
import { generateImage, aspectRatioToImageSize } from "@/services/imageService";
import { generateAssetNamespace } from "@/lib/assetNamespace";
import { generateVideo, aspectRatioToVideoSize, VideoTaskCreatedError } from "@/services/videoService";
import { injectCharacterDescriptions } from "@/lib/characterUtils";
import { composeVisualPrompt, composeMotionPrompt, generateFullPrompt } from "@/lib/promptUtils";

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

/** 查询某项目是否仍有存活的资产生成任务（供 UI 判断是否可安全重置生成标记） */
export function hasActiveAssetTask(projectId: string): boolean {
  return activeAssetTasks.has(projectId);
}

type RawAsset = {
  name: string;
  description: string;
  appearancePrompt: string;
};

type ImageGenerationInput = {
  prompt: string;
  inputImageUrl?: string;
};

/**
 * Build unique Asset records from model output without mutating inputs.
 * 返回 name→id 映射表：模型可能在 shots/dialogues 中使用自编 ID 引用角色，
 * 调用方需据此回填引用，保证对白归属与角色一致性。
 * 角色与产品共用此函数（type 区分），场景资产由用户手动添加。
 */
function extractNewAssets(
  existing: Asset[],
  incoming: RawAsset[],
  type: "character" | "product",
): { assets: Asset[]; idByName: Map<string, string> } {
  const names = new Set(existing.map((a) => a.name.trim().toLocaleLowerCase()));
  const assets: Asset[] = [];
  const idByName = new Map<string, string>();
  for (const item of incoming) {
    const normalizedName = item.name.trim().toLocaleLowerCase();
    if (!normalizedName || names.has(normalizedName)) continue;
    names.add(normalizedName);
    const record: Asset = {
      id: newId("asset"),
      type,
      name: item.name,
      description: item.description,
      prompt: item.appearancePrompt,
      ...(type === "character"
        ? {
            appearancePrompt: item.appearancePrompt,
            assetNamespace: generateAssetNamespace(item.name),
            fullPrompt: generateFullPrompt(item),
          }
        : {}),
    };
    assets.push(record);
    idByName.set(normalizedName, record.id);
  }
  return { assets, idByName };
}

/** Compose the complete image prompt and the best available img2img reference. */
function buildImageGenerationInput(
  shot: Shot,
  project: { style: string; assets: Asset[]; styleReferenceUrl?: string },
): ImageGenerationInput {
  let prompt = injectCharacterDescriptions(
    composeVisualPrompt(shot),
    shot.activeCharacterIds ?? [],
    project.assets,
  );
  // 产品主体注入：有产品资产时把产品外观描述前置到提示词，保证主体一致性
  const product = project.assets.find((a) => a.type === "product" && !!a.prompt.trim());
  if (product) prompt = `${product.prompt.trim()}. ${prompt}`;
  if (project.style) prompt = `${project.style} style. ${prompt}`;
  return { prompt, inputImageUrl: findBestReference(shot, project) };
}

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
      // Use generateScript to extract characters + products (shots are discarded)
      const result = await generateScript({
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        prompt,
        language: project.language,
        aspectRatio: project.aspectRatio,
        assets: project.assets,
      });

      // 统一提取角色与产品资产（去重后追加到发起项目）
      const newCharacters = extractNewAssets(project.assets, result.characters, "character");
      const newProducts = extractNewAssets(project.assets, result.products, "product");
      const newAssets = [...newCharacters.assets, ...newProducts.assets];

      // 原子地写回发起项目：追加新资产 + 复位状态 + 推进到资产步骤
      useProjectStore.getState().updateProjectById(targetProjectId, (p) => ({
        ...p,
        assets: [...p.assets, ...newAssets],
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

    try {
      const result = await generateScript({
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        prompt,
        language: project.language,
        aspectRatio: project.aspectRatio,
        assets: project.assets,
      });

      // 角色 ID 回填：模型可能返回自编 ID（如 char_1）引用新角色，而新角色入库时
      // 由 newId() 生成全新 ID，两者无映射。此处建立「名字 → store 角色 ID」映射，
      // 统一回填 activeCharacterIds 与 dialogues.characterId，避免对白归属丢失、
      // 角色描述无法注入图片提示词（角色一致性失效）。
      const existingCharacters = project.assets.filter((a) => a.type === "character");
      const idByName = new Map<string, string>();
      for (const c of existingCharacters) idByName.set(c.name.trim().toLocaleLowerCase(), c.id);

      const { assets: newCharacters } = extractNewAssets(
        project.assets,
        result.characters,
        "character",
      );
      for (const c of newCharacters) idByName.set(c.name.trim().toLocaleLowerCase(), c.id);

      const resolveCharacterId = (ref: string): string | null => {
        const normalized = ref.trim().toLocaleLowerCase();
        const matched = idByName.get(normalized);
        if (matched) return matched;
        // 已是 store 中的合法角色 ID 则保留；否则视为无效引用，清理掉
        return existingCharacters.some((c) => c.id === ref) ? ref : null;
      };

      const shots: Shot[] = result.shots.map((s, i) => ({
        id: `shot_${Date.now()}_${i}`,
        index: i,
        status: "scripted" as const,
        ...s,
        activeCharacterIds: (s.activeCharacterIds ?? [])
          .map(resolveCharacterId)
          .filter((x): x is string => x !== null),
        dialogues: (s.dialogues ?? []).map((d) => ({
          ...d,
          characterId: d.characterId ? resolveCharacterId(d.characterId) : null,
        })),
      }));

      store.setShotsByProjectId(targetProjectId, shots);

      // Auto-add any newly extracted characters and products
      const newProducts = extractNewAssets(project.assets, result.products, "product").assets;
      const newAssets = [...newCharacters, ...newProducts];
      if (newAssets.length > 0) {
        useProjectStore.getState().updateProjectById(targetProjectId, (p) => ({
          ...p,
          assets: [...p.assets, ...newAssets],
        }));
      }

      useProjectStore.getState().setProjectStatusById(targetProjectId, "idle");
      useProjectStore.getState().addHistory("script_generated", `生成分镜（${shots.length} 个镜头）`, targetProjectId);
    } catch (err) {
      // 失败时复位发起项目的状态，避免永久停留在 scripting（侧边栏一直转圈）
      useProjectStore.getState().updateProjectById(targetProjectId, (p) => ({
        ...p,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      }));
      throw err;
    }
  }, []);

  /** Re-roll a single shot's script */
  const rerollShot = useCallback(async (shotId: string) => {
    const { providerConfig } = useSettingsStore.getState();
    if (!providerConfig.apiKey || !providerConfig.baseUrl) return;

    const store = useProjectStore.getState();
    const project = selectActiveProject(store);
    if (!project) return;
    const targetProjectId = project.id;

    const shot = project.shots.find((s) => s.id === shotId);
    if (!shot) return;

    store.setShotStatusByProjectId(targetProjectId, shotId, "scripting");

    try {
      // 附带主题与角色上下文，避免单镜头重试结果与整体风格漂移
      const characterNames = project.assets
        .filter((a) => a.type === "character")
        .map((c) => c.name);
      const contextParts = [
        `Regenerate this shot: ${shot.scriptText}`,
        project.ideaPrompt?.trim() ? `Original idea: ${project.ideaPrompt.trim()}` : "",
        characterNames.length > 0
          ? `Characters: ${characterNames.join(", ")}`
          : "",
      ].filter(Boolean);
      const result = await generateScript({
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        prompt: contextParts.join("\n"),
        language: project.language,
        aspectRatio: project.aspectRatio,
        assets: project.assets,
      });

      if (result.shots.length > 0) {
        const newShot = result.shots[0];
        store.updateShotByProjectId(targetProjectId, shotId, {
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
        // 此前可能因部分失败置为 failed；全部镜头恢复后复位项目状态
        restoreProjectStatusIfReady(targetProjectId, (p) => p.shots.every((s) => s.status !== "failed"));
        useProjectStore.getState().addHistory(
          "shot_regenerated",
          `重新生成镜头 ${shot.index + 1}`,
          targetProjectId,
        );
      }
    } catch (err) {
      store.setShotStatusByProjectId(targetProjectId, shotId, "failed", err instanceof Error ? err.message : String(err));
    }
  }, []);

  /** Step 2: Generate asset images (character portraits + scene references) */
  const generateAssetImages = useCallback(async (opts?: {
    generatePortraits?: boolean;
    generateScenes?: boolean;
    generateProducts?: boolean;
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
    const generateProducts = opts?.generateProducts !== false;
    const generateStyle = opts?.generateStyle !== false;

    const tasks: Array<() => Promise<void>> = [];

    // Character portrait tasks（角色定妆照）
    if (generatePortraits) {
      for (const char of project.assets.filter((a) => a.type === "character")) {
        if (char.imageUrl) continue; // skip already generated
        tasks.push(async () => {
          if (signal?.aborted) return;
          try {
            const portraitPrompt = `Portrait of ${char.prompt}, head and shoulders, looking at camera, high detail, photorealistic`;
            const url = await generateImage({
              apiKey: providerConfig.apiKey,
              baseUrl: providerConfig.baseUrl,
              prompt: portraitPrompt,
              size: imageSize,
            });
            useProjectStore.getState().updateAssetByProjectId(targetProjectId, char.id, { imageUrl: url, error: undefined });
          } catch (err) {
            // 失败原因写入资产，UI 展示重试入口（不能只 console.error，用户完全无感知）
            useProjectStore.getState().updateAssetByProjectId(targetProjectId, char.id, {
              error: err instanceof Error ? err.message : String(err),
            });
            console.error(`Failed to generate portrait for ${char.name}:`, err);
          }
        });
      }
    }

    // Scene reference tasks（场景参考图）
    if (generateScenes) {
      for (const scene of project.assets.filter((a) => a.type === "scene")) {
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
            useProjectStore.getState().updateAssetByProjectId(targetProjectId, scene.id, { imageUrl: url, error: undefined });
          } catch (err) {
            useProjectStore.getState().updateAssetByProjectId(targetProjectId, scene.id, {
              error: err instanceof Error ? err.message : String(err),
            });
            console.error(`Failed to generate scene image for ${scene.name}:`, err);
          }
        });
      }
    }

    // Product reference tasks（产品参考图：主体一致性锚点）
    if (generateProducts) {
      for (const product of project.assets.filter((a) => a.type === "product")) {
        if (product.imageUrl) continue; // skip already generated
        tasks.push(async () => {
          if (signal?.aborted) return;
          try {
            const url = await generateImage({
              apiKey: providerConfig.apiKey,
              baseUrl: providerConfig.baseUrl,
              prompt: product.prompt,
              size: imageSize,
            });
            useProjectStore.getState().updateAssetByProjectId(targetProjectId, product.id, { imageUrl: url, error: undefined });
          } catch (err) {
            useProjectStore.getState().updateAssetByProjectId(targetProjectId, product.id, {
              error: err instanceof Error ? err.message : String(err),
            });
            console.error(`Failed to generate product image for ${product.name}:`, err);
          }
        });
      }
    }

    // Style reference task（风格参考图，项目级锚点）
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
          useProjectStore.getState().updateProjectById(targetProjectId, (p) => ({ ...p, styleReferenceUrl: url, styleReferenceError: undefined }));
        } catch (err) {
          useProjectStore.getState().updateProjectById(targetProjectId, (p) => ({
            ...p,
            styleReferenceError: err instanceof Error ? err.message : String(err),
          }));
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

    // 无论成功与否都清除标记：部分失败时若保留 true，步骤 2 的“生成全部”按钮
    // 会永久转圈禁用（此前仅在全成功时清除，失败即卡死）
    useProjectStore.getState().setAssetGenerationStartedByProjectId(targetProjectId, false);
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
        const { prompt: enrichedPrompt, inputImageUrl: referenceImageUrl } = buildImageGenerationInput(shot, project);

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
      // 图片全部完成 ≠ 项目完成（视频/成片尚未生成），置 idle 避免侧边栏误显“已完成”
      useProjectStore.getState().setProjectStatusById(targetProjectId, "idle");
    } else {
      // 部分失败：清除标记并复位状态，避免项目永久停留在 imaging（侧边栏一直转圈）
      useProjectStore.getState().setImageGenerationStartedByProjectId(targetProjectId, false);
      const failedCount = (updatedProject?.shots ?? []).filter((s) => s.status === "failed").length;
      useProjectStore.getState().setProjectStatusById(
        targetProjectId,
        "failed",
        `图片生成失败 ${failedCount} 个镜头，请重试失败项。`,
      );
    }
  }, []);

  /** Re-roll a single shot's image */
  const rerollImage = useCallback(async (shotId: string) => {
    const { providerConfig } = useSettingsStore.getState();
    if (!providerConfig.apiKey || !providerConfig.baseUrl) return;

    const store = useProjectStore.getState();
    const project = selectActiveProject(store);
    if (!project) return;
    const targetProjectId = project.id;

    const shot = project.shots.find((s) => s.id === shotId);
    if (!shot) return;

    store.setShotStatusByProjectId(targetProjectId, shotId, "imaging");

    try {
      const { prompt: enrichedPrompt, inputImageUrl: referenceImageUrl } = buildImageGenerationInput(shot, project);

      const imageUrl = await generateImage({
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        prompt: enrichedPrompt,
        size: aspectRatioToImageSize(project.aspectRatio),
        inputImageUrl: referenceImageUrl,
      });

      store.updateShotByProjectId(targetProjectId, shotId, { imageUrl, status: "imaged" });
      // 此前可能因部分失败置为 failed；全部镜头图片就绪后复位项目状态
      restoreProjectStatusIfReady(targetProjectId, (p) => p.shots.every((s) => !!s.imageUrl));
      useProjectStore.getState().addHistory("shot_regenerated", `重新生成镜头图片 ${shot.index + 1}`, targetProjectId);
    } catch (err) {
      store.setShotStatusByProjectId(targetProjectId, shotId, "failed", err instanceof Error ? err.message : String(err));
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
    // 视频并发与套餐同步：免费档 RPM=1 串行；企业 2；Token Plan 保守取 3（RPM=5，
    // 避免同时创建过多轮询任务）。限流器会进一步串行化，不会突破 RPM 上限。
    const videoConcurrency =
      plan.accessType === "tokenplan" ? 3 : plan.rpm.video <= 1 ? 1 : 2;

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
    const allVideoed = updatedProject?.shots.every((s) => !!s.videoUrl);
    const allSettled = updatedProject?.shots.every((s) => !!s.videoUrl || s.status === "failed");
    if (allSettled) {
      useProjectStore.getState().setVideoGenerationStartedByProjectId(targetProjectId, false);
    }
    // 复位项目状态，避免视频完成后侧边栏永久显示“生成中”：
    // 全部成功 → idle（成片拼接完成时才置 done）；存在失败 → failed + 摘要
    if (allVideoed) {
      useProjectStore.getState().setProjectStatusById(targetProjectId, "idle");
    } else if (allSettled) {
      const failedCount = (updatedProject?.shots ?? []).filter((s) => s.status === "failed").length;
      useProjectStore.getState().setProjectStatusById(
        targetProjectId,
        "failed",
        `视频生成失败 ${failedCount} 个镜头，请重试失败项。`,
      );
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
      // 此前可能因部分失败置为 failed；全部镜头视频就绪后复位项目状态
      restoreProjectStatusIfReady(targetProjectId, (p) => p.shots.every((s) => !!s.videoUrl));
      useProjectStore.getState().addHistory("shot_regenerated", `重新生成镜头视频 ${shot.index + 1}`, targetProjectId);
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
 * Find the best img2img reference for a shot（统一资产参考链）：
 * 1. 场景参考（shot.sceneDesc 匹配场景名）
 * 2. 角色定妆照（activeCharacterIds 命中的角色）
 * 3. 产品参考图（全局主体锚点）
 * 4. 风格参考（项目级风格锚点）
 */
function findBestReference(
  shot: Shot,
  project: { assets: Asset[]; styleReferenceUrl?: string },
): string | undefined {
  const scenes = project.assets.filter((a) => a.type === "scene");
  // Try scene reference match
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
    .map((id) => project.assets.find((a) => a.id === id && a.type === "character"))
    .filter((c): c is Asset => c != null)
    .map((c) => c.imageUrl ?? c.avatarUrl)
    .filter((url): url is string => !!url);
  if (portraitUrls[0]) return portraitUrls[0];

  // Fall back to product reference（全局主体锚点）
  const product = project.assets.find((a) => a.type === "product" && !!a.imageUrl);
  if (product?.imageUrl) return product.imageUrl;

  // Fall back to style reference
  return project.styleReferenceUrl;
}

/* ── Concurrency helper ─────────────────────────────────────────────────── */

/**
 * 单镜头重试成功后，若项目此前因部分失败置为 failed、且现在所有镜头满足就绪条件，
 * 则复位项目状态为 idle，避免侧边栏状态永久停留在 failed。
 */
function restoreProjectStatusIfReady(projectId: string, ready: (p: Project) => boolean): void {
  const project = useProjectStore.getState().projects.find((p) => p.id === projectId);
  if (project && project.status === "failed" && ready(project)) {
    useProjectStore.getState().setProjectStatusById(projectId, "idle");
  }
}

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
