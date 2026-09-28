import { useCallback } from "react";
import {
  useProjectStore,
  selectActiveProject,
  type Asset,
  type Shot,
} from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { generateImage, aspectRatioToImageParams } from "@/services/imageService";
import { composeVisualPrompt } from "@/lib/promptUtils";
import { createBatchRunner, hasActiveTask } from "@/lib/batchRunner";
import {
  composeMultiReferencePrompt,
  composeTextToImagePrompt,
  getStylePrompt,
  pickShotReferences,
  type RegistryRuleText,
} from "@/lib/promptComposer";
import { getActiveRenderRules } from "@/lib/promptRules";
import { getTranslation } from "@/i18n";
import { pendingImageShots, canStartSingleReroll, isShotInFlight } from "@/lib/shotQueue";
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
): "character" | "scene" | "product" | "prop" | "style" {
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
  // 资产图本身已经承载身份/外观；镜头 visualPrompt 也已是唯一文本 SSOT。
  // 这里仅保留名称，避免把同一段资产英文描述再次复制进请求。
  return asset.name.trim();
}

/**
 * 取分镜图提示词的正向约束渲染文本（只收带 renderContent 的生效条目）。
 * 否定句式仍未实测中文等效，故按英文口径取 en（2026-09-23 记录）。
 * 调用方（非 lib）读 store 取生效规则，lib 保持纯函数。
 */
function extractShotImageRules(): RegistryRuleText {
  return {
    composeShot: getActiveRenderRules("composeShot", "en"),
    negativeStrategy: getActiveRenderRules("negativeStrategy", "en"),
  };
}

/**
 * Compose the complete image prompt and the multi-reference list for a shot.
 * - 参考图：pickShotReferences（角色定妆照 → 产品 → 道具，≤4 张；场景图与风格母版都不进参考，只以文本注入）
 * - 有参考图：composeMultiReferencePrompt（参考图角色说明 + 图像关系指令）
 * - 无参考图：composeTextToImagePrompt 六段式
 * - rules：composeShot / negativeStrategy 注册表生效规则，作为正向约束拼入提示词
 *   （不新增 API negative 字段、不污染 stylePrompt、不动风格母版隔离铁律）。
 */
function buildImageGenerationInput(
  shot: Shot,
  project: { style: string; assets: Asset[] },
  rules?: RegistryRuleText,
): ImageGenerationInput {
  const referenceImageUrls = pickShotReferences(shot, project);
  // visualPrompt 已包含镜头主体与动作；参考图说明只保留一次，避免资产描述重复注入。
  const subject = composeVisualPrompt(shot);
  const stylePrompt = getStylePrompt(project);

  if (referenceImageUrls.length > 0) {
    const references = referenceImageUrls.map((url, i) => ({
      index: i + 1,
      role: describeReferenceRole(url, project),
      note: describeReferenceNote(url, project),
    }));
    return {
      prompt: composeMultiReferencePrompt({
        references,
        scene: subject,
        style: stylePrompt,
        rules,
      }),
      referenceImageUrls,
    };
  }

  return {
    prompt: composeTextToImagePrompt({
      subject,
      style: (stylePrompt ?? project.style) || undefined,
      quality: "high quality, 8k",
      rules,
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
    const shotsNeedingImages = pendingImageShots(latestProject.shots);
    const { size: imageSize, ratio: imageRatio } = aspectRatioToImageParams(latestProject.aspectRatio);
    const rules = extractShotImageRules();

    return shotsNeedingImages.map((shot) => async () => {
      if (signal.aborted) return;
      // 列表是启动时快照：期间用户可能对同一镜头点了单项重摇，此时本任务再建一张就是重复扣配额
      const live = useProjectStore.getState().projects
        .find((p) => p.id === pid)?.shots.find((s) => s.id === shot.id);
      if (live && isShotInFlight(live)) return;
      const expectedRevision = shot.renderRevision ?? 0;
      useProjectStore.getState().setShotStatusByProjectId(pid, shot.id, "imaging");

      try {
        const { prompt: enrichedPrompt, referenceImageUrls } = buildImageGenerationInput(
          shot,
          latestProject,
          rules,
        );
        const imageUrl = await generateImage({
          apiKey: providerConfig.apiKey,
          baseUrl: providerConfig.baseUrl,
          prompt: enrichedPrompt,
          size: imageSize,
          ratio: imageRatio,
          ...(referenceImageUrls.length > 0 ? { referenceImageUrls } : {}),
        });

        useProjectStore.getState().updateShotByProjectIdIfRevision(
          pid,
          shot.id,
          expectedRevision,
          { imageUrl, status: "imaged" },
        );
      } catch (err) {
        useProjectStore.getState().setShotStatusByProjectIdIfRevision(
          pid,
          shot.id,
          expectedRevision,
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
        getTranslation("error.imageBatchFailed", { count: failedCount }),
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
    // §12-3 幂等守卫：批量在跑或本镜已有任务在飞时不重复发起。
    // 批量的任务列表在启动时快照，此时再建一张同镜图片它看不见，只会多扣一档图片配额。
    if (!canStartSingleReroll({ batchActive: hasActiveTask(activeImageTasks, targetProjectId), shot })) return;

    const expectedRevision = shot.renderRevision ?? 0;
    store.setShotStatusByProjectId(targetProjectId, shotId, "imaging");

    try {
      const { prompt: enrichedPrompt, referenceImageUrls } = buildImageGenerationInput(
        shot,
        project,
        extractShotImageRules(),
      );
      const { size, ratio } = aspectRatioToImageParams(project.aspectRatio);

      const imageUrl = await generateImage({
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        prompt: enrichedPrompt,
        size,
        ratio,
        ...(referenceImageUrls.length > 0 ? { referenceImageUrls } : {}),
      });

      const applied = store.updateShotByProjectIdIfRevision(
        targetProjectId,
        shotId,
        expectedRevision,
        { imageUrl, status: "imaged" },
      );
      if (!applied) return;
      restoreProjectStatusIfReady(targetProjectId, (currentProject) =>
        currentProject.shots.every((item) => !!item.imageUrl),
      );
    } catch (err) {
      store.setShotStatusByProjectIdIfRevision(
        targetProjectId,
        shotId,
        expectedRevision,
        "failed",
        err instanceof Error ? err.message : String(err),
      );
    }
  }, []);

  return { generateImagesForStep, rerollImage };
}

export { buildImageGenerationInput };
