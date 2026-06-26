// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/StepStoryboard.tsx
// Step 3: Generate and edit storyboard shots with structured sub-elements.
// Uses asset context (characters + scene references) for consistency.
// ────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import { useProjectStore, selectActiveProject } from "@/stores/projectStore";
import { translateToMotion } from "@/services/scriptService";
import { useT } from "@/i18n";
import { ShotCard } from "./ShotCard";
import { PromptSubFields } from "./PromptSubFields";
import { PromptField } from "./PromptField";
import { DialogueEditor } from "@/features/shots/DialogueEditor";
import { useWizardActions } from "./useWizardActions";
import { Plus, Sparkles, Loader2 } from "lucide-react";

export function StepStoryboard() {
  const t = useT();
  const project = useProjectStore(selectActiveProject);
  const updateShot = useProjectStore((s) => s.updateShot);
  const removeShot = useProjectStore((s) => s.removeShot);
  const addShot = useProjectStore((s) => s.addShot);
  const { rerollShot, generateStoryboard } = useWizardActions();
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shots = project?.shots ?? [];
  const hasCharacters = (project?.characters?.length ?? 0) > 0;
  const ideaPrompt = project?.ideaPrompt ?? "";

  const handleGenerateStoryboard = async () => {
    if (!ideaPrompt.trim()) return;
    setIsGenerating(true);
    setError(null);
    try {
      await generateStoryboard(ideaPrompt.trim());

      // 为每个分镜翻译运动提示词（visualPrompt + motionPrompt）
      const currentProject = selectActiveProject(useProjectStore.getState());
      const shots = currentProject?.shots ?? [];
      const characters = currentProject?.characters ?? [];
      const scene = currentProject?.sceneReferences?.[0];
      for (const shot of shots) {
        if (!shot.scriptText.trim()) continue;
        const motionResult = await translateToMotion(shot.scriptText, characters, scene);
        updateShot(shot.id, {
          visualPrompt: motionResult.visualPrompt,
          motionPrompt: motionResult.motionPrompt,
        });
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
        <div className="flex gap-4 text-xs text-slate-500">
          <span>{t("wizard.assetCharacters")}: {project?.characters?.length ?? 0}</span>
          <span>{t("wizard.assetScenes")}: {project?.sceneReferences?.length ?? 0}</span>
          {project?.styleReferenceUrl && <span>{t("wizard.assetStyle")}: ✓</span>}
        </div>

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
                <option value={3}>3s</option>
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
    </div>
  );
}
