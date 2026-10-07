import { useCallback } from "react";
import { confirmDialog } from "@/components/ui/ConfirmDialog";
import {
  useProjectStore,
  selectActiveProject,
  type Asset,
  type DialogueLine,
  type Shot,
  type VisualDirection,
} from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useT } from "@/i18n";
import {
  auditCharacterFidelity,
  auditVisualDirection,
  extractAssetsByType,
  extractStoryBriefFromIdea,
  extractVisualDirectionFromIdea,
  generateStoryboardOutline,
  generateStoryboardShot,
  reviseShotWithInstruction,
  type ExtractableAssetType,
  type RawShot,
  type RawVisualDirection,
} from "@/services/scriptService";
import { extractNewAssets } from "@/lib/extractAssets";
import { collectSubjectVocabulary } from "@/lib/promptComposer";
import { refineWithAudit } from "@/lib/refineContent";
import { beginTrace, logger } from "@/lib/logger";
import { hasActiveTask, stopActiveBatch } from "@/lib/batchRunner";
import { pickShotFields } from "@/lib/shotFields";
import { normalizeShotSize } from "@/lib/shotSize";
import { resolveAssetId, resolveAssetIds } from "@/lib/shotReferences";
import { restoreProjectStatusIfReady, resetStuckShots } from "./wizardActionUtils";

/** 视觉方向自检轮数上限（2026-09-15 由 2 → 1：审计+重写已合一，第 2 轮边际收益低于 ~40s 耗时）。 */
const VISUAL_DIRECTION_MAX_ROUNDS = 1;

/**
 * 分镜批量任务注册表（模块级共享，跨组件实例幂等守卫）。
 * 图片 / 视频 / 资产三个域都走 createBatchRunner 的注册表守卫，分镜此前缺失：
 * 向导 effect 在页面重载 / 多实例挂载时会重新触发，同一份大纲请求被并发发出（token 翻倍），
 * 且并发批次的镜头 id 不同，先完成的一批写回会因 id 不匹配而静默失效。
 */
const activeScriptTasks = new Map<string, AbortController>();

/** 查询某项目是否仍有存活的分镜任务（供向导 effect 判断，避免重复启动） */
export function hasActiveScriptTask(projectId: string): boolean {
  return hasActiveTask(activeScriptTasks, projectId);
}

/**
 * 停止某项目的分镜批量生成（P3 修复：此前无任何用户可见的停止入口）。
 * 语义与 batchRunner.stopActiveBatch 一致：只拦止【尚未发起】的逐镜请求，
 * 正在飞行中的那一镜会正常完成写回（对话请求虽非计费红线，但掐断只会得到半成品）。
 * 停止后剩余占位镜头复位为 idle，已完成镜头保留，用户可在确认覆盖弹窗后手动续生成。
 */
export function stopScriptBatch(projectId: string): boolean {
  return stopActiveBatch(activeScriptTasks, projectId);
}

/**
 * 想法提取任务注册表（模块级共享，跨组件实例幂等守卫）。
 * StepIdea 的加载态是组件本地 state，切到步骤 2 即卸载；返回步骤 1 重新挂载后
 * 「AI 提取」按钮又可点，同一项目会并发跑两轮提取：两轮各自清空旧资产，并按**各自启动时
 * 的 assets 快照**追加写回，模型对同一故事命名不稳定 → 同类资产重复入库，
 * 并连带把资产图请求也翻倍（实测一次误操作产生 13 个资产 / 12 次生图）。
 */
const activeIdeaTasks = new Map<string, AbortController>();

/** 查询某项目是否仍有存活的想法提取任务（供步骤 1 门禁与刷新恢复判断） */
export function hasActiveIdeaTask(projectId: string): boolean {
  return hasActiveTask(activeIdeaTasks, projectId);
}

/**
 * 模型返回的镜头 → store 写回载荷。
 * 引用解析（名称/ID → 真实资产 ID）与对白实体 ID 生成集中在此，唯一权威实现：
 * 首次生成 / 单镜头重摇 / 指令改写三处共用。引用未命中只降级为空，绝不抛错
 * （2026-09-16 事故：activeSceneId 被模型写成数组时，旧实现整镜头写回中断、内容全丢）。
 */
