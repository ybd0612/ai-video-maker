import { useCallback } from "react";
import {
  useProjectStore,
  selectActiveProject,
  newId,
  type Asset,
} from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { generateImage, aspectRatioToImageParams } from "@/services/imageService";
import { createAIService } from "@/services/ai/factory";
import { createBatchRunner, hasActiveTask } from "@/lib/batchRunner";
import {
  getStylePrompt,
  getStyleReferenceUrl,
  composeImageToImagePrompt,
  composePortraitPrompt,
  assetImageBoundary,
  composeStyleReferencePrompt,
  sanitizeVisualDirectionField,
} from "@/lib/promptComposer";
import { buildSystemPrompt as buildRulesSystemPrompt, getActiveRules } from "@/lib/promptRules";

const activeAssetTasks = new Map<string, AbortController>();

export interface AssetGenerationOptions {
  generatePortraits?: boolean;
  generateScenes?: boolean;
  generateProducts?: boolean;
  generateProps?: boolean;
  generateStyle?: boolean;
}

export interface AssetActions {
  generateAssetImages: (
    opts?: AssetGenerationOptions,
    projectIdOverride?: string,
  ) => Promise<void>;
  generateStyleReference: (targetProjectId?: string, force?: boolean) => Promise<void>;
}

/** 查询某项目是否仍有存活的资产生成任务，供资产步骤恢复 UI 标记。 */
export function hasActiveAssetTask(projectId: string): boolean {
  return hasActiveTask(activeAssetTasks, projectId);
}

/** 派生失败兜底：project.style 非空 → style reference 模板；否则 cinematic 模板。 */
function fallbackStylePrompt(style: string): string {
  return style
    ? `${style} style reference, cohesive visual aesthetic, color palette, mood board`
    : "Cinematic style reference, cohesive visual aesthetic, warm tones, professional photography";
}

/**
 * L2 派生：从想法文本 + 中文风格描述派生英文 stylePrompt。
 * 派生失败（网络/内容过滤/空输出）走兜底链，不阻塞风格图生成。
 */
async function deriveStylePrompt(
  styleDescription: string,
  apiKey: string,
  baseUrl: string,
  visualDirection?: {
    mediumMaterial: string;
    colorPalette: string;
    lightingMood: string;
    cameraTexture: string;
    composition: string;
    emotion: string;
  },
): Promise<string> {
  const zhStyle = styleDescription.trim();
  if (zhStyle || visualDirection) {
    try {
      const service = createAIService({ provider: "openai", apiKey, baseUrl });
      const userContent = [
        zhStyle ? `Desired style (Chinese): ${zhStyle}` : "",
        visualDirection
          ? [
              `Medium and material: ${sanitizeVisualDirectionField(visualDirection.mediumMaterial, "material")}`,
              `Color palette: ${sanitizeVisualDirectionField(visualDirection.colorPalette)}`,
              `Lighting and mood: ${sanitizeVisualDirectionField(visualDirection.lightingMood)}`,
              `Camera texture: ${sanitizeVisualDirectionField(visualDirection.cameraTexture)}`,
              `Composition: ${sanitizeVisualDirectionField(visualDirection.composition, "composition")}`,
              `Emotion: ${sanitizeVisualDirectionField(visualDirection.emotion)}`,
            ].filter((value) => !value.endsWith(": ")).join("\n")
          : "",
      ]
        .filter(Boolean)
        .join("\n");
      const result = await service.chatCompletion({
        messages: [
          { role: "system", content: buildRulesSystemPrompt("styleRef", "en", getActiveRules()) },
          { role: "user", content: userContent },
        ],
        temperature: 0.4,
        enableThinking: false,
      });
      const text = result.content.trim();
      if (text) return text;
    } catch (err) {
      console.warn("Style prompt derivation failed, using fallback:", err);
    }
  }
  return fallbackStylePrompt(zhStyle);
}

