import { useCallback } from "react";
import { confirmDialog } from "@/components/ui/ConfirmDialog";
import {
  useProjectStore,
  selectActiveProject,
  type Asset,
  type AssetType,
  type Shot,
  type VisualDirection,
} from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useT } from "@/i18n";
import { extractAssetsFromIdea, extractVisualDirectionFromIdea, generateScript, auditVisualDirection, type RawVisualDirection } from "@/services/scriptService";
import { extractNewAssets } from "@/lib/extractAssets";
import { collectSubjectVocabulary } from "@/lib/promptComposer";
import { refineWithAudit } from "@/lib/refineContent";
import { beginTrace } from "@/lib/logger";
import { pickShotFields } from "@/lib/shotFields";
import { restoreProjectStatusIfReady } from "./wizardActionUtils";

/** 视觉方向自检轮数上限（2026-09-15 由 2 → 1：审计+重写已合一，第 2 轮边际收益低于 ~40s 耗时）。 */
const VISUAL_DIRECTION_MAX_ROUNDS = 1;

export interface ScriptActions {
  extractCharactersFromIdea: (prompt: string) => Promise<boolean>;
  generateStoryboard: (prompt: string) => Promise<void>;
  rerollShot: (shotId: string) => Promise<void>;
}

export function useScriptActions(
  generateStyleReference: (targetProjectId?: string, force?: boolean) => Promise<void>,
  generateAssetImages: (
    opts?: {
      generatePortraits?: boolean;
      generateScenes?: boolean;
      generateProducts?: boolean;
      generateProps?: boolean;
      generateStyle?: boolean;
    },
    projectIdOverride?: string,
  ) => Promise<void>,
): ScriptActions {
  const t = useT();

  const resolveAssetId = (ref: string | undefined, assets: Asset[], type: AssetType): string | undefined => {
    if (!ref?.trim()) return undefined;
    const candidates = assets.filter((asset) => asset.type === type);
    const direct = candidates.find((asset) => asset.id === ref);
    if (direct) return direct.id;
    const normalized = ref.trim().toLocaleLowerCase();
    return candidates.find((asset) => asset.name.trim().toLocaleLowerCase() === normalized)?.id;
  };

  const resolveAssetIds = (refs: string[], assets: Asset[], type: AssetType): string[] =>
    refs
      .map((ref) => resolveAssetId(ref, assets, type))
      .filter((id): id is string => !!id);

  /**
   * Step 1→2: Extract characters from idea, advance to assets step.
   * 返回 false 表示用户在确认弹窗中取消了重新提取。
   */
  const extractCharactersFromIdea = useCallback(async (prompt: string): Promise<boolean> => {
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

    const manualAssets = project.assets.filter((a) => a.source === "manual");
    const autoAssets = project.assets.filter((a) => a.source !== "manual");
    if (autoAssets.length > 0) {
      const ok = await confirmDialog({
        title: t("wizard.reextractTitle"),
        message: t("wizard.reextractMessage", {
          auto: autoAssets.length,
          manual: manualAssets.length,
          names: autoAssets.map((a) => a.name).join("、"),
        }),
      });
      if (!ok) return false;
    }

    // 发起即清空旧 auto 资产与其派生（仅保留手动添加的）：
    // 并行模式下视觉方向先完成就会切到步骤 2，不清空的话页面会显示上一次的
    // 旧资产卡片，被误当成新结果。提取失败时旧资产不恢复，重试即可。
    useProjectStore.getState().updateProjectById(targetProjectId, (p) => ({
      ...p,
      assets: p.assets.filter((a) => a.source === "manual"),
      styleReferenceUrl: undefined,
      styleReferenceError: undefined,
      assetsReviewed: false,
      status: "scripting",
    }));

    const trace = beginTrace("logmsg.trace.extractFromIdea", { projectId: targetProjectId });

    try {
      const baseOpts = {
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        prompt,
        language: project.language,
        aspectRatio: project.aspectRatio,
        assets: project.assets,
      };

      // 链 A：视觉方向（提取 → 自检 → 写回）。
      // 完成即写回并切到步骤 2：用户 ~35-55s 就能看到/编辑视觉方向，
      // 不必等资产提取（~53s）与后续图片链路全部结束。
      const directionTask = (async () => {
        const refined = await refineWithAudit<RawVisualDirection>({
          produce: () => extractVisualDirectionFromIdea(baseOpts),
          // 自检：禁止清单来自项目自身非风格资产名（数据驱动），是否越界与如何重写由模型判断。
          audit: (current) =>
            auditVisualDirection({
              apiKey: providerConfig.apiKey,
              baseUrl: providerConfig.baseUrl,
              language: project.language,
              direction: current,
              forbiddenSubjects: collectSubjectVocabulary(project),
            }),
          maxRounds: VISUAL_DIRECTION_MAX_ROUNDS,
        });
        const visualDirection: VisualDirection = {
          name: refined.name,
          description: refined.description,
          details: refined.details,
          revision: (project.visualDirection?.revision ?? 0) + 1,
          status: "draft" as const,
        };
        useProjectStore.getState().updateProjectById(targetProjectId, (p) => ({
          ...p,
          visualDirection,
          status: "idle",
          wizardStep: 2,
        }));
        return visualDirection;
      })();

      // 链 B：资产提取。与链 A 并行（视觉方向参数可省——资产 prompt 的风格一致性
      // 由生图时的 stylePrompt 文本兜底）；成功后整体替换旧 auto 资产。
      const assetsTask = (async () => {
        const result = await extractAssetsFromIdea(baseOpts);

        const newCharacters = extractNewAssets(project.assets, result.characters, "character", manualAssets);
        const newProducts = extractNewAssets(project.assets, result.products, "product", manualAssets);
        const newProps = extractNewAssets(project.assets, result.props, "prop", manualAssets);
        const newScenes = extractNewAssets(project.assets, result.scenes, "scene", manualAssets);
        const newStyles = extractNewAssets(project.assets, result.styles, "style", manualAssets);
        const newAssets = [
          ...newStyles.assets,
          ...newCharacters.assets,
          ...newScenes.assets,
          ...newProducts.assets,
          ...newProps.assets,
        ];
        const manualNames = new Set(manualAssets.map((a) => a.name.trim().toLocaleLowerCase()));
        const dedupedNew = newAssets.filter(
          (a) => !manualNames.has(a.name.trim().toLocaleLowerCase()),
        );

        // 提取成功才替换旧 auto 资产（失败时保留现状供用户重试）；
        // 旧风格图对应旧 style 资产，一并作废
        useProjectStore.getState().updateProjectById(targetProjectId, (p) => ({
          ...p,
          assets: [...manualAssets, ...dedupedNew],
          styleReferenceUrl: undefined,
          styleReferenceError: undefined,
          assetsReviewed: false,
          error: undefined,
        }));
        return dedupedNew.length;
      })();

      // 两链并行；任一失败保留另一链已写回的内容并按失败收尾（用户重试走原确认弹窗）
      const [directionOutcome, assetsOutcome] = await Promise.allSettled([directionTask, assetsTask]);
      const directionError = directionOutcome.status === "rejected" ? directionOutcome.reason : null;
      const assetsError = assetsOutcome.status === "rejected" ? assetsOutcome.reason : null;

      if (directionError || assetsError) {
        const failure = directionError ?? assetsError;
        trace.finish(failure);
        useProjectStore.getState().updateProjectById(targetProjectId, (p) => ({
          ...p,
          status: "failed",
          error: failure instanceof Error ? failure.message : String(failure),
        }));
        throw failure;
      }

      // 后台生成链路仍按原顺序执行：先风格参考图，再生成角色/场景/产品图。
      void (async () => {
        await generateStyleReference(targetProjectId);
        await generateAssetImages(undefined, targetProjectId);
      })();
      trace.finish();
      return true;
    } catch (err) {
      trace.finish(err);
      useProjectStore.getState().updateProjectById(targetProjectId, (p) => ({
        ...p,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      }));
      throw err;
    }
  }, [generateAssetImages, generateStyleReference, t]);

  /** Step 3: Generate storyboard shots using asset context. */
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

      const existingCharacters = project.assets.filter((a) => a.type === "character");
      const idByName = new Map<string, string>();
      for (const c of existingCharacters) idByName.set(c.name.trim().toLocaleLowerCase(), c.id);

      const { assets: newCharacters } = extractNewAssets(
        project.assets,
        result.characters,
        "character",
      );
      const newProducts = extractNewAssets(project.assets, result.products, "product").assets;
      const newProps = extractNewAssets(project.assets, result.props, "prop").assets;
      const newScenes = extractNewAssets(project.assets, result.scenes, "scene").assets;
      const newStyles = extractNewAssets(project.assets, result.styles, "style").assets;
      const newAssets = [...newCharacters, ...newProducts, ...newProps, ...newScenes, ...newStyles];
      const assetsForResolution = [...project.assets, ...newAssets];

      for (const c of newCharacters) idByName.set(c.name.trim().toLocaleLowerCase(), c.id);

      const resolveCharacterId = (ref: string): string | null => {
        const normalized = ref.trim().toLocaleLowerCase();
        const matched = idByName.get(normalized);
        if (matched) return matched;
        return assetsForResolution.some((asset) => asset.type === "character" && asset.id === ref)
          ? ref
          : null;
      };

      const shots: Shot[] = result.shots.map((s, i) => ({
        id: `shot_${Date.now()}_${i}`,
        index: i,
        status: "scripted" as const,
        ...s,
        activeCharacterIds: (s.activeCharacterIds ?? [])
          .map(resolveCharacterId)
          .filter((x): x is string => x !== null),
        activeSceneId: resolveAssetId(s.activeSceneId, assetsForResolution, "scene"),
        activeProductIds: resolveAssetIds(s.activeProductIds ?? [], assetsForResolution, "product"),
        activePropIds: resolveAssetIds(s.activePropIds ?? [], assetsForResolution, "prop"),
        dialogues: (s.dialogues ?? []).map((d) => ({
          ...d,
          characterId: d.characterId ? resolveCharacterId(d.characterId) : null,
        })),
      }));

      store.setShotsByProjectId(targetProjectId, shots);

      if (newAssets.length > 0) {
        useProjectStore.getState().updateProjectById(targetProjectId, (p) => ({
          ...p,
          assets: [...p.assets, ...newAssets],
        }));
      }

      useProjectStore.getState().setProjectStatusById(targetProjectId, "idle");
    } catch (err) {
      useProjectStore.getState().updateProjectById(targetProjectId, (p) => ({
        ...p,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      }));
      throw err;
    }
  }, []);

  /** Re-roll a single shot's script. */
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
      const characterNames = project.assets
        .filter((a) => a.type === "character")
        .map((c) => c.name);
      const contextParts = [
        `Regenerate this shot: ${shot.scriptText}`,
        project.ideaPrompt?.trim() ? `Original idea: ${project.ideaPrompt.trim()}` : "",
        characterNames.length > 0 ? `Characters: ${characterNames.join(", ")}` : "",
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
        const existingCharacters = project.assets.filter((a) => a.type === "character");
        const idByName = new Map(
          existingCharacters.map((c) => [c.name.trim().toLocaleLowerCase(), c.id]),
        );
        const resolveCharacterId = (ref: string): string | null => {
          const matched = idByName.get(ref.trim().toLocaleLowerCase());
          if (matched) return matched;
          return existingCharacters.some((c) => c.id === ref) ? ref : null;
        };
        const resolveRerollAssetId = (ref: string | undefined, type: AssetType): string | undefined =>
          resolveAssetId(ref, project.assets, type);
        store.updateShotByProjectId(targetProjectId, shotId, {
          ...pickShotFields(newShot),
          activeSceneId: resolveRerollAssetId(newShot.activeSceneId, "scene"),
          activeProductIds: resolveAssetIds(newShot.activeProductIds ?? [], project.assets, "product"),
          activePropIds: resolveAssetIds(newShot.activePropIds ?? [], project.assets, "prop"),
          dialogues: (newShot.dialogues ?? []).map((d) => ({
            ...d,
            characterId: d.characterId ? resolveCharacterId(d.characterId) : null,
          })),
          activeCharacterIds: (newShot.activeCharacterIds ?? [])
            .map(resolveCharacterId)
            .filter((x): x is string => x !== null),
          status: "scripted",
          error: undefined,
        });
        restoreProjectStatusIfReady(
          targetProjectId,
          (p) => p.shots.every((s) => s.status !== "failed"),
        );
      }
    } catch (err) {
      store.setShotStatusByProjectId(
        targetProjectId,
        shotId,
        "failed",
        err instanceof Error ? err.message : String(err),
      );
    }
  }, []);

  return { extractCharactersFromIdea, generateStoryboard, rerollShot };
}
