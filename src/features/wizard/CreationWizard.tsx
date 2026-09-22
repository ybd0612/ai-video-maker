// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/CreationWizard.tsx
// Main wizard container: unified 6-step flow.
// 想法 → 资产(参考图) → 分镜 → 图片 → 视频 → 后期拼接
// ────────────────────────────────────────────────────────────────────────────

import { useEffect } from "react";
import { useProjectStore, selectActiveProject, type WizardStep } from "@/stores/projectStore";
import { useT } from "@/i18n";
import { hasActiveIdeaTask, hasActiveScriptTask } from "./useWizardActions";
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

  // 刷新恢复：模块级注册表随页面销毁清空，上一轮遗留的 scripting 永远等不到写回复位，
  // 会同时卡死步骤 1 的「AI 提取 / 下一步」门禁和侧栏转圈。放在容器做（而非某个步骤组件），
  // 因为中断时用户可能停在任意步骤；只在挂载时跑一次 —— 此刻注册表为空即代表"没有真实任务"。
  useEffect(() => {
    const stuck = useProjectStore.getState().projects.filter(
      (p) => p.status === "scripting" && !hasActiveIdeaTask(p.id) && !hasActiveScriptTask(p.id),
    );
    for (const p of stuck) {
      useProjectStore.getState().setProjectStatusById(p.id, "idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canAdvance = (() => {
    switch (currentStep) {
      // 提取期间（scripting）禁止前进：否则可在两链未收尾时切页、返回后重复触发提取
      case 1: return !!project?.ideaPrompt?.trim() && project?.status !== "scripting";
      // 半自动流程必须通过 StepAssets 自己的审核卡点进入分镜；
      // 这里也保留门禁，防止外部导航或恢复旧状态绕过审核。
      case 2: return project?.automationMode === "auto" || project?.assetsReviewed === true;
      case 3: return shots.length > 0 && shots.every((s) => s.scriptText.trim()) &&
        (project?.automationMode === "auto" || project?.storyboardReviewed === true);
      case 4: return shots.length > 0 && shots.every((s) => !!s.imageUrl) &&
        (project?.automationMode === "auto" || project?.imagesReviewed === true);
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
