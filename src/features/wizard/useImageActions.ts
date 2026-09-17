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
import { createBatchRunner } from "@/lib/batchRunner";
import {
  composeMultiReferencePrompt,
  composeTextToImagePrompt,
  getStylePrompt,
  pickShotReferences,
  type RegistryRuleText,
} from "@/lib/promptComposer";
import { getActiveRules, getActiveRuleText } from "@/lib/promptRules";
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
 * 从注册表提取分镜图提示词拼装所需的正向约束文本。
 * visualPrompt / motionPrompt 恒为英文（见 promptRules 的 storyboard 约束），故取 en。
 * 调用方（非 lib）读 store 取生效规则，lib 保持纯函数。
 */
function extractShotImageRules(): RegistryRuleText {
  const rules = getActiveRules();
  return {
    composeShot: getActiveRuleText("composeShot", "en", rules),
    negativeStrategy: getActiveRuleText("negativeStrategy", "en", rules),
  };
}

/**
 * Compose the complete image prompt and the multi-reference list for a shot.
 * - 参考图：pickShotReferences（场景 → 角色 → 产品/道具，≤3 张；风格通过文本注入）
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
    const shotsNeedingImages = latestProject.shots.filter(
      (shot) => !shot.imageUrl && shot.status !== "imaging" && shot.visualPrompt.trim(),
    );
    const { size: imageSize, ratio: imageRatio } = aspectRatioToImageParams(latestProject.aspectRatio);
    const rules = extractShotImageRules();

    return shotsNeedingImages.map((shot) => async () => {
      if (signal.aborted) return;
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
