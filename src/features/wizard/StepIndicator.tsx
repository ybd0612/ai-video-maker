// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/StepIndicator.tsx
// Horizontal step indicator bar for the creation wizard.
// ────────────────────────────────────────────────────────────────────────────

import { useProjectStore, selectActiveProject, type WizardStep } from "@/stores/projectStore";
import { useT } from "@/i18n";
import { Check } from "lucide-react";

const STEPS: { step: WizardStep; labelKey: string }[] = [
  { step: 1, labelKey: "wizard.step1" },
  { step: 2, labelKey: "wizard.step2" },
  { step: 3, labelKey: "wizard.step3" },
  { step: 4, labelKey: "wizard.step4" },
  { step: 5, labelKey: "wizard.step5" },
];

export function StepIndicator() {
  const t = useT();
  const project = useProjectStore(selectActiveProject);
  const setWizardStep = useProjectStore((s) => s.setWizardStep);
  const currentStep = project?.wizardStep ?? 1;

  const handleClick = (step: WizardStep) => {
    // Allow jumping back to completed steps, or forward by 1
    if (step <= currentStep) {
      setWizardStep(step);
    }
  };

  return (
    <div className="flex items-center justify-center gap-1 border-b border-slate-800 bg-slate-950 px-4 py-3">
      {STEPS.map(({ step, labelKey }, i) => {
        const isCompleted = step < currentStep;
        const isCurrent = step === currentStep;

        return (
          <div key={step} className="flex items-center gap-1">
            {i > 0 && (
              <div
                className={`h-px w-6 transition-colors ${
                  isCompleted ? "bg-emerald-500" : "bg-slate-700"
                }`}
              />
            )}
            <button
              onClick={() => handleClick(step)}
              disabled={step > currentStep}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium transition ${
                isCurrent
                  ? "bg-emerald-600 text-white"
                  : isCompleted
                    ? "bg-emerald-900/40 text-emerald-400 hover:bg-emerald-900/60"
                    : "bg-slate-800 text-slate-500 cursor-not-allowed"
              }`}
            >
              {isCompleted ? (
                <Check size={11} />
              ) : (
                <span className="flex h-4 w-4 items-center justify-center rounded-full border text-[9px]">
                  {step}
                </span>
              )}
              {t(labelKey as any)}
            </button>
          </div>
        );
      })}
    </div>
  );
}
