// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/CreationWizard.tsx
// Main wizard container: step routing + layout.
// ────────────────────────────────────────────────────────────────────────────

import { useProjectStore, selectActiveProject } from "@/stores/projectStore";
import { useT } from "@/i18n";
import { StepIndicator } from "./StepIndicator";
import { StepIdea } from "./StepIdea";
import { StepStoryboard } from "./StepStoryboard";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface CreationWizardProps {
  children?: React.ReactNode;
}

export function CreationWizard({ children }: CreationWizardProps) {
  const t = useT();
  const project = useProjectStore(selectActiveProject);
  const setWizardStep = useProjectStore((s) => s.setWizardStep);
  const currentStep = project?.wizardStep ?? 1;
  const shots = project?.shots ?? [];

  // Determine if we can advance to the next step
  const canAdvance = (() => {
    switch (currentStep) {
      case 1: return shots.length > 0;
      case 2: return shots.every((s) => s.scriptText.trim());
      case 3: return shots.every((s) => !!s.imageUrl);
      case 4: return shots.every((s) => !!s.videoUrl);
      case 5: return false; // last step
      default: return false;
    }
  })();

  const canGoBack = currentStep > 1;

  const handlePrev = () => {
    if (canGoBack) {
      setWizardStep((currentStep - 1) as 1 | 2 | 3 | 4 | 5);
    }
  };

  const handleNext = () => {
    if (canAdvance && currentStep < 5) {
      setWizardStep((currentStep + 1) as 1 | 2 | 3 | 4 | 5);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Step indicator */}
      <StepIndicator />

      {/* Step content */}
      <div className="flex-1 overflow-y-auto">
        {currentStep === 1 && <StepIdea />}
        {currentStep === 2 && <StepStoryboard />}
        {currentStep >= 3 && children}
      </div>

      {/* Navigation buttons */}
      {project && (
        <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950 px-6 py-3">
          <button
            onClick={handlePrev}
            disabled={!canGoBack}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-slate-400 transition hover:bg-slate-800 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft size={14} />
            {t("wizard.prev" as any)}
          </button>

          {currentStep < 5 && (
            <button
              onClick={handleNext}
              disabled={!canAdvance}
              className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t("wizard.next" as any)}
              <ChevronRight size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
