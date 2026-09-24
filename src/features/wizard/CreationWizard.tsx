// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/CreationWizard.tsx
// Main wizard container: unified 6-step flow.
// 想法 → 资产(参考图) → 分镜 → 图片 → 视频 → 后期拼接
// ────────────────────────────────────────────────────────────────────────────

import { useEffect } from "react";
import { useProjectStore, selectActiveProject, type WizardStep } from "@/stores/projectStore";
import { useT } from "@/i18n";
import { hasActiveIdeaTask, hasActiveScriptTask } from "./useWizardActions";
import { resumePendingVideoTasks } from "./useVideoActions";
import { StepIndicator } from "./StepIndicator";
import { StepIdea } from "./StepIdea";
import { StepStoryboard } from "./StepStoryboard";
import { StepAssets } from "./StepAssets";
import { StepImages } from "./StepImages";
import { StepVideos } from "./StepVideos";
import { StepAssembly } from "./StepAssembly";
import { AutomationModeSwitch } from "./AutomationModeSwitch";
import { evaluateWizardAdvance } from "@/lib/wizardGating";
import { ChevronLeft, ChevronRight } from "lucide-react";

const TOTAL_STEPS = 6;

export function CreationWizard() {
  const t = useT();
  const project = useProjectStore(selectActiveProject);
  const setWizardStep = useProjectStore((s) => s.setWizardStep);
  const setAutomationMode = useProjectStore((s) => s.setAutomationMode);
  const currentStep = project?.wizardStep ?? 1;

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
    // 视频域同理：注册表已清空，但带 videoTaskId 的镜头说明服务端任务还在跑，
    // 必须续轮询同一个任务（按秒计费），无 ID 的才复位为 imaged。
    void resumePendingVideoTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const advance = evaluateWizardAdvance(project, currentStep);
  const canAdvance = advance.canAdvance;
  const blockReason =
    !canAdvance && advance.reasonKey ? t(advance.reasonKey, advance.vars) : undefined;

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
            <ChevronLeft className="h-3.5 w-3.5" />
            {t("wizard.prev")}
          </button>

          <div className="flex items-center gap-2">
            {currentStep < TOTAL_STEPS && blockReason && (
              <span className="text-[0.6875rem] text-ink-4">{blockReason}</span>
            )}
            {currentStep < TOTAL_STEPS && (
              <button
                onClick={handleNext}
                disabled={!canAdvance}
                title={blockReason}
                className="flex items-center gap-1.5 rounded-md bg-success-solid px-4 py-1.5 text-xs font-medium text-white transition hover:bg-success-solid disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t("wizard.next")}
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
