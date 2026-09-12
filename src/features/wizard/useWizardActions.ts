// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/useWizardActions.ts
// Wizard operation hooks: generate, re-roll, advance steps.
// ────────────────────────────────────────────────────────────────────────────

import { useCallback } from "react";
import { useProjectStore, selectActiveProject, newId, type Shot, type Asset, type Project } from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useT } from "@/i18n";
import { confirmDialog } from "@/components/ui/ConfirmDialog";
import { resolvePlan, type PlanId } from "@/lib/plans";
import { generateScript, extractAssetsFromIdea } from "@/services/scriptService";
import { generateImage, aspectRatioToImageParams } from "@/services/imageService";
import { generateVideo, aspectRatioToVideoAspect, VideoTaskCreatedError } from "@/services/videoService";
import { injectCharacterDescriptions } from "@/lib/characterUtils";
import { composeVisualPrompt, composeMotionPrompt } from "@/lib/promptUtils";
import {
  composeTextToImagePrompt,
  composeImageToImagePrompt,
  composeMultiReferencePrompt,
  composePortraitPrompt,
  pickShotReferences,
  getStyleReferenceUrl,
  getStylePrompt,
  type ReferenceRole,
} from "@/lib/promptComposer";
import { buildSystemPrompt as buildRulesSystemPrompt, getActiveRules } from "@/lib/promptRules";
import { createAIService } from "@/services/ai/factory";

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

/** 模型提取的资产原始格式（style 仅 name+description，无 appearancePrompt） */
import { extractNewAssets } from "@/lib/extractAssets";

type ImageGenerationInput = {
  prompt: string;
  /** 参考图 URL 列表（多图合成；空数组 = 纯文生图） */
  referenceImageUrls: string[];
};

/**
 * 去重语义见 lib/extractAssets.ts 顶部说明：
 * 追加式传全部旧资产；替换式（重新提取）只传 manual 资产。
 */
export { extractNewAssets } from "@/lib/extractAssets";

