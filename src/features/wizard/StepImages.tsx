// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/StepImages.tsx
// Step 3: Generate images for all shots, with "draw card" re-roll.
// ────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef } from "react";
import { useProjectStore, selectActiveProject } from "@/stores/projectStore";
import { useT } from "@/i18n";
import { ShotCard } from "./ShotCard";
import { PromptSubFields } from "./PromptSubFields";
import { useWizardActions } from "./useWizardActions";
import { RefreshCw } from "lucide-react";

export function StepImages() {
  const t = useT();
  const project = useProjectStore(selectActiveProject);
  const setWizardStep = useProjectStore((s) => s.setWizardStep);
  const { generateImagesForStep, rerollImage } = useWizardActions();

  const shots = project?.shots ?? [];
  const allImaged = shots.length > 0 && shots.every((s) => !!s.imageUrl);
  const generatingCount = shots.filter((s) => s.status === "imaging").length;
  const hasStarted = useRef(false);

  // Auto-generate images when entering this step
  useEffect(() => {
    if (!hasStarted.current && shots.length > 0) {
      const needsImages = shots.some((s) => !s.imageUrl);
      if (needsImages) {
        hasStarted.current = true;
        generateImagesForStep();
      }
    }
  }, [shots.length, generateImagesForStep]);

  const handleRerollAll = () => {
    shots.forEach((shot) => {
      if (shot.imageUrl) {
        rerollImage(shot.id);
      }
    });
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 py-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-200">
          {t("wizard.step3")} ({shots.filter((s) => !!s.imageUrl).length}/{shots.length})
        </h2>
        <div className="flex items-center gap-2">
          {generatingCount > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-violet-400">
              <RefreshCw size={11} className="animate-spin" />
              {generatingCount} {t("wizard.generating")}
            </span>
          )}
          <button
            onClick={handleRerollAll}
            disabled={generatingCount > 0}
            className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-emerald-400 hover:bg-emerald-950/30 transition disabled:opacity-50"
          >
            <RefreshCw size={11} />
            {t("wizard.rerollAll")}
          </button>
          {allImaged && (
            <button
              onClick={() => setWizardStep(4)}
              className="flex items-center gap-1 rounded bg-emerald-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-emerald-500 transition"
            >
              {t("wizard.next")} →
            </button>
          )}
        </div>
      </div>

      {/* Shot cards with images */}
      <div className="flex flex-col gap-2">
        {shots.map((shot) => (
          <ShotCard
            key={shot.id}
            shot={shot}
            mode="image"
            onReroll={() => rerollImage(shot.id)}
            isGenerating={shot.status === "imaging"}
          >
            {/* Show generated image */}
            {shot.imageUrl && (
              <div className="overflow-hidden rounded-md border border-slate-700">
                <img
                  src={shot.imageUrl}
                  alt={`Shot ${shot.index + 1}`}
                  className="w-full object-contain max-h-48"
                />
              </div>
            )}

            {/* Edit sub-elements */}
            <PromptSubFields
              shotId={shot.id}
              sections={["image", "negative"]}
            />
          </ShotCard>
        ))}
      </div>
    </div>
  );
}
