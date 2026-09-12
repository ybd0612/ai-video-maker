// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/CreationWizard.tsx
// Main wizard container: unified 6-step flow.
// 想法 → 资产(参考图) → 分镜 → 图片 → 视频 → 后期拼接
// ────────────────────────────────────────────────────────────────────────────

import { useProjectStore, selectActiveProject, type WizardStep } from "@/stores/projectStore";
import { useT } from "@/i18n";
import { StepIndicator } from "./StepIndicator";
import { StepIdea } from "./StepIdea";
import { StepStoryboard } from "./StepStoryboard";
import { StepAssets } from "./StepAssets";
import { StepImages } from "./StepImages";
import { StepVideos } from "./StepVideos";
import { StepAssembly } from "./StepAssembly";
import { AutomationModeSwitch } from "./AutomationModeSwitch";
import { ChevronLeft, ChevronRight } from "lucide-react";

const TOTAL_STEPS = 6;

export function CreationWizard() {
  const t = useT();
  const project = useProjectStore(selectActiveProject);
  const setWizardStep = useProjectStore((s) => s.setWizardStep);
  const setAutomationMode = useProjectStore((s) => s.setAutomationMode);
  const currentStep = project?.wizardStep ?? 1;
  const shots = project?.shots ?? [];

  const canAdvance = (() => {
    switch (currentStep) {
      case 1: return !!project?.ideaPrompt?.trim();
      // 步骤 2 无资产也可直接下一步（等价跳过）：纯想法项目无需资产，
      // 与显式“跳过”按钮语义一致，消除“下一步禁用 + 跳过可用”的矛盾。
      case 2: return true;
      case 3: return shots.length > 0 && shots.every((s) => s.scriptText.trim());
      case 4: return shots.length > 0 && shots.every((s) => !!s.imageUrl);
      case 5: return shots.length > 0 && shots.every((s) => !!s.videoUrl);
      case 6: return false; // last step
      default: return false;
    }
  })();

  const canGoBack = currentStep > 1;

  const handlePrev = () => {
    if (canGoBack) {
      setWizardStep((currentStep - 1) as WizardStep);
    }
  };

  const handleNext = () => {
    if (canAdvance && currentStep < TOTAL_STEPS) {
      setWizardStep((currentStep + 1) as WizardStep);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Show header only when project exists */}
      {project && (
        <div className="flex items-center justify-between border-b border-line-soft px-6 py-3">
          <StepIndicator />
          <AutomationModeSwitch
            mode={project?.automationMode ?? 'semi-auto'}
            onChange={setAutomationMode}
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {currentStep === 1 && <StepIdea />}
        {currentStep === 2 && <StepAssets />}
        {currentStep === 3 && <StepStoryboard />}
        {currentStep === 4 && <StepImages />}
        {currentStep === 5 && <StepVideos />}
        {currentStep === 6 && <StepAssembly />}
      </div>

      {project && (
        <div className="flex items-center justify-between border-t border-line-soft bg-app px-6 py-3">
          <button
            onClick={handlePrev}
            disabled={!canGoBack}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-ink-3 transition hover:bg-raised hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft size={14} />
            {t("wizard.prev")}
          </button>

          <div className="flex items-center gap-2">
            {currentStep < TOTAL_STEPS && (
              <button
                onClick={handleNext}
                disabled={!canAdvance}
                className="flex items-center gap-1.5 rounded-md bg-success-solid px-4 py-1.5 text-xs font-medium text-white transition hover:bg-success-solid disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t("wizard.next")}
                <ChevronRight size={14} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