/** 按 URL 反查资产，返回其在多图合成中的角色语义（未命中视为风格参考） */
function describeReferenceRole(
  url: string,
  project: { assets: Asset[] },
): ReferenceRole {
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
 *   （subject 复用 injectCharacterDescriptions(composeVisualPrompt(...))，产品主体前置）
 */
function buildImageGenerationInput(
  shot: Shot,
  project: { style: string; assets: Asset[]; styleReferenceUrl?: string },
): ImageGenerationInput {
  const referenceImageUrls = pickShotReferences(shot, project);

  // 主体：完整 visualPrompt + 角色外貌注入 + 产品主体前置（保持主体一致性）
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

/** 派生失败兜底：project.style 非空 → style reference 模板；否则 cinematic 模板 */
function fallbackStylePrompt(style: string): string {
  return style
    ? `${style} style reference, cohesive visual aesthetic, color palette, mood board`
    : "Cinematic style reference, cohesive visual aesthetic, warm tones, professional photography";
}

/**
 * L2 派生：从想法文本 + 中文风格描述派生英文 stylePrompt（画种/色调/光照/氛围）。
 * 硬性禁止角色/生物/人物（STYLE_DERIVE_SYSTEM_PROMPT）。
 * 派生失败（网络/内容过滤/空输出）走兜底链，不抛错——风格图生成不能因此阻塞。
 */
async function deriveStylePrompt(
  ideaPrompt: string,
  styleDescription: string,
  apiKey: string,
  baseUrl: string,
): Promise<string> {
  const idea = ideaPrompt.trim();
  const zhStyle = styleDescription.trim();
  if (idea || zhStyle) {
    try {
      const service = createAIService({ provider: "openai", apiKey, baseUrl });
      const userContent = [
        idea ? `Story idea: ${idea.slice(0, 600)}` : "",
        zhStyle ? `Desired style (Chinese): ${zhStyle}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      // 系统提示词走规则注册表（styleref.no-characters 条目 + 用户覆盖）
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
  // 兜底链：中文风格描述非空 → `${style} style reference...`；否则 cinematic 模板
  return fallbackStylePrompt(zhStyle);
}

export function useWizardActions() {
  const t = useT();

  /**
   * 生成风格参考图（项目级风格锚点）。
   * 幂等：已有风格图（force=true 除外）、或该项目已有资产生成任务在跑
   * （activeAssetTasks 互斥）时直接跳过。
   *
   * B 方案：风格提示词改为 style 资产的 prompt（L2 派生物）。
   * ensureStyleAsset：style 资产缺失、或 prompt 为空且未锁定时，从
   * ideaPrompt + 中文风格描述派生英文 stylePrompt（画种/色调/光照/氛围，
   * 硬性禁止角色/生物/人物），按项目 ID 写回 style 资产（updateAssetByProjectId）。
   * 派生失败兜底链：project.style 非空 → `${style} style reference...`；否则 cinematic 模板。
   * 派生调用在注册表 set 之后（幂等铁律：不与后续生成并行重入）。
   * 角色/场景/产品与分镜图都以此为风格参考。
   */
  const generateStyleReference = useCallback(async (targetProjectId?: string, force = false) => {
    const { providerConfig } = useSettingsStore.getState();
    if (!providerConfig.apiKey || !providerConfig.baseUrl) return;

    const store = useProjectStore.getState();
    const project = targetProjectId
      ? store.projects.find((p) => p.id === targetProjectId)
      : selectActiveProject(store);
    if (!project) return;
    const pid = project.id;

    // 幂等：已有风格图（style 资产或旧字段）时跳过（force 用于重新生成）
    if (getStyleReferenceUrl(project) && !force) return;

    // 与资产生成共用注册表互斥：风格图不与资产图并行（资产图要参考风格图）
    if (activeAssetTasks.has(pid)) return;

    const controller = new AbortController();
    activeAssetTasks.set(pid, controller);

    try {
      // ── ensureStyleAsset：style 资产缺失时创建（不进 migrate，运行期懒派生） ──
      const latest = useProjectStore.getState().projects.find((p) => p.id === pid) ?? project;
      let styleAsset = latest.assets.find((a) => a.type === "style");
      if (!styleAsset) {
        const created: Asset = {
          id: newId("asset"),
          type: "style",
          source: "extracted",
          name: latest.language === "en" ? "Overall style" : "整体风格",
          description: latest.style.trim(),
          prompt: "",
        };
        useProjectStore.getState().updateProjectById(pid, (p) => ({
          ...p,
          assets: [...p.assets, created],
        }));
        styleAsset = created;
      }

      // ── L2 派生：prompt 为空且未锁定时，从 ideaPrompt + 中文风格描述派生 ──
      if (!styleAsset.prompt.trim() && !styleAsset.derivation?.locked) {
        const derived = await deriveStylePrompt(
          latest.ideaPrompt ?? "",
          styleAsset.description.trim() || latest.style.trim(),
          providerConfig.apiKey,
          providerConfig.baseUrl,
        );
        // 按项目 ID 写回（铁律：异步结果禁止写 active-project 版本）
        useProjectStore.getState().updateAssetByProjectId(pid, styleAsset.id, {
          prompt: derived,
        });
        styleAsset = { ...styleAsset, prompt: derived };
      }

      const stylePrompt =
        styleAsset.prompt.trim() || fallbackStylePrompt(latest.style.trim());

      const imagePrompt =
        `${stylePrompt}. Visual style reference / mood board, cohesive composition, ` +
        `no text, no watermark, no character in focus.`;
      const { size, ratio } = aspectRatioToImageParams(latest.aspectRatio);

      const url = await generateImage({
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        prompt: imagePrompt,
        size,
        ratio,
      });
      // 同时写项目旧字段（兼容旧 UI/旧数据）与 style 资产 imageUrl（新参考链事实源）
      useProjectStore.getState().updateProjectById(pid, (p) => ({
        ...p,
        styleReferenceUrl: url,
        styleReferenceError: undefined,
      }));
      useProjectStore.getState().updateAssetByProjectId(pid, styleAsset.id, {
        imageUrl: url,
        error: undefined,
      });
      useProjectStore.getState().addHistory("style_generated", "生成风格参考图", pid);
    } catch (err) {
      // 失败写入 styleReferenceError，资产页会就地展示；不阻塞后续资产生成
      useProjectStore.getState().updateProjectById(pid, (p) => ({
        ...p,
        styleReferenceError: err instanceof Error ? err.message : String(err),
      }));
      console.error("Failed to generate style reference:", err);
    } finally {
      activeAssetTasks.delete(pid);
    }
  }, []);

  /**
   * Step 1→2: Extract characters from idea, advance to assets step.
   * 返回 false 表示用户在确认弹窗中取消了重新提取。
   *
   * 防重复（2026-09-12）：模型对同一故事的命名不稳定（「小兔子」/「小白兔」），
   * 旧的纯追加式只按名字精确去重，改几次想法就会积累重复资产。
   * 现改为「替换式」：带 source="extracted" 的旧资产被新提取结果整体取代，
   * 手动添加的（source="manual"）保留，与新结果重名时以手动版本为准。
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

    // ── 防重复：已有自动提取资产时，先确认「替换式」重新提取 ──
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

    store.setProjectStatus("scripting");

    try {
      // 轻量提取：只返回角色/产品/场景资产，不生成分镜（避免完整分镜生成的 token 浪费）
      const result = await extractAssetsFromIdea({
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        prompt,
        language: project.language,
        aspectRatio: project.aspectRatio,
        assets: project.assets,
      });

      // 统一提取角色/产品/场景/风格资产。
      // ⚠️ 去重基准 = manualAssets（而非全部旧资产）：替换式写回会清掉全部旧
      // extracted 资产，若旧 extracted 同名角色参与去重，同名新资产会被误跳过，
      // 随后旧角色被清 → 角色凭空消失（2026-09-12 实测事故，两次复现）。
      // 仅 manual 资产需要重名保护（保留用户手工创建/润色的版本）。
      const newCharacters = extractNewAssets(project.assets, result.characters, "character", manualAssets);
      const newProducts = extractNewAssets(project.assets, result.products, "product", manualAssets);
      const newScenes = extractNewAssets(project.assets, result.scenes, "scene", manualAssets);
      const newStyles = extractNewAssets(project.assets, result.styles, "style", manualAssets);
      const newAssets = [
        ...newCharacters.assets,
        ...newProducts.assets,
        ...newScenes.assets,
        ...newStyles.assets,
      ];

      // 替换式写回：手动添加的资产保留在前；新提取项与手动资产重名时跳过
      // （保留手动版本，避免把用户精心润色过的资产冲掉）
      const manualNames = new Set(manualAssets.map((a) => a.name.trim().toLocaleLowerCase()));
      const dedupedNew = newAssets.filter(
        (a) => !manualNames.has(a.name.trim().toLocaleLowerCase()),
      );

      // 原子地写回发起项目：替换式资产 + 复位状态 + 推进到资产步骤
      useProjectStore.getState().updateProjectById(targetProjectId, (p) => ({
        ...p,
        assets: [...manualAssets, ...dedupedNew],
        status: "idle",
        error: undefined,
        wizardStep: 2,
      }));

      // 全自动资产生成（后台执行，不阻塞进入资产步骤）：
      // 先生成风格参考图（generateAssetImages 阶段 1 也会幂等兜底），
      // 随后自动生成角色定妆照 / 场景 / 产品图——全部参考风格图。
      // semi-auto 模式的确认点是「资产就绪 → 进入分镜」，步骤内自动完成不违背其语义；
      // 部分资产失败会在资产页就地显示重试入口。
      void (async () => {
        await generateStyleReference(targetProjectId);
        await generateAssetImages(undefined, targetProjectId);
      })();
      return true;
    } catch (err) {
      // 失败时将发起项目复位为 failed，避免其状态永远停留在 scripting
      useProjectStore.getState().updateProjectById(targetProjectId, (p) => ({
        ...p,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      }));
      throw err;
    }
  }, [generateStyleReference, t]);

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

      // Auto-add any newly extracted characters, products, scenes and style
      const newProducts = extractNewAssets(project.assets, result.products, "product").assets;
      const newScenes = extractNewAssets(project.assets, result.scenes, "scene").assets;
      const newStyles = extractNewAssets(project.assets, result.styles, "style").assets;
      const newAssets = [...newCharacters, ...newProducts, ...newScenes, ...newStyles];
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
        // 对白/角色引用回填：模型可能返回自编角色 ID，先按已有角色名映射，
        // 匹配不到的置 null（归旁白）或移除，避免重roll后对白与脚本脱节
        const existingCharacters = project.assets.filter((a) => a.type === "character");
        const idByName = new Map(
          existingCharacters.map((c) => [c.name.trim().toLocaleLowerCase(), c.id]),
        );
        const resolveCharacterId = (ref: string): string | null => {
          const matched = idByName.get(ref.trim().toLocaleLowerCase());
          if (matched) return matched;
          return existingCharacters.some((c) => c.id === ref) ? ref : null;
        };
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
  }, projectIdOverride?: string) => {
    const { providerConfig } = useSettingsStore.getState();
    if (!providerConfig.apiKey || !providerConfig.baseUrl) return;

    const store = useProjectStore.getState();
    // 支持指定项目：想法步骤自动触发时写回发起项目，防用户中途切换/新建项目导致串写
    const project = projectIdOverride
      ? store.projects.find((p) => p.id === projectIdOverride)
      : selectActiveProject(store);
    if (!project) return;
    const targetProjectId = project.id;

    // 幂等守卫：同一项目已有资产生成任务在跑时不重复启动
    if (activeAssetTasks.has(targetProjectId)) return;

    const { size: imageSize, ratio: imageRatio } = aspectRatioToImageParams(project.aspectRatio);
    const generatePortraits = opts?.generatePortraits !== false;
    const generateScenes = opts?.generateScenes !== false;
    const generateProducts = opts?.generateProducts !== false;
    const generateStyle = opts?.generateStyle !== false;

    // ── 阶段 1：风格参考图先行 ──
    // 角色/场景/产品定妆照都要参考风格图（否则动画故事会生成写实照片），
    // 必须等它就绪再生成资产图；风格图失败不阻塞（资产图退化为纯文生图，
    // 错误已写入 styleReferenceError 在资产页展示）。
    if (generateStyle && !getStyleReferenceUrl(project)) {
      await generateStyleReference(targetProjectId);
    }
    const latestProject = useProjectStore.getState().projects.find((p) => p.id === targetProjectId);
    const styleReferenceUrl = latestProject ? getStyleReferenceUrl(latestProject) : undefined;
    const stylePrompt = latestProject ? getStylePrompt(latestProject) : undefined;
    // 风格指令：参考图只用于画风/色调/光照，主体与构图仍以文本描述为准
    const styleInstruction = styleReferenceUrl
      ? "Match the art style, color palette and lighting mood of the reference image; do not copy its content or composition. "
      : "";

    const tasks: Array<() => Promise<void>> = [];

    // Character portrait tasks（角色定妆照：物种锁定 + 全身设定，禁止半身像模板）
    if (generatePortraits) {
      for (const char of project.assets.filter((a) => a.type === "character")) {
        if (char.imageUrl) continue; // skip already generated
        tasks.push(async () => {
          if (signal?.aborted) return;
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

    // Scene reference tasks（场景参考图：图生图结构，keep = 场景描述原样）
    if (generateScenes) {
      for (const scene of project.assets.filter((a) => a.type === "scene")) {
        if (scene.imageUrl) continue; // skip already generated
        tasks.push(async () => {
          if (signal?.aborted) return;
          try {
            const url = await generateImage({
              apiKey: providerConfig.apiKey,
              baseUrl: providerConfig.baseUrl,
              prompt: composeImageToImagePrompt({
                change: styleInstruction
                  ? `${styleInstruction.trim()} Render the scene below as a clean environment reference image`
                  : "Render the scene below as a clean environment reference image",
                newStyle: stylePrompt,
                keep: scene.prompt,
              }),
              size: imageSize,
              ratio: imageRatio,
              ...(styleReferenceUrl ? { referenceImageUrls: [styleReferenceUrl] } : {}),
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

    // Product reference tasks（产品参考图：图生图结构，keep = 产品描述原样）
    if (generateProducts) {
      for (const product of project.assets.filter((a) => a.type === "product")) {
        if (product.imageUrl) continue; // skip already generated
        tasks.push(async () => {
          if (signal?.aborted) return;
          try {
            const url = await generateImage({
              apiKey: providerConfig.apiKey,
              baseUrl: providerConfig.baseUrl,
              prompt: composeImageToImagePrompt({
                change: styleInstruction
                  ? `${styleInstruction.trim()} Render the product below as a clean product reference image`
                  : "Render the product below as a clean product reference image",
                newStyle: stylePrompt,
                keep: product.prompt,
              }),
              size: imageSize,
              ratio: imageRatio,
              ...(styleReferenceUrl ? { referenceImageUrls: [styleReferenceUrl] } : {}),
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
  }, [generateStyleReference]);

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
    const { size: imageSize, ratio: imageRatio } = aspectRatioToImageParams(
      latestProject?.aspectRatio ?? project.aspectRatio,
    );

    // Generate images with concurrency 3
    const tasks = shotsNeedingImages.map((shot) => async () => {
      if (signal?.aborted) return;
      useProjectStore.getState().setShotStatusByProjectId(targetProjectId, shot.id, "imaging");

      try {
        const { prompt: enrichedPrompt, referenceImageUrls } = buildImageGenerationInput(shot, project);

        const imageUrl = await generateImage({
          apiKey: providerConfig.apiKey,
          baseUrl: providerConfig.baseUrl,
          prompt: enrichedPrompt,
          size: imageSize,
          ratio: imageRatio,
          ...(referenceImageUrls.length > 0 ? { referenceImageUrls } : {}),
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
    const videoAspect = aspectRatioToVideoAspect(latestProject?.aspectRatio ?? project.aspectRatio);

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
              aspectRatio: videoAspect,
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
          aspectRatio: aspectRatioToVideoAspect(project.aspectRatio),
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
    generateStyleReference,
    rerollShot,
    generateImagesForStep,
    rerollImage,
    generateVideosForStep,
    rerollVideo,
  };
}

/* ── Reference image resolution ─────────────────────────────────────────── */

// 已迁移至 src/lib/promptComposer.ts 的 pickShotReferences（多参考选取，≤3 张）
// 与 getStyleReferenceUrl（风格图读取）。findBestReference 已删除。

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