function buildShotUpdate(raw: RawShot, assets: Asset[]): Partial<Shot> {
  const resolvedDialogues: DialogueLine[] = (Array.isArray(raw.dialogues) ? raw.dialogues : []).map(
    (line) => ({
      id: `dlg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      characterId: resolveAssetId(line.characterId, assets, "character") ?? null,
      text: line.text ?? "",
      delivery: line.delivery,
    }),
  );
  const activeCharacterIds = resolveAssetIds(raw.activeCharacterIds, assets, "character");
  const activeSceneId = resolveAssetId(raw.activeSceneId, assets, "scene");
  const activeProductIds = resolveAssetIds(raw.activeProductIds, assets, "product");
  const activePropIds = resolveAssetIds(raw.activePropIds, assets, "prop");

  return {
    ...pickShotFields({
      ...raw,
      // RawShot.shotSize 是模型原文（任意 string），写回前必须收口为机读枚举
      shotSize: normalizeShotSize(raw.shotSize),
      dialogues: resolvedDialogues,
      activeCharacterIds,
      activeProductIds,
      activePropIds,
      activeSceneId,
      useDualFrame: raw.useDualFrame ?? false,
    }),
    activeCharacterIds,
    activeSceneId,
    activeProductIds,
    activePropIds,
    dialogues: resolvedDialogues,
  };
}

export interface ScriptActions {
  extractCharactersFromIdea: (prompt: string) => Promise<boolean>;
  /**
   * 生成全部分镜。onProgress 在每个镜头写回后触发（completed 从 1 起），
   * 供调用方在「首个镜头就绪」时切页，避免用户进页面先看一屏转圈。
   */
  generateStoryboard: (
    prompt: string,
    options?: { onProgress?: (completed: number, total: number) => void },
  ) => Promise<void>;
  rerollShot: (shotId: string) => Promise<void>;
  /** 指令改写：把用户的一句话要求交给模型重写该镜头（详情页唯一修改入口）。返回是否成功。 */
  reviseShot: (shotId: string, instruction: string) => Promise<boolean>;
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

  /**
   * Step 1→2: Extract characters from idea, advance to assets step.
   * 返回 false 表示用户在确认弹窗中取消了重新提取。
   *
   * 两链并行 + 资产分类型提取（2026-09-15）：
   * - 链 A：视觉方向（提取 → 自检 → 写回），完成即切步骤 2（渐进解锁）
   * - 链 B：资产按类型并行提取（5 路小请求），每类完成即写回（卡片逐类蹦出）
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
      // 角色带上现有物种/品种：让"主体会被重新判断"在按下确认前就看得见
      const describeAsset = (a: Asset) =>
        a.details?.kind === "character" && a.details.species ? `${a.name}（${a.details.species}）` : a.name;
      const ok = await confirmDialog({
        title: t("wizard.reextractTitle"),
        message: t("wizard.reextractMessage", {
          auto: autoAssets.length,
          manual: manualAssets.length,
          names: autoAssets.map(describeAsset).join("、"),
        }),
      });
      if (!ok) return false;
    }

    // 幂等守卫：同一项目已有提取在飞时不再启动第二轮（守卫与注册之间不得有 await）。
    // 在飞期间重复触发的语义是"结果稍后会写回"，故返回 true 而非 false（false 专指用户取消）。
    if (hasActiveTask(activeIdeaTasks, targetProjectId)) return true;
    activeIdeaTasks.set(targetProjectId, new AbortController());

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
      // 完成即写回并切到步骤 2：用户可立即查看/编辑视觉方向，资产卡片随后逐类出现。
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
          wizardStep: 2,
        }));
        return visualDirection;
      })();

      // 链 B：故事骨架（主题/情绪/节奏/一致性约束）。
      // 与链 A、链 C 并行发出，完成即写回，不切步骤（切页由链 A 负责）。
      // 失败只记警告不拖垮整体：故事层缺失时下游按未设定降级，仍可出分镜。
      const storyTask = (async () => {
        try {
          const raw = await extractStoryBriefFromIdea(baseOpts);
          useProjectStore.getState().updateProjectById(targetProjectId, (p) => ({
            ...p,
            storyBrief: {
              ...raw,
              revision: (p.storyBrief?.revision ?? 0) + 1,
            },
          }));
          return raw;
        } catch (err) {
          logger.warn("llm", "logmsg.storyBriefFailed", { error: String(err) });
          return null;
        }
      })();

      // 链 C：资产按类型并行提取（4 路小请求）。风格由视觉方向链唯一负责；
      // 单类完成即写回，单类失败不拖垮整体，全部失败才算失败。
      const assetsTask = (async () => {        const types: ExtractableAssetType[] = ["character", "scene", "product", "prop"];
        let added = 0;
        const failures: Array<{ type: ExtractableAssetType; error: unknown }> = [];

        await Promise.all(types.map(async (type) => {
          try {
            const result = await extractAssetsByType(baseOpts, type);
            let list =
              type === "character" ? result.characters
              : type === "scene" ? result.scenes
              : type === "product" ? result.products
              : result.props;
            // 角色主体忠实自检（写回前）：想法原文写明的品种被换成同类其它品种时按名字改回。
            // 只审角色 —— 主体身份只存在于角色设定，场景/产品/道具不存在"换品种"。
            if (type === "character") {
              const audited = await auditCharacterFidelity({
                apiKey: providerConfig.apiKey,
                baseUrl: providerConfig.baseUrl,
                language: project.language,
                idea: prompt,
                characters: result.characters,
              });
              if (!audited.clean) {
                const fixed = result.characters
                  .filter((c, i) => audited.value[i] !== c)
                  .map((c) => c.name);
                logger.info("llm", "logmsg.characterFidelityFixed", { fixed: fixed.join("、") });
              }
              list = audited.value;
            }
            const built = extractNewAssets(project.assets, list as never, type, manualAssets).assets;
            const manualNames = new Set(manualAssets.map((a) => a.name.trim().toLocaleLowerCase()));
            const deduped = built.filter(
              (a) => !manualNames.has(a.name.trim().toLocaleLowerCase()),
            );
            if (deduped.length === 0) return;
            added += deduped.length;
            useProjectStore.getState().updateProjectById(targetProjectId, (p) => ({
              ...p,
              assets: [...p.assets, ...deduped],
            }));
          } catch (err) {
            failures.push({ type, error: err });
          }
        }));

        if (added === 0 && failures.length > 0) {
          const first = failures[0]!.error;
          throw first instanceof Error ? first : new Error(String(first));
        }
        return added;
      })();

      // 三链并行；任一失败保留其余链已写回的内容并按失败收尾（用户重试走原确认弹窗）
      const [directionOutcome, , assetsOutcome] = await Promise.allSettled([
        directionTask,
        storyTask,
        assetsTask,
      ]);
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

      // 两链都完成才复位：scripting 覆盖整个提取期，同时是步骤 1 「AI 提取」与「下一步」的门禁信号
      useProjectStore.getState().setProjectStatusById(targetProjectId, "idle");

      // 生图时机（2026-10-07）：
      // - 全自动：提取完立刻在后台烧生图，保持原有零干预节奏。
      // - 半自动：**等用户校对完资产再生成** —— 资产设定是生图提示词的唯一来源，
      //   用户改完物种/外观后立刻出图会白烧一轮配额（免费档生图按 size tier 计费）。
      //   用户可在步骤 2 用「补全缺失」按钮随时手动触发，不依赖自动。
      const latest = useProjectStore.getState().projects.find((p) => p.id === targetProjectId);
      const autoGenerate = (latest?.automationMode ?? "semi-auto") === "auto";
      if (autoGenerate) {
        void (async () => {
          await generateStyleReference(targetProjectId);
          await generateAssetImages(undefined, targetProjectId);
        })();
      } else {
        logger.info("llm", "logmsg.assetImagesDeferred", {
          reason: "semi-auto: waiting for assetsReviewed",
        });
      }
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
    } finally {
      activeIdeaTasks.delete(targetProjectId);
    }
  }, [generateAssetImages, generateStyleReference, t]);

  /**
   * Step 3: Generate storyboard shots — 两阶段（大纲 → 逐镜头并发）。
   * 阶段 1 产出镜头计划；阶段 2 并发逐镜头生成，单个完成即写回（卡片逐个亮起），
   * 单镜头失败只标记该镜头（可用单镜头重摇恢复），不拖垮整组。
   */
  const generateStoryboard = useCallback(async (
    prompt: string,
    options?: { onProgress?: (completed: number, total: number) => void },
  ) => {
    const { providerConfig } = useSettingsStore.getState();
    if (!providerConfig.apiKey || !providerConfig.baseUrl) {
      throw new Error("API key is not configured.");
    }

    const store = useProjectStore.getState();
    const project = selectActiveProject(store);
    if (!project) throw new Error("No active project.");
    const targetProjectId = project.id;

    // 幂等守卫：同一项目已有分镜任务在飞时不重复启动（防 effect 重入 / 重挂载导致的重复请求）
    if (hasActiveTask(activeScriptTasks, targetProjectId)) return;

    // 中断恢复：上一轮遗留的 scripting 占位（流程被打断）先复位，再开始新一轮
    resetStuckShots(targetProjectId);

    const batchController = new AbortController();
    activeScriptTasks.set(targetProjectId, batchController);
    store.setProjectStatusById(targetProjectId, "scripting");

    try {
      // 阶段 1：大纲（轻量请求）
      const outline = await generateStoryboardOutline({
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        prompt,
        language: project.language,
        aspectRatio: project.aspectRatio,
        assets: project.assets,
        storyBrief: project.storyBrief,
      });
      // 用户若在大纲请求期间停止，保留原有资产与镜头，不再创建占位或发起逐镜请求。
      if (batchController.signal.aborted) {
        useProjectStore.getState().setProjectStatusById(targetProjectId, "idle");
        return;
      }

      // 大纲阶段发现的新资产先补建入库（逐镜头请求的上下文需要它们的设定）
      const currentAssets = useProjectStore.getState().projects.find((p) => p.id === targetProjectId)?.assets ?? [];
      const manualNow = currentAssets.filter((a) => a.source === "manual");
      const builtChars = extractNewAssets(currentAssets, outline.newCharacters, "character", manualNow).assets;
      const builtScenes = extractNewAssets(currentAssets, outline.newScenes, "scene", manualNow).assets;
      const newAssets = [...builtChars, ...builtScenes];
      if (newAssets.length > 0) {
        useProjectStore.getState().updateProjectById(targetProjectId, (p) => ({
          ...p,
          assets: [...p.assets, ...newAssets],
        }));
      }

      // 阶段 2 准备：写入占位镜头（status scripting）——卡片立刻全部出现并显示生成中
      const assetsForShots = useProjectStore.getState().projects.find((p) => p.id === targetProjectId)?.assets ?? [];
      const outlineJson = JSON.stringify(outline.shots);
      const placeholderShots: Shot[] = outline.shots.map((_, i) => ({
        id: `shot_${Date.now()}_${i}`,
        index: i,
        status: "scripting" as const,
        scriptText: "",
        visualPrompt: "",
        motionPrompt: "",
        dialogues: [],
        activeCharacterIds: [],
        activeProductIds: [],
        activePropIds: [],
        duration: 5,
        useDualFrame: false,
      }));
      useProjectStore.getState().setShotsByProjectId(targetProjectId, placeholderShots);

      // 阶段 2：滑动窗口并发（2026-10-07 由全串行改来）。
      // 约束来自 storyboard.handoff-previous：相邻镜头必须看到上一镜的实际产出，
      // 全并发下同批的镜头互相看不见、承接彻底失效。
      // 解法：**按序分批**，批内并发（本批每镜都能看到本批之前所有已完成的镜），
      // 批间串行（前一批全部写回后才发下一批）—— 承接语义完整保留，
      // 耗时从 N × 单镜降到 ⌈N / 窗口⌉ × 单镜。
      // 单个镜头失败只标记该镜头并继续，不中断整批。
      const CONCURRENCY = 3;
      let completed = 0;
      const reportProgress = () => {
        completed += 1;
        try {
          options?.onProgress?.(completed, placeholderShots.length);
        } catch {
          // 进度回调仅用于界面提示，忽略其异常
        }
      };

      for (let start = 0; start < outline.shots.length; start += CONCURRENCY) {
        // 停止检查放在每批发起前：进行中的镜头正常收尾，剩余镜头不再发请求
        if (batchController.signal.aborted) break;
        const batch = outline.shots.slice(start, start + CONCURRENCY);
        await Promise.all(
          batch.map(async (item, offset) => {
            const i = start + offset;
            const shot = placeholderShots[i];
            // 每次重新读 store：本批之前已写回的镜头内容必须在本次请求里可见
            const latestProject = useProjectStore.getState().projects.find((p) => p.id === targetProjectId);
            const prev = i > 0 ? latestProject?.shots[i - 1] : undefined;
            try {
              const raw = await generateStoryboardShot({
                apiKey: providerConfig.apiKey,
                baseUrl: providerConfig.baseUrl,
                prompt,
                language: project.language,
                aspectRatio: project.aspectRatio,
                assets: assetsForShots,
                storyBrief: project.storyBrief,
                outline: outlineJson,
                item,
                index: i,
                total: placeholderShots.length,
                previousShot: prev
                  ? {
                      scriptText: prev.scriptText,
                      visualPrompt: prev.visualPrompt,
                      shotSize: prev.shotSize,
                    }
                  : undefined,
              });
              // 名字/引用 → 资产 ID 解析（用最新 assets，含大纲补建的新资产）。
              // 引用未命中只降级为空，不得阻断已成功生成的镜头内容写回。
              const latestAssets = useProjectStore.getState().projects.find((p) => p.id === targetProjectId)?.assets ?? [];
              useProjectStore.getState().updateShotByProjectId(targetProjectId, shot.id, {
                ...buildShotUpdate(raw, latestAssets),
                status: "scripted" as const,
              });
            } catch (err) {
              useProjectStore.getState().updateShotByProjectId(targetProjectId, shot.id, {
                status: "failed",
                error: err instanceof Error ? err.message : String(err),
              });
            } finally {
              // 进度回调异常绝不允许污染镜头结果（会连带整批分镜失败）
              reportProgress();
            }
          }),
        );
      }

      // 被用户停止：剩余从未发起的占位镜头复位为 idle（否则永久停在"生成中"），
      // 已完成镜头保留；项目回 idle，用户可稍后手动重新生成。
      if (batchController.signal.aborted) {
        resetStuckShots(targetProjectId);
      }
      useProjectStore.getState().setProjectStatusById(targetProjectId, "idle");
    } catch (err) {
      // 清理本轮已写入的占位：留 scripting 会让卡片永久停在"生成中"，刷新也不会恢复
      resetStuckShots(targetProjectId);
      useProjectStore.getState().updateProjectById(targetProjectId, (p) => ({
        ...p,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      }));
      throw err;
    } finally {
      activeScriptTasks.delete(targetProjectId);
    }
  }, []);

  /** Re-roll a single shot's script（单镜头重摇 = 阶段 2 的单请求） */
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
      const item = {
        title: shot.scriptText.trim().slice(0, 60) || `Shot ${shot.index + 1}`,
        summary: shot.scriptText.trim() || "Regenerate this shot with a fresh take.",
        characterNames,
        sceneName: undefined,
      };
      const raw = await generateStoryboardShot({
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        prompt: project.ideaPrompt?.trim() || shot.scriptText.trim(),
        language: project.language,
        aspectRatio: project.aspectRatio,
        assets: project.assets,
        outline: "",
        item,
        index: shot.index,
        total: Math.max(project.shots.length, 1),
        variationOf: { scriptText: shot.scriptText, visualPrompt: shot.visualPrompt },
      });

      useProjectStore.getState().updateShotByProjectId(targetProjectId, shotId, {
        ...buildShotUpdate(raw, project.assets),
        status: "scripted",
        error: undefined,
      });
      restoreProjectStatusIfReady(
        targetProjectId,
        (p) => p.shots.every((s) => s.status !== "failed"),
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

  /**
   * 指令改写单个镜头（详情页唯一的修改入口）。
   * 与 rerollShot 的差别：带上用户的一句话要求，模型只应用被点名的变化，
   * 未提及的字段保持原样；同一时刻只允许一个镜头处于 scripting（按钮禁用由 UI 保证）。
   */
  const reviseShot = useCallback(async (shotId: string, instruction: string): Promise<boolean> => {
    const { providerConfig } = useSettingsStore.getState();
    if (!providerConfig.apiKey || !providerConfig.baseUrl) return false;

    const store = useProjectStore.getState();
    const project = selectActiveProject(store);
    if (!project) return false;
    const targetProjectId = project.id;

    const exists = project.shots.some((s) => s.id === shotId);
    if (!exists) return false;

    store.setShotStatusByProjectId(targetProjectId, shotId, "scripting");

    try {
      // 用最新 store 快照：等待期间大纲可能补建了新资产，引用解析必须用最新资产表
      const fresh = useProjectStore.getState().projects.find((p) => p.id === targetProjectId);
      const freshShot = fresh?.shots.find((s) => s.id === shotId);
      if (!freshShot) {
        restoreProjectStatusIfReady(targetProjectId, (p) => p.shots.every((s) => s.status !== "failed"));
        return false;
      }

      const raw = await reviseShotWithInstruction({
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        language: project.language,
        aspectRatio: project.aspectRatio,
        assets: fresh?.assets,
        shot: freshShot,
        instruction,
      });

      useProjectStore.getState().updateShotByProjectId(targetProjectId, shotId, {
        ...buildShotUpdate(raw, fresh?.assets ?? []),
        status: "scripted",
        error: undefined,
      });
      restoreProjectStatusIfReady(
        targetProjectId,
        (p) => p.shots.every((s) => s.status !== "failed"),
      );
      return true;
    } catch (err) {
      store.setShotStatusByProjectId(
        targetProjectId,
        shotId,
        "failed",
        err instanceof Error ? err.message : String(err),
      );
      return false;
    }
  }, []);

  return { extractCharactersFromIdea, generateStoryboard, rerollShot, reviseShot };
}