export function useAssetActions(): AssetActions {
  /**
   * 生成风格参考图（项目级风格锚点）。
   * 幂等：已有风格图（force=true 除外），或该项目已有资产生成任务在跑时直接跳过。
   */
  const generateStyleReference = useCallback(async (targetProjectId?: string, force = false) => {
    const { providerConfig } = useSettingsStore.getState();
    if (!providerConfig.apiKey || !providerConfig.baseUrl) return;

    const store = useProjectStore.getState();
    const project = targetProjectId
      ? store.projects.find((item) => item.id === targetProjectId)
      : selectActiveProject(store);
    if (!project) return;
    const pid = project.id;

    if (getStyleReferenceUrl(project) && !force) return;
    if (hasActiveTask(activeAssetTasks, pid)) return;

    const controller = new AbortController();
    activeAssetTasks.set(pid, controller);

    try {
      const latest = useProjectStore.getState().projects.find((item) => item.id === pid) ?? project;
      let styleAsset = latest.assets.find((asset) => asset.type === "style");
      if (!styleAsset) {
        const created: Asset = {
          id: newId("asset"),
          type: "style",
          source: "extracted",
          name: latest.language === "en" ? "Overall style" : "整体风格",
          description: latest.style.trim(),
          prompt: "",
        };
        useProjectStore.getState().updateProjectById(pid, (currentProject) => ({
          ...currentProject,
          assets: [...currentProject.assets, created],
        }));
        styleAsset = created;
      }

      const styleAssetId = styleAsset.id;
      let styleRevision = styleAsset.renderRevision ?? 0;
      if ((force || !styleAsset.prompt.trim()) && (!styleAsset.derivation?.locked || force)) {
        const derived = await deriveStylePrompt(
          latest.style.trim(),
          providerConfig.apiKey,
          providerConfig.baseUrl,
          latest.visualDirection,
        );
        const applied = useProjectStore.getState().updateAssetByProjectIdIfRevision(
          pid,
          styleAssetId,
          styleRevision,
          { prompt: derived },
        );
        if (!applied) return;
        const refreshedStyleAsset = useProjectStore
          .getState()
          .projects.find((item) => item.id === pid)
          ?.assets.find((asset) => asset.id === styleAssetId);
        if (!refreshedStyleAsset) return;
        styleAsset = refreshedStyleAsset;
        styleRevision = refreshedStyleAsset.renderRevision ?? 0;
      }

      const stylePrompt = sanitizeVisualDirectionField(styleAsset.prompt.trim() || fallbackStylePrompt(latest.style.trim()));
      const imagePrompt = composeStyleReferencePrompt(stylePrompt);
      const { size, ratio } = aspectRatioToImageParams(latest.aspectRatio);

      const url = await generateImage({
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        prompt: imagePrompt,
        size,
        ratio,
      });
      const applied = useProjectStore.getState().updateAssetByProjectIdIfRevision(
        pid,
        styleAssetId,
        styleRevision,
        { imageUrl: url, error: undefined },
      );
      if (!applied) return;
      useProjectStore.getState().updateProjectById(pid, (currentProject) => ({
        ...currentProject,
        styleReferenceUrl: url,
        styleReferenceError: undefined,
      }));
      useProjectStore.getState().addHistory("style_generated", { key: "history.styleGenerated" }, pid);
    } catch (err) {
      useProjectStore.getState().updateProjectById(pid, (currentProject) => ({
        ...currentProject,
        styleReferenceError: err instanceof Error ? err.message : String(err),
      }));
      console.error("Failed to generate style reference:", err);
    } finally {
      activeAssetTasks.delete(pid);
    }
  }, []);

  /** Step 2: Generate asset images immediately after asset extraction (character portraits + scene/product references). */
  const generateAssetImages = useCallback(async (
    opts?: AssetGenerationOptions,
    projectIdOverride?: string,
  ) => {
    const { providerConfig } = useSettingsStore.getState();
    if (!providerConfig.apiKey || !providerConfig.baseUrl) return;

    const store = useProjectStore.getState();
    const project = projectIdOverride
      ? store.projects.find((item) => item.id === projectIdOverride)
      : selectActiveProject(store);
    if (!project) return;
    const targetProjectId = project.id;

    if (hasActiveTask(activeAssetTasks, targetProjectId)) return;

    const generatePortraits = opts?.generatePortraits !== false;
    const generateScenes = opts?.generateScenes !== false;
    const generateProducts = opts?.generateProducts !== false;
    const generateProps = opts?.generateProps !== false;
    const generateStyle = opts?.generateStyle !== false;

    // 阶段 1：风格参考图先行。风格失败不阻塞资产图，资产图会退化为文生图。
    if (generateStyle && !getStyleReferenceUrl(project)) {
      await generateStyleReference(targetProjectId);
    }

    const runAssetBatch = createBatchRunner({
      registry: activeAssetTasks,
      buildTasks: (_pid, signal) => {
        const latestProject = useProjectStore.getState().projects.find((item) => item.id === targetProjectId);
        const styleReferenceUrl = latestProject ? getStyleReferenceUrl(latestProject) : undefined;
        const stylePrompt = latestProject ? getStylePrompt(latestProject) : undefined;
        const styleInstruction = styleReferenceUrl
          ? "Match the art style, color palette and lighting mood of the reference image; do not copy its content or composition. "
          : "";
        const { size: imageSize, ratio: imageRatio } = aspectRatioToImageParams(project.aspectRatio);
        const tasks: Array<() => Promise<void>> = [];

        if (generatePortraits) {
          for (const char of project.assets.filter((asset) => asset.type === "character")) {
            if (char.imageUrl) continue;
            tasks.push(async () => {
              if (signal.aborted) return;
              const expectedRevision = char.renderRevision ?? 0;
              try {
                const portraitPrompt = composePortraitPrompt({
                  appearancePrompt: char.appearancePrompt?.trim() || char.prompt.trim(),
                  stylePrompt,
                });
                const url = await generateImage({
                  apiKey: providerConfig.apiKey,
                  baseUrl: providerConfig.baseUrl,
                  prompt: `${styleInstruction}${portraitPrompt}`,
                  size: imageSize,
                  ratio: imageRatio,
                  ...(styleReferenceUrl ? { referenceImageUrls: [styleReferenceUrl] } : {}),
                });
                useProjectStore.getState().updateAssetByProjectIdIfRevision(
                  targetProjectId,
                  char.id,
                  expectedRevision,
                  { imageUrl: url, error: undefined },
                );
              } catch (err) {
                useProjectStore.getState().updateAssetByProjectIdIfRevision(
                  targetProjectId,
                  char.id,
                  expectedRevision,
                  { error: err instanceof Error ? err.message : String(err) },
                );
                console.error(`Failed to generate portrait for ${char.name}:`, err);
              }
            });
          }
        }

        if (generateScenes) {
          for (const scene of project.assets.filter((asset) => asset.type === "scene")) {
            if (scene.imageUrl) continue;
            tasks.push(async () => {
              if (signal.aborted) return;
              const expectedRevision = scene.renderRevision ?? 0;
              try {
                const url = await generateImage({
                  apiKey: providerConfig.apiKey,
                  baseUrl: providerConfig.baseUrl,
                  prompt: composeImageToImagePrompt({
                    change: `${assetImageBoundary("scene")} ${styleInstruction.trim()}`,
                    newStyle: stylePrompt,
                    keep: scene.prompt,
                  }),
                  size: imageSize,
                  ratio: imageRatio,
                  ...(styleReferenceUrl ? { referenceImageUrls: [styleReferenceUrl] } : {}),
                });
                useProjectStore.getState().updateAssetByProjectIdIfRevision(
                  targetProjectId,
                  scene.id,
                  expectedRevision,
                  { imageUrl: url, error: undefined },
                );
              } catch (err) {
                useProjectStore.getState().updateAssetByProjectIdIfRevision(
                  targetProjectId,
                  scene.id,
                  expectedRevision,
                  { error: err instanceof Error ? err.message : String(err) },
                );
                console.error(`Failed to generate scene image for ${scene.name}:`, err);
              }
            });
          }
        }

        if (generateProducts) {
          for (const product of project.assets.filter((asset) => asset.type === "product")) {
            if (product.imageUrl) continue;
            tasks.push(async () => {
              if (signal.aborted) return;
              const expectedRevision = product.renderRevision ?? 0;
              try {
                const url = await generateImage({
                  apiKey: providerConfig.apiKey,
                  baseUrl: providerConfig.baseUrl,
                  prompt: composeImageToImagePrompt({
                    change: `${assetImageBoundary("product")} ${styleInstruction.trim()}`,
                    newStyle: stylePrompt,
                    keep: product.prompt,
                  }),
                  size: imageSize,
                  ratio: imageRatio,
                  ...(styleReferenceUrl ? { referenceImageUrls: [styleReferenceUrl] } : {}),
                });
                useProjectStore.getState().updateAssetByProjectIdIfRevision(
                  targetProjectId,
                  product.id,
                  expectedRevision,
                  { imageUrl: url, error: undefined },
                );
              } catch (err) {
                useProjectStore.getState().updateAssetByProjectIdIfRevision(
                  targetProjectId,
                  product.id,
                  expectedRevision,
                  { error: err instanceof Error ? err.message : String(err) },
                );
                console.error(`Failed to generate product image for ${product.name}:`, err);
              }
            });
          }
        }

        if (generateProps) {
          for (const prop of project.assets.filter((asset) => asset.type === "prop")) {
            if (prop.imageUrl) continue;
            tasks.push(async () => {
              if (signal.aborted) return;
              const expectedRevision = prop.renderRevision ?? 0;
              try {
                const url = await generateImage({
                  apiKey: providerConfig.apiKey,
                  baseUrl: providerConfig.baseUrl,
                  prompt: composeImageToImagePrompt({
                    change: `${assetImageBoundary("prop")} ${styleInstruction.trim()}`,
                    newStyle: stylePrompt,
                    keep: prop.prompt,
                  }),
                  size: imageSize,
                  ratio: imageRatio,
                  ...(styleReferenceUrl ? { referenceImageUrls: [styleReferenceUrl] } : {}),
                });
                useProjectStore.getState().updateAssetByProjectIdIfRevision(
                  targetProjectId,
                  prop.id,
                  expectedRevision,
                  { imageUrl: url, error: undefined },
                );
              } catch (err) {
                useProjectStore.getState().updateAssetByProjectIdIfRevision(
                  targetProjectId,
                  prop.id,
                  expectedRevision,
                  { error: err instanceof Error ? err.message : String(err) },
                );
                console.error(`Failed to generate prop image for ${prop.name}:`, err);
              }
            });
          }
        }

        return tasks;
      },
      onBeforeRun: (pid) => {
        useProjectStore.getState().setAssetGenerationStartedByProjectId(pid, true);
      },
      onEmpty: (pid) => {
        useProjectStore.getState().setAssetGenerationStartedByProjectId(pid, false);
      },
      onFinally: (pid) => {
        useProjectStore.getState().setAssetGenerationStartedByProjectId(pid, false);
      },
    });

    await runAssetBatch({ projectId: targetProjectId, concurrency: 3 });
  }, [generateStyleReference]);

  return { generateAssetImages, generateStyleReference };
}
