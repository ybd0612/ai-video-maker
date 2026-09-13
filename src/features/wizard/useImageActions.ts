import { useCallback } from "react";
import {
  useProjectStore,
  selectActiveProject,
  type Asset,
  type Shot,
} from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { generateImage, aspectRatioToImageParams } from "@/services/imageService";
import { injectCharacterDescriptions } from "@/lib/characterUtils";
import { composeVisualPrompt } from "@/lib/promptUtils";
import { createBatchRunner } from "@/lib/batchRunner";
import {
  composeMultiReferencePrompt,
  composeTextToImagePrompt,
  pickShotReferences,
} from "@/lib/promptComposer";
import { restoreProjectStatusIfReady } from "./wizardActionUtils";

const activeImageTasks = new Map<string, AbortController>();

type ImageGenerationInput = {
  prompt: string;
  /** 参考图 URL 列表（多图合成；空数组 = 纯文生图） */
  referenceImageUrls: string[];
};

/** 按 URL 反查资产，返回其在多图合成中的角色语义（未命中视为风格参考） */
function describeReferenceRole(
  url: string,
  project: { assets: Asset[] },
): "character" | "scene" | "product" | "style" {
  const asset = project.assets.find((a) => a.imageUrl === url || a.avatarUrl === url);
  if (asset) return asset.type;
  return "style";
}

/** 按 URL 反查资产，生成参考图说明（名称 + 描述/提示词） */
function describeReferenceNote(
  url: string,
  project: { assets: Asset[] },
): string {
  const asset = project.assets.find((a) => a.imageUrl === url || a.avatarUrl === url);
  if (!asset) return "overall art style / mood reference";
  return `${asset.name}: ${(asset.description || asset.prompt).trim()}`;
}

/**
 * Compose the complete image prompt and the multi-reference list for a shot.
 * - 参考图：pickShotReferences（场景 → 角色 → 产品 → 风格，≤3 张）
 * - 有参考图：composeMultiReferencePrompt（参考图角色说明 + 图像关系指令）
 * - 无参考图：composeTextToImagePrompt 六段式
 */
function buildImageGenerationInput(
  shot: Shot,
  project: { style: string; assets: Asset[]; styleReferenceUrl?: string },
): ImageGenerationInput {
  const referenceImageUrls = pickShotReferences(shot, project);

  let subject = injectCharacterDescriptions(
    composeVisualPrompt(shot),
    shot.activeCharacterIds ?? [],
    project.assets,
  );
  const product = project.assets.find((a) => a.type === "product" && !!a.prompt.trim());
  if (product) subject = `${product.prompt.trim()}. ${subject}`;

  if (referenceImageUrls.length > 0) {
    const references = referenceImageUrls.map((url, i) => ({
      index: i + 1,
      role: describeReferenceRole(url, project),
      note: describeReferenceNote(url, project),
    }));
    return {
      prompt: composeMultiReferencePrompt({ references, scene: subject }),
      referenceImageUrls,
    };
  }

  return {
    prompt: composeTextToImagePrompt({
      subject,
      style: project.style || undefined,
      quality: "high quality, 8k",
    }),
    referenceImageUrls: [],
  };
}

