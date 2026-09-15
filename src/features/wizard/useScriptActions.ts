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

/** 视觉方向自检轮数上限（效果优先，允许重复调用大模型收敛）。 */
const VISUAL_DIRECTION_MAX_ROUNDS = 2;

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

    useProjectStore.getState().setProjectStatusById(targetProjectId, "scripting");

    const trace = beginTrace("logmsg.trace.extractFromIdea", { projectId: targetProjectId });

    try {
      const visualDirectionResult = await refineWithAudit<RawVisualDirection>({
        produce: () =>
          extractVisualDirectionFromIdea({
            apiKey: providerConfig.apiKey,
            baseUrl: providerConfig.baseUrl,
            prompt,
            language: project.language,
            aspectRatio: project.aspectRatio,
            assets: project.assets,
          }),
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
        name: visualDirectionResult.name,
        description: visualDirectionResult.description,
        details: visualDirectionResult.details,
        revision: (project.visualDirection?.revision ?? 0) + 1,
        status: "draft" as const,
      };
      useProjectStore.getState().updateProjectById(targetProjectId, (p) => ({ ...p, visualDirection }));

      const result = await extractAssetsFromIdea({
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        prompt,
        language: project.language,
        aspectRatio: project.aspectRatio,
        assets: project.assets,
      }, visualDirectionResult);

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

      useProjectStore.getState().updateProjectById(targetProjectId, (p) => ({
        ...p,
        assets: [...manualAssets, ...dedupedNew],
        visualDirection,
        status: "idle",
        error: undefined,
        wizardStep: 2,
        styleReferenceUrl: undefined,
        styleReferenceError: undefined,
        assetsReviewed: false,
      }));

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
