// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/StepStoryboard.tsx
// Step 3: Generate and edit storyboard shots with structured sub-elements.
// Uses asset context (characters + scene references) for consistency.
// ────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import { useProjectStore, selectActiveProject, type Asset } from "@/stores/projectStore";
import { useT, type TranslationKey } from "@/i18n";
import { ShotCard } from "./ShotCard";
import { PromptSubFields } from "./PromptSubFields";
import { PromptField } from "./PromptField";
import { SYSTEM_PROMPT_SCRIPT_TEXT } from "@/services/chatService";
import { DialogueEditor } from "@/features/shots/DialogueEditor";
import { useWizardActions } from "./useWizardActions";
import { confirmDialog } from "@/components/ui/ConfirmDialog";
import { Plus, Sparkles, Loader2 } from "lucide-react";

export function StepStoryboard() {
  const t = useT();
  const project = useProjectStore(selectActiveProject);
  const updateShot = useProjectStore((s) => s.updateShot);
  const removeShot = useProjectStore((s) => s.removeShot);
  const addShot = useProjectStore((s) => s.addShot);
  const setWizardStep = useProjectStore((s) => s.setWizardStep);
  const { rerollShot, generateStoryboard } = useWizardActions();
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shots = project?.shots ?? [];
  const assets = project?.assets ?? [];
  const hasCharacters = assets.some((a) => a.type === "character");
  const ideaPrompt = project?.ideaPrompt ?? "";

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
      // generateStoryboard 已由 AI 直接输出完整的 visualPrompt + motionPrompt（英文），
      // 无需再调用 translateToMotion 翻译覆盖 —— 该步骤 JSON 解析失败时
      // 会用 "Camera slowly pans, gentle movement" 等兜底文案覆盖完整提示词，
      // 导致视频生成请求体 prompt 内容缺失（用户实测发现的提示词丢失问题）。
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
      duration: 5,
      useDualFrame: false,
    });
  };

  // Show generate prompt when no shots exist
  if (shots.length === 0) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 py-16">
        <div className="text-center">
          <h2 className="text-lg font-bold text-slate-100">
            {t("wizard.step2")}
          </h2>
          <p className="mt-2 text-xs text-slate-500">
            {t("wizard.storyboardHint")}
          </p>
        </div>

        {/* Idea preview */}
        {ideaPrompt && (
          <div className="w-full rounded-xl border border-slate-700 bg-slate-800/50 p-4">
            <p className="text-[11px] font-medium text-slate-500 mb-1">{t("wizard.step1")}</p>
            <p className="text-sm text-slate-300 line-clamp-4">{ideaPrompt}</p>
          </div>
        )}

        {/* Asset summary */}
        <AssetSummaryBar assets={assets} t={t} styleReady={!!project?.styleReferenceUrl} />

        <button
          onClick={handleGenerateStoryboard}
          disabled={!ideaPrompt.trim() || isGenerating}
          className="flex items-center gap-2 rounded-xl bg-emerald-600 px-8 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isGenerating ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Sparkles size={16} />
          )}
          {isGenerating ? t("wizard.generating") : t("wizard.generate")}
        </button>

        {error && (
          <div className="rounded-lg border border-red-800 bg-red-950/30 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Manual add option */}
        <button
          onClick={handleAddShot}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition"
        >
          <Plus size={12} />
          {t("wizard.addShotManual")}
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 py-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-200">
          {t("wizard.step2")} ({shots.length})
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleGenerateStoryboard}
            disabled={isGenerating}
            className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-violet-400 hover:bg-violet-950/30 transition disabled:opacity-50"
          >
            {isGenerating ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
            {isGenerating ? t("wizard.generating") : t("wizard.reroll")}
          </button>
          <button
            onClick={handleAddShot}
            className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-emerald-400 hover:bg-emerald-950/30 transition"
          >
            <Plus size={12} />
            {t("wizard.addShot")}
          </button>
        </div>
      </div>

      {/* 资产摘要：常驻显示，让用户感知分镜生成时自动提取的资产 */}
      <AssetSummaryBar assets={assets} t={t} styleReady={!!project?.styleReferenceUrl} />

      {/* Shot cards */}
      <div className="flex flex-col gap-2">
        {shots.map((shot) => (
          <ShotCard
            key={shot.id}
            shot={shot}
            mode="storyboard"
            onReroll={() => rerollShot(shot.id)}
            onDelete={() => removeShot(shot.id)}
          >
            {/* Script text */}
            <PromptField
              label={t("pipeline.scriptText")}
              value={shot.scriptText}
              onChange={(v) => updateShot(shot.id, { scriptText: v })}
              systemPrompt={SYSTEM_PROMPT_SCRIPT_TEXT}
              resetKey={shot.id}
              rows={2}
              color="sky"
            />

            {/* Duration */}
            <div className="flex items-center gap-2">
              <label className="text-[11px] font-medium text-slate-500">
                {t("pipeline.duration")}
              </label>
              <select
                value={shot.duration}
                onChange={(e) => updateShot(shot.id, { duration: parseInt(e.target.value) })}
                className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-300 focus:outline-none"
              >
                <option value={4}>4s</option>
                <option value={5}>5s</option>
                <option value={8}>8s</option>
              </select>
            </div>

            {/* Structured sub-elements */}
            <PromptSubFields
              shotId={shot.id}
              sections={["image", "motion", "negative"]}
            />

            {/* Dialogue editor (drama mode only) */}
            {hasCharacters && <DialogueEditor shotId={shot.id} />}
          </ShotCard>
        ))}
      </div>

      {/* 分镜确认卡：semi-auto 模式下确认后进入图片生成（auto 模式已自动推进） */}
      {project?.automationMode !== "auto" && (
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-6">
          <h3 className="text-sm font-semibold text-slate-100">
            {t("review.qualityCheck")}
          </h3>
          <p className="mt-2 text-xs text-slate-400">
            {t("wizard.storyboardConfirmHint")}
          </p>
          <button
            onClick={() => setWizardStep(4)}
            className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500"
          >
            {t("wizard.confirmStoryboard")}
          </button>
        </div>
      )}
    </div>
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
  if (chars === 0 && scenes === 0 && products === 0 && !styleReady) return null;
  return (
    <div className="flex flex-wrap gap-3 text-[11px] text-slate-500">
      <span>{t("wizard.assetCharacters")}: {chars}</span>
      <span>{t("wizard.assetScenes")}: {scenes}</span>
      <span>{t("wizard.productReferences")}: {products}</span>
      {styleReady && <span>{t("wizard.assetStyle")}: ✓</span>}
    </div>
  );
}
