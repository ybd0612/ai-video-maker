// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/StepStoryboard.tsx
// Step 2: Edit storyboard shots with structured sub-elements.
// ────────────────────────────────────────────────────────────────────────────

import { useProjectStore, selectActiveProject } from "@/stores/projectStore";
import { useT } from "@/i18n";
import { ShotCard } from "./ShotCard";
import { PromptSubFields } from "./PromptSubFields";
import { PromptField } from "./PromptField";
import { useWizardActions } from "./useWizardActions";
import { Plus } from "lucide-react";

export function StepStoryboard() {
  const t = useT();
  const project = useProjectStore(selectActiveProject);
  const updateShot = useProjectStore((s) => s.updateShot);
  const removeShot = useProjectStore((s) => s.removeShot);
  const addShot = useProjectStore((s) => s.addShot);
  const { rerollShot } = useWizardActions();

  const shots = project?.shots ?? [];

  const handleAddShot = () => {
    addShot({
      scriptText: "",
      visualPrompt: "",
      motionPrompt: "",
      dialogues: [],
      activeCharacterIds: [],
      duration: 5,
    });
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 py-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-200">
          {t("wizard.step2")} ({shots.length})
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleAddShot}
            className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-emerald-400 hover:bg-emerald-950/30 transition"
          >
            <Plus size={12} />
            {t("dialogue.add" as any)}
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
          </ShotCard>
        ))}
      </div>

      {shots.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <p className="text-sm text-slate-500">
            {t("pipeline.noShots")}
          </p>
        </div>
      )}
    </div>
  );
}
