// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/StepStoryboard.tsx
// Step 3: 分镜列表 + 生成 / 重新生成 / 审核卡点。
// 2026-09-16 布局改造：原「卡片折叠展开 + 8 个子字段各自润色」收敛为
// 「列表卡 → 详情页（内容全只读 + 一句话交给 AI 改）」，与资产链同一交互模型。
// ────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from "react";
import { useProjectStore, selectActiveProject, type Asset, type Shot } from "@/stores/projectStore";
import { useT, type TranslationKey } from "@/i18n";
import { ShotDetail } from "./ShotDetail";
import { useWizardActions, hasActiveScriptTask } from "./useWizardActions";
import { useSettingsStore } from "@/stores/settingsStore";
import { syncSelectionWithShots } from "@/lib/railSelection";
import { WizardMessages } from "./WizardMessages";
import { StepProgressBar } from "./StepProgressBar";
import { StepHeader } from "./StepHeader";
import { ReviewCheckpoint } from "./ReviewCheckpoint";
import { WizardShell } from "./WizardShell";
import { WizardRail } from "./WizardRail";
import { confirmDialog } from "@/components/ui/ConfirmDialog";
import { Sparkles, Loader2, Plus, Trash2 } from "lucide-react";

export function StepStoryboard() {
  const t = useT();
  const project = useProjectStore(selectActiveProject);
  const removeShot = useProjectStore((s) => s.removeShot);
  const addShot = useProjectStore((s) => s.addShot);
  const setWizardStep = useProjectStore((s) => s.setWizardStep);
  const updateProject = useProjectStore((s) => s.updateProject);
  const hasApiKey = useSettingsStore((s) => Boolean(s.providerConfig.apiKey && s.providerConfig.baseUrl));
  const { rerollShot, generateStoryboard, reviseShot } = useWizardActions();
  const [editingShotId, setEditingShotId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shots = project?.shots ?? [];
  const assets = project?.assets ?? [];
  const ideaPrompt = project?.ideaPrompt ?? "";
  const allShotsHaveScript = shots.length > 0 && shots.every((shot) => shot.scriptText.trim());
  // 分镜完成度唯一口径：与 allShotsHaveScript / canAdvance 步骤 3 同源
  const scriptedCount = shots.filter((shot) => shot.scriptText.trim()).length;
  const allShotsHaveVisualPrompt = shots.length > 0 && shots.every((shot) => shot.visualPrompt.trim());
  // 「生成中」以 store 为准：从资产页切进来时任务已在飞，只靠局部 isGenerating 会漏判
  const generating = isGenerating || shots.some((shot) => shot.status === "scripting");
  const [railCompact, setRailCompact] = useState(false);
  // 双栏选中态（页面局部，不持久化）：选中项被删除时回落首镜，不留悬空选中
  const currentId = syncSelectionWithShots(shots.map((shot) => shot.id), editingShotId ?? undefined);
  const editingShot = shots.find((shot) => shot.id === currentId) ?? null;

  const handleGenerateStoryboard = async () => {
    if (!ideaPrompt.trim() || !project) return;
    // 已有分镜时，顶部“重新生成”会整体覆盖所有镜头：先确认，防止误触
    // 丢失手动修改并白耗一次文本配额。
    if (shots.length > 0) {
      const ok = await confirmDialog({
        title: t("wizard.storyboardRegenerateTitle"),
        message: t("wizard.storyboardRegenerateConfirm", { count: shots.length }),
        confirmLabel: t("dialog.confirm"),
        variant: "danger",
      });
      if (!ok) return;
    }
    setIsGenerating(true);
    setError(null);
    try {
      await generateStoryboard(ideaPrompt.trim());
      // auto 模式：分镜生成成功后自动推进到图片步骤（无需确认）
      const latest = useProjectStore.getState().projects.find((p) => p.id === project.id);
      if (latest?.automationMode === "auto") {
        setWizardStep(4);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAddShot = () => {
    addShot({
      scriptText: "",
      visualPrompt: "",
      motionPrompt: "",
      dialogues: [],
      activeCharacterIds: [],
      activeProductIds: [],
      activePropIds: [],
      duration: 5,
      useDualFrame: false,
    });
  };

  const handleDeleteShot = async (shot: Shot) => {
    const ok = await confirmDialog({
      title: t("dialog.delete"),
      message: t("wizard.shotDeleteConfirm", { index: shot.index + 1 }),
      confirmLabel: t("dialog.confirm"),
      variant: "danger",
    });
    if (!ok) return;
    removeShot(shot.id);
    if (editingShotId === shot.id) setEditingShotId(null);
  };

  // 自动生成分镜：挂载 / 镜头数变化时触发一次（与 StepImages 自动生成同模式）。
  // 触发条件收紧为「没有任何镜头携带内容」（shots 为空，或只有手动添加的空壳镜头）：
  // - 空壳无内容可丢，不弹覆盖确认，直接生成；
  // - 已有真实分镜内容时绝不自动覆盖（重新生成走顶部按钮 + 确认弹窗）。
  // 依赖只放 [shots.length]（铁律：自动触发 effect 禁止依赖生成状态位，防重入误杀）；
  // autoStoryboardRef 挡 StrictMode 双挂载 / 状态位变化引起的重复调用。
  const autoStoryboardRef = useRef(false);
  const ideaPromptTrimmed = ideaPrompt.trim();
  useEffect(() => {
    if (autoStoryboardRef.current) return;
    if (!ideaPromptTrimmed || !project) return;
    // 已有分镜任务在飞（模块级注册表跨组件实例存活）时不重复启动：
    // 重挂载会重置 autoStoryboardRef，只靠 ref 挡不住重复请求。
    if (hasActiveScriptTask(project.id)) return;
    const hasContent = shots.some((s) => s.scriptText.trim() || s.visualPrompt.trim());
    if (hasContent) return;
    autoStoryboardRef.current = true;
    void (async () => {
      setIsGenerating(true);
      setError(null);
      try {
        await generateStoryboard(ideaPromptTrimmed);
        // auto 模式：分镜生成成功后自动推进到图片步骤（与手动生成行为一致）
        const latest = useProjectStore.getState().projects.find((p) => p.id === project.id);
        if (latest?.automationMode === "auto") {
          setWizardStep(4);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsGenerating(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shots.length, ideaPromptTrimmed]);

  // Show generate prompt when no shots exist
  if (shots.length === 0) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 py-16">
        <div className="text-center">
          <h2 className="text-lg font-bold text-ink">
            {t("wizard.step3")}
          </h2>
          <p className="mt-2 text-xs text-ink-4">
            {t("wizard.storyboardHint")}
          </p>
        </div>

        {/* Idea preview */}
        {ideaPrompt && (
          <div className="w-full rounded-xl border border-line bg-raised/50 p-4">
            <p className="text-[0.6875rem] font-medium text-ink-4 mb-1">{t("wizard.step1")}</p>
            <p className="text-sm text-ink-2 line-clamp-4">{ideaPrompt}</p>
          </div>
        )}

        {/* Asset summary */}
        <AssetSummaryBar assets={assets} t={t} styleReady={!!project?.styleReferenceUrl} />

        <button
          onClick={handleGenerateStoryboard}
          disabled={!ideaPrompt.trim() || generating}
          className="flex items-center gap-2 rounded-xl bg-success-solid px-8 py-3 text-sm font-semibold text-white transition hover:bg-success-solid disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {generating ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Sparkles size={16} />
          )}
          {generating ? t("wizard.generating") : t("wizard.generate")}
        </button>

        <WizardMessages error={error} />

        <button
          onClick={handleAddShot}
          className="text-xs text-ink-4 transition hover:text-ink-2"
        >
          {t("wizard.addShotManual")}
        </button>
      </div>
    );
  }

  return (
    <WizardShell
      header={<>
        <StepHeader
          titleKey="wizard.step3"
          done={scriptedCount}
          total={shots.length}
          actions={
            <button
              onClick={handleGenerateStoryboard}
              disabled={generating}
              className="flex items-center gap-1 rounded px-2 py-1 text-[0.6875rem] text-accent transition hover:bg-accent-deep/30 disabled:opacity-50"
            >
              {generating ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
              {generating ? t("wizard.generating") : t("wizard.reroll")}
            </button>
          }
        />

        {/* 完成度：与 canAdvance 步骤 3 同一口径（scriptText 非空） */}
        <StepProgressBar done={scriptedCount} total={shots.length} />

        {/* 资产摘要：常驻显示，让用户感知分镜生成时自动提取的资产 */}
        <AssetSummaryBar assets={assets} t={t} styleReady={!!project?.styleReferenceUrl} />
      </>}
      rail={
        <WizardRail
          shots={shots}
          currentId={currentId}
          onSelect={setEditingShotId}
          aspect={project?.aspectRatio}
          mode="storyboard"
          compact={railCompact}
          onToggleCompact={() => setRailCompact((v) => !v)}
          footer={
            <button
              onClick={handleAddShot}
              className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong bg-raised/30 px-4 py-2 text-xs text-ink-3 transition hover:border-success hover:text-success"
            >
              <Plus size={14} />
              {t("wizard.addShot")}
            </button>
          }
        />
      }
      detail={editingShot ? (
        <div key={editingShot.id} className="flex min-h-0 flex-1 flex-col gap-3">
          <ShotDetail
            shot={editingShot}
            assets={assets}
            hasApiKey={hasApiKey}
            onClose={() => setEditingShotId(shots[0]?.id ?? null)}
            onRevise={(instruction) => reviseShot(editingShot.id, instruction)}
            onReroll={() => rerollShot(editingShot.id)}
          />
          <WizardMessages error={error} />
          {/* 分镜确认卡：semi-auto 模式下确认后进入图片生成（auto 模式由组件内部跳过） */}
          <ReviewCheckpoint
            mode={project?.automationMode ?? "semi-auto"}
            hintKey="wizard.storyboardConfirmHint"
            confirmLabelKey="wizard.confirmStoryboard"
            confirmDisabled={!allShotsHaveScript || !allShotsHaveVisualPrompt}
            onConfirm={() => {
              updateProject({ storyboardReviewed: true });
              setWizardStep(4);
            }}
          />
        </div>
      ) : (
        <p className="text-xs text-ink-4">{t("rail.empty")}</p>
      )}
      detailActions={editingShot ? (
        <button
          onClick={() => void handleDeleteShot(editingShot)}
          className="flex items-center gap-1 rounded-md border border-line px-3 py-1.5 text-xs text-danger transition hover:bg-danger-deep/30"
        >
          <Trash2 size={11} />
          {t("dialog.delete")}
        </button>
      ) : null}
    />
  );
}

/** 资产摘要条：常驻显示角色/场景/产品/风格资产数量 */
function AssetSummaryBar({
  assets,
  t,
  styleReady,
}: {
  assets: Asset[];
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
  styleReady: boolean;
}) {
  const chars = assets.filter((a) => a.type === "character").length;
  const scenes = assets.filter((a) => a.type === "scene").length;
  const products = assets.filter((a) => a.type === "product").length;
  const props = assets.filter((a) => a.type === "prop").length;
  if (chars === 0 && scenes === 0 && products === 0 && props === 0 && !styleReady) return null;
  return (
    <div className="flex flex-wrap gap-3 text-[0.6875rem] text-ink-4">
      <span>{t("wizard.assetCharacters")}: {chars}</span>
      <span>{t("wizard.assetScenes")}: {scenes}</span>
      <span>{t("wizard.productReferences")}: {products}</span>
      <span>{t("wizard.propReferences")}: {props}</span>
      {styleReady && <span>{t("wizard.assetStyle")}: ✓</span>}
    </div>
  );
}
