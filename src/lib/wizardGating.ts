// ────────────────────────────────────────────────────────────────────────────
// src/lib/wizardGating.ts
// 向导「下一步」门禁判定的唯一口径（纯函数，不写 store、不依赖组件）。
// CreationWizard 的 disabled 与「为什么不能点」的原因提示都从这里取，
// 保证门禁判定与界面解释同源，不会各说各话。
// ────────────────────────────────────────────────────────────────────────────

import type { TranslationKey } from "@/i18n";
import type { Project } from "@/stores/projectStore";

export interface AdvanceEvaluation {
  canAdvance: boolean;
  /** 阻塞原因对应的 i18n 键；canAdvance 为 true 或无项目时为 null */
  reasonKey: TranslationKey | null;
  /** 原因文案里的插值（如缺镜头数 count） */
  vars?: Record<string, number>;
}

const OK: AdvanceEvaluation = { canAdvance: true, reasonKey: null };

function blocked(reasonKey: TranslationKey, vars?: Record<string, number>): AdvanceEvaluation {
  return vars ? { canAdvance: false, reasonKey, vars } : { canAdvance: false, reasonKey };
}

/**
 * 判定当前步骤能否进入下一步，并给出不能进入时的具体原因。
 * 与原 CreationWizard 的 canAdvance 逐条等价，仅额外产出 reasonKey。
 * 半自动（semi-auto）要求对应审核标记；全自动（auto）跳过审核标记门禁。
 */
export function evaluateWizardAdvance(
  project: Project | undefined,
  step: number,
): AdvanceEvaluation {
  if (!project) return { canAdvance: false, reasonKey: null };

  const semiAuto = project.automationMode !== "auto";
  const shots = project.shots ?? [];

  switch (step) {
    case 1:
      if (!project.ideaPrompt?.trim()) return blocked("wizard.block.noIdea");
      // 提取期间禁止前进：否则可在两链未收尾时切页、返回后重复触发提取
      if (project.status === "scripting") return blocked("wizard.block.extracting");
      return OK;

    case 2:
      if (semiAuto && project.assetsReviewed !== true) return blocked("wizard.block.assetsNotReviewed");
      return OK;

    case 3: {
      if (shots.length === 0) return blocked("wizard.block.noShots");
      const missingScript = shots.filter((s) => !s.scriptText?.trim()).length;
      if (missingScript > 0) return blocked("wizard.block.missingScript", { count: missingScript });
      if (semiAuto && project.storyboardReviewed !== true) return blocked("wizard.block.storyboardNotReviewed");
      return OK;
    }

    case 4: {
      if (shots.length === 0) return blocked("wizard.block.noShots");
      const missingImage = shots.filter((s) => !s.imageUrl).length;
      if (missingImage > 0) return blocked("wizard.block.missingImage", { count: missingImage });
      if (semiAuto && project.imagesReviewed !== true) return blocked("wizard.block.imagesNotReviewed");
      return OK;
    }

    case 5: {
      if (shots.length === 0) return blocked("wizard.block.noShots");
      const missingVideo = shots.filter((s) => !s.videoUrl).length;
      if (missingVideo > 0) return blocked("wizard.block.missingVideo", { count: missingVideo });
      return OK;
    }

    // 步骤 6 是最后一步，「下一步」按钮不渲染
    default:
      return OK;
  }
}