const runImageBatch = createBatchRunner({
  registry: activeImageTasks,
  recoverStuck: (pid) => {
    const latestProject = useProjectStore.getState().projects.find((p) => p.id === pid);
    const stuckImaging = (latestProject?.shots ?? []).filter((s) => s.status === "imaging");
    for (const shot of stuckImaging) {
      useProjectStore.getState().updateShotByProjectId(pid, shot.id, {
        status: "scripted",
        error: undefined,
      });
    }
  },
  buildTasks: (pid, signal) => {
    const { providerConfig } = useSettingsStore.getState();
    const latestProject = useProjectStore.getState().projects.find((p) => p.id === pid);
    if (!latestProject) return [];
    const shotsNeedingImages = latestProject.shots.filter(
      (shot) => !shot.imageUrl && shot.status !== "imaging" && shot.visualPrompt.trim(),
    );
    const { size: imageSize, ratio: imageRatio } = aspectRatioToImageParams(latestProject.aspectRatio);

    return shotsNeedingImages.map((shot) => async () => {
      if (signal.aborted) return;
      useProjectStore.getState().setShotStatusByProjectId(pid, shot.id, "imaging");

      try {
        const { prompt: enrichedPrompt, referenceImageUrls } = buildImageGenerationInput(shot, latestProject);
        const imageUrl = await generateImage({
          apiKey: providerConfig.apiKey,
          baseUrl: providerConfig.baseUrl,
          prompt: enrichedPrompt,
          size: imageSize,
          ratio: imageRatio,
          ...(referenceImageUrls.length > 0 ? { referenceImageUrls } : {}),
        });

        useProjectStore.getState().updateShotByProjectId(pid, shot.id, { imageUrl, status: "imaged" });
      } catch (err) {
        useProjectStore.getState().setShotStatusByProjectId(
          pid,
          shot.id,
          "failed",
          err instanceof Error ? err.message : String(err),
        );
      }
    });
  },
  onBeforeRun: (pid) => {
    useProjectStore.getState().setImageGenerationStartedByProjectId(pid, true);
    useProjectStore.getState().setProjectStatusById(pid, "imaging");
  },
  onFinally: (pid) => {
    useProjectStore.getState().setImageGenerationStartedByProjectId(pid, false);
    const updatedProject = useProjectStore.getState().projects.find((p) => p.id === pid);
    const allImaged = updatedProject?.shots.every((shot) => !!shot.imageUrl);
    if (allImaged) {
      useProjectStore.getState().setProjectStatusById(pid, "idle");
    } else {
      const failedCount = (updatedProject?.shots ?? []).filter((shot) => shot.status === "failed").length;
      useProjectStore.getState().setProjectStatusById(
        pid,
        "failed",
        `图片生成失败 ${failedCount} 个镜头，请重试失败项。`,
      );
    }
  },
});

export interface ImageActions {
  generateImagesForStep: () => Promise<void>;
  rerollImage: (shotId: string) => Promise<void>;
}

export function useImageActions(): ImageActions {
  const generateImagesForStep = useCallback(async () => {
    const { providerConfig } = useSettingsStore.getState();
    if (!providerConfig.apiKey || !providerConfig.baseUrl) return;

    const store = useProjectStore.getState();
    const project = selectActiveProject(store);
    if (!project) return;

    await runImageBatch({ projectId: project.id, concurrency: 3 });
  }, []);

  const rerollImage = useCallback(async (shotId: string) => {
    const { providerConfig } = useSettingsStore.getState();
    if (!providerConfig.apiKey || !providerConfig.baseUrl) return;

    const store = useProjectStore.getState();
    const project = selectActiveProject(store);
    if (!project) return;
    const targetProjectId = project.id;

    const shot = project.shots.find((item) => item.id === shotId);
    if (!shot) return;

    store.setShotStatusByProjectId(targetProjectId, shotId, "imaging");

    try {
      const { prompt: enrichedPrompt, referenceImageUrls } = buildImageGenerationInput(shot, project);
      const { size, ratio } = aspectRatioToImageParams(project.aspectRatio);

      const imageUrl = await generateImage({
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        prompt: enrichedPrompt,
        size,
        ratio,
        ...(referenceImageUrls.length > 0 ? { referenceImageUrls } : {}),
      });

      store.updateShotByProjectId(targetProjectId, shotId, { imageUrl, status: "imaged" });
      restoreProjectStatusIfReady(targetProjectId, (currentProject) =>
        currentProject.shots.every((item) => !!item.imageUrl),
      );
      useProjectStore.getState().addHistory(
        "shot_regenerated",
        { key: "history.shotImageRerolled", params: { index: shot.index + 1 } },
        targetProjectId,
      );
    } catch (err) {
      store.setShotStatusByProjectId(
        targetProjectId,
        shotId,
        "failed",
        err instanceof Error ? err.message : String(err),
      );
    }
  }, []);

  return { generateImagesForStep, rerollImage };
}

export { buildImageGenerationInput };
