// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/StepIndicator.tsx
// Horizontal step indicator bar — unified 6-step flow.
// ────────────────────────────────────────────────────────────────────────────

import { useProjectStore, selectActiveProject, type WizardStep } from "@/stores/projectStore";
import { useT, type TranslationKey } from "@/i18n";
import { Check } from "lucide-react";

const STEPS: { step: WizardStep; labelKey: TranslationKey }[] = [
  { step: 1, labelKey: "wizard.step1" },
  { step: 2, labelKey: "wizard.step2" },
  { step: 3, labelKey: "wizard.step3" },
  { step: 4, labelKey: "wizard.step4" },
  { step: 5, labelKey: "wizard.step5" },
  { step: 6, labelKey: "wizard.step6" },
];

export function StepIndicator() {
  const t = useT();
  const project = useProjectStore(selectActiveProject);
  const currentStep = project?.wizardStep ?? 1;

  return (
    <div className="flex items-center justify-center gap-1">
      {STEPS.map(({ step, labelKey }, i) => {
        const isCompleted = step < currentStep;
        const isCurrent = step === currentStep;

        return (
          <div key={step} className="flex items-center gap-1">
            {i > 0 && (
              <div
                className={`h-px w-6 transition-colors ${
                  isCompleted ? "bg-success-solid" : "bg-hover"
                }`}
              />
            )}
            <div
              aria-current={isCurrent ? "step" : undefined}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[0.6875rem] font-medium transition ${
                isCurrent
                  ? "bg-success-solid text-white"
                  : isCompleted
                    ? "bg-success-deep/40 text-success"
                    : "bg-raised text-ink-4"
              }`}
            >
              {isCompleted ? (
                <Check size={11} />
              ) : (
                <span className="flex h-4 w-4 items-center justify-center rounded-full border text-[0.5625rem]">
                  {step}
                </span>
              )}
              {t(labelKey)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
