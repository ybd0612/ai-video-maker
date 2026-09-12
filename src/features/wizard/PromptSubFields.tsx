// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/PromptSubFields.tsx
// Structured sub-element editor for visual and motion prompts.
// 每个子字段都带框内「润色 / 撤销」（AiPolishField）。
// ────────────────────────────────────────────────────────────────────────────

import { useProjectStore } from "@/stores/projectStore";
import { useT } from "@/i18n";
import { PromptField } from "./PromptField";
import {
  SYSTEM_PROMPT_VISUAL_PROMPT,
  SYSTEM_PROMPT_MOTION_PROMPT,
  SYSTEM_PROMPT_NEGATIVE_PROMPT,
} from "@/services/chatService";
import { Image, Video } from "lucide-react";

interface PromptSubFieldsProps {
  shotId: string;
  /** Which sections to show */
  sections?: ("image" | "motion" | "negative")[];
}

export function PromptSubFields({
  shotId,
  sections = ["image", "motion", "negative"],
}: PromptSubFieldsProps) {
  const t = useT();
  const shot = useProjectStore((s) => {
    const project = s.projects.find((p) => p.id === s.activeProjectId);
    return project?.shots.find((sh) => sh.id === shotId);
  });
  const updateShot = useProjectStore((s) => s.updateShot);

  if (!shot) return null;

  const handleChange = (field: string, value: string) => {
    updateShot(shotId, { [field]: value });
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Text-to-Image sub-elements */}
      {sections.includes("image") && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-[0.6875rem] font-semibold text-violet-400">
            <Image size={11} />
            {t("wizard.sectionImage")}
          </div>
          <PromptField
            label={t("wizard.promptSubject")}
            value={shot.subjectDesc ?? ""}
            onChange={(v) => handleChange("subjectDesc", v)}
            systemPrompt={SYSTEM_PROMPT_VISUAL_PROMPT}
            resetKey={shotId}
            placeholder="一位长发黑色长发的年轻女性"
            color="violet"
          />
          <PromptField
            label={t("wizard.promptScene")}
            value={shot.sceneDesc ?? ""}
            onChange={(v) => handleChange("sceneDesc", v)}
            systemPrompt={SYSTEM_PROMPT_VISUAL_PROMPT}
            resetKey={shotId}
            placeholder="坐在阳光充足的咖啡馆窗边"
            color="violet"
          />
          <PromptField
            label={t("wizard.promptDetail")}
            value={shot.detailDesc ?? ""}
            onChange={(v) => handleChange("detailDesc", v)}
            systemPrompt={SYSTEM_PROMPT_VISUAL_PROMPT}
            resetKey={shotId}
            placeholder="穿着白色衬衫，精致首饰"
            color="violet"
          />
          <PromptField
            label={t("wizard.promptLighting")}
            value={shot.lightingDesc ?? ""}
            onChange={(v) => handleChange("lightingDesc", v)}
            systemPrompt={SYSTEM_PROMPT_VISUAL_PROMPT}
            resetKey={shotId}
            placeholder="温暖的金色夕阳光，电影感轮廓光"
            color="violet"
          />
          <PromptField
            label={t("wizard.promptStyle")}
            value={shot.styleDesc ?? ""}
            onChange={(v) => handleChange("styleDesc", v)}
            systemPrompt={SYSTEM_PROMPT_VISUAL_PROMPT}
            resetKey={shotId}
            placeholder="写实风格，8K，超精细"
            color="violet"
          />
        </div>
      )}

      {/* Image-to-Video sub-elements */}
      {sections.includes("motion") && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-[0.6875rem] font-semibold text-amber-400">
            <Video size={11} />
            {t("wizard.sectionVideo")}
          </div>
          <PromptField
            label={t("wizard.promptAction")}
            value={shot.actionDesc ?? ""}
            onChange={(v) => handleChange("actionDesc", v)}
            systemPrompt={SYSTEM_PROMPT_MOTION_PROMPT}
            resetKey={shotId}
            placeholder="缓缓转头，温柔微笑"
            color="amber"
          />
          <PromptField
            label={t("wizard.promptCamera")}
            value={shot.cameraDesc ?? ""}
            onChange={(v) => handleChange("cameraDesc", v)}
            systemPrompt={SYSTEM_PROMPT_MOTION_PROMPT}
            resetKey={shotId}
            placeholder="镜头缓缓推进，特写跟踪镜头"
            color="amber"
          />
          <PromptField
            label={t("wizard.promptEnvChange")}
            value={shot.envChangeDesc ?? ""}
            onChange={(v) => handleChange("envChangeDesc", v)}
            systemPrompt={SYSTEM_PROMPT_MOTION_PROMPT}
            resetKey={shotId}
            placeholder="咖啡杯蒸汽上升，窗外树叶摇曳"
            color="amber"
          />
          <PromptField
            label={t("wizard.promptMotionSpeed")}
            value={shot.motionSpeedDesc ?? ""}
            onChange={(v) => handleChange("motionSpeedDesc", v)}
            systemPrompt={SYSTEM_PROMPT_MOTION_PROMPT}
            resetKey={shotId}
            placeholder="电影感慢动作，24fps"
            color="amber"
          />
        </div>
      )}

      {/* Negative prompts */}
      {sections.includes("negative") && (
        <div className="space-y-2">
          <PromptField
            label={t("wizard.negativePrompt")}
            value={shot.negativePrompt ?? ""}
            onChange={(v) => handleChange("negativePrompt", v)}
            systemPrompt={SYSTEM_PROMPT_NEGATIVE_PROMPT}
            resetKey={shotId}
            placeholder="解剖异常，多余肢体，模糊，变形"
            color="red"
            rows={1}
          />
          <PromptField
            label={t("wizard.negativeMotionPrompt")}
            value={shot.negativeMotionPrompt ?? ""}
            onChange={(v) => handleChange("negativeMotionPrompt", v)}
            systemPrompt={SYSTEM_PROMPT_NEGATIVE_PROMPT}
            resetKey={shotId}
            placeholder="变形，闪烁，突兀剪辑，镜头抖动"
            color="red"
            rows={1}
          />
        </div>
      )}
    </div>
  );
}
