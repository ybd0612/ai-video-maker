import { useCallback } from "react";
import {
  useProjectStore,
  selectActiveProject,
  newId,
  type Asset,
  type StyleDetails,
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
  composeStyleAnchorInstruction,
  collectSubjectVocabulary,
} from "@/lib/promptComposer";
import { parseJsonFromResponse } from "@/lib/jsonResponse";
import { beginTrace } from "@/lib/logger";
import { resolveGenerationParams } from "@/lib/generationParams";
import { refineWithAudit, type AuditOutcome } from "@/lib/refineContent";
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
 * L2 派生：从中文风格描述 + 视觉方向结构化字段派生英文 stylePrompt。
 * 输入刻意不含故事主体（故事上下文会把角色/剧情带进风格母版）。
 * 派生失败（网络/内容过滤/空输出）走兜底链，不阻塞风格图生成。
 */
async function deriveStylePrompt(
  styleDescription: string,
  apiKey: string,
  baseUrl: string,
  visualDirection?: { name?: string; details?: StyleDetails },
): Promise<string> {
  const zhStyle = styleDescription.trim();
  const details = visualDirection?.details;
  if (zhStyle || details) {
    try {
      const service = createAIService({ provider: "openai", apiKey, baseUrl });
      const userContent = [
        zhStyle ? `Desired style (Chinese): ${zhStyle}` : "",
        details
          ? [
              `Medium and material: ${details.mediumMaterial}`,
              `Color palette: ${details.colorPalette}`,
              `Lighting and mood: ${details.lightingMood}`,
              `Camera texture: ${details.cameraTexture}`,
              `Composition: ${details.composition}`,
              `Emotion: ${details.emotion}`,
            ].filter((value) => !value.endsWith(": ")).join("\n")
          : "",
      ]
        .filter(Boolean)
        .join("\n");
      const params = await resolveGenerationParams({
        purpose: "styleRef",
        apiKey,
        baseUrl,
        context: [
          "Task: derive ONE English image-style prompt (pure visual language) from a structured visual direction; the result becomes the shared style reference for all assets.",
          `Desired style given by user: ${zhStyle || "(none)"}`,
        ].join("\n"),
      });
      const result = await service.chatCompletion({
        messages: [
          { role: "system", content: buildRulesSystemPrompt("styleRef", "en", getActiveRules()) },
          { role: "user", content: userContent },
        ],
        temperature: params.temperature,
        ...(params.topP === undefined ? {} : { topP: params.topP }),
        enableThinking: params.enableThinking,
      });
      const text = result.content.trim();
      if (text) return text;
    } catch (err) {
      console.warn("Style prompt derivation failed, using fallback:", err);
    }
  }
  return fallbackStylePrompt(zhStyle);
}

/**
 * LLM 审计：风格提示词是否混入项目自身主体（角色/场景/产品/道具名）。
 * 禁止清单来自项目数据（collectSubjectVocabulary），代码不硬编码任何风格/物种关键词；
 * 是否越界与如何重写都由模型判断（task=stylePromptAudit）。
 * 返回 clean=true 时表示无需改动；审计失败时同样返回 clean=true（保留原文，不阻塞生成）。
 */
async function auditStylePrompt(i: {
  stylePrompt: string;
  subjects: string[];
  apiKey: string;
  baseUrl: string;
}): Promise<AuditOutcome<string>> {
  const keep = { clean: true as const, value: i.stylePrompt };
  if (i.subjects.length === 0) return keep;
  try {
    const service = createAIService({ provider: "openai", apiKey: i.apiKey, baseUrl: i.baseUrl });
    const params = await resolveGenerationParams({
      purpose: "stylePromptAudit",
      apiKey: i.apiKey,
      baseUrl: i.baseUrl,
      context:
        "Task: audit an English style prompt against the project's own subject list and rewrite it when it overreaches; the result is shown to the image model as a pure style master.",
    });
    const result = await service.chatCompletion({
      messages: [
        { role: "system", content: buildRulesSystemPrompt("stylePromptAudit", "en", getActiveRules()) },
        {
          role: "user",
          content: [
            `Style prompt: ${i.stylePrompt}`,
            `Forbidden subject list: ${i.subjects.join(", ")}`,
          ].join("\n"),
        },
      ],
      temperature: params.temperature,
      ...(params.topP === undefined ? {} : { topP: params.topP }),
      enableThinking: params.enableThinking,
    });
    const parsed = parseJsonFromResponse<{ clean?: boolean; rewritten?: string }>(result.content);
    if (!parsed || parsed.clean !== false) return keep;
    const rewritten = parsed.rewritten?.trim();
    return rewritten ? { clean: false, value: rewritten } : keep;
  } catch (err) {
    console.warn("Style prompt audit failed, keeping derived prompt:", err);
    return keep;
  }
}

/** 风格提示词精修轮数上限（效果优先，允许多轮；每轮仅一次文本调用） */
const STYLE_PROMPT_MAX_ROUNDS = 2;

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

    const trace = beginTrace("logmsg.trace.generateStyleReference", { projectId: pid, force });

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
        const subjects = collectSubjectVocabulary(latest);
        // 派生 → 自检 → 越界则由模型重写，最多 STYLE_PROMPT_MAX_ROUNDS 轮。
        // 代码只控制轮数与失败兜底，是否越界与如何重写全部由模型判断。
        const audited = await refineWithAudit<string>({
          produce: () =>
            deriveStylePrompt(
              latest.style.trim(),
              providerConfig.apiKey,
              providerConfig.baseUrl,
              latest.visualDirection,
            ),
          audit: (current, round) =>
            auditStylePrompt({
              stylePrompt: current,
              subjects,
              apiKey: providerConfig.apiKey,
              baseUrl: providerConfig.baseUrl,
            }).then((outcome) => {
              if (!outcome.clean) {
                console.info(`Style prompt audited as off-boundary (round ${round}), using rewrite.`);
              }
              return outcome;
            }),
          maxRounds: STYLE_PROMPT_MAX_ROUNDS,
        });
        const applied = useProjectStore.getState().updateAssetByProjectIdIfRevision(
          pid,
          styleAssetId,
          styleRevision,
          { prompt: audited },
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

      const stylePrompt = styleAsset.prompt.trim() || fallbackStylePrompt(latest.style.trim());
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
    } catch (err) {
      useProjectStore.getState().updateProjectById(pid, (currentProject) => ({
        ...currentProject,
        styleReferenceError: err instanceof Error ? err.message : String(err),
      }));
      console.error("Failed to generate style reference:", err);
    } finally {
      activeAssetTasks.delete(pid);
      trace.finish();
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

    const trace = beginTrace("logmsg.trace.generateAssetImages", { projectId: targetProjectId, options: { ...opts } });

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
          ? `${composeStyleAnchorInstruction()} `
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

    try {
      await runAssetBatch({ projectId: targetProjectId, concurrency: 3 });
      trace.finish();
    } catch (error) {
      trace.finish(error);
      throw error;
    }
  }, [generateStyleReference]);

  return { generateAssetImages, generateStyleReference };
}
