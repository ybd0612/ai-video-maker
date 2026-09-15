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
          <div className="flex items-center gap-1.5 text-[0.6875rem] font-semibold text-accent">
            <Image size={11} />
            {t("wizard.sectionImage")}
          </div>
          <PromptField
            label={t("wizard.promptSubject")}
            value={shot.subjectDesc ?? ""}
            onChange={(v) => handleChange("subjectDesc", v)}
            systemPrompt={SYSTEM_PROMPT_VISUAL_PROMPT}
            resetKey={shotId}
            placeholder={t("promptPh.subject")}
            color="violet"
          />
          <PromptField
            label={t("wizard.promptScene")}
            value={shot.sceneDesc ?? ""}
            onChange={(v) => handleChange("sceneDesc", v)}
            systemPrompt={SYSTEM_PROMPT_VISUAL_PROMPT}
            resetKey={shotId}
            placeholder={t("promptPh.scene")}
            color="violet"
          />
          <PromptField
            label={t("wizard.promptDetail")}
            value={shot.detailDesc ?? ""}
            onChange={(v) => handleChange("detailDesc", v)}
            systemPrompt={SYSTEM_PROMPT_VISUAL_PROMPT}
            resetKey={shotId}
            placeholder={t("promptPh.style")}
            color="violet"
          />
          <PromptField
            label={t("wizard.promptLighting")}
            value={shot.lightingDesc ?? ""}
            onChange={(v) => handleChange("lightingDesc", v)}
            systemPrompt={SYSTEM_PROMPT_VISUAL_PROMPT}
            resetKey={shotId}
            placeholder={t("promptPh.lighting")}
            color="violet"
          />
          <PromptField
            label={t("wizard.promptStyle")}
            value={shot.styleDesc ?? ""}
            onChange={(v) => handleChange("styleDesc", v)}
            systemPrompt={SYSTEM_PROMPT_VISUAL_PROMPT}
            resetKey={shotId}
            placeholder={t("promptPh.quality")}
            color="violet"
          />
        </div>
      )}

      {/* Image-to-Video sub-elements */}
      {sections.includes("motion") && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-[0.6875rem] font-semibold text-warn">
            <Video size={11} />
            {t("wizard.sectionVideo")}
          </div>
          <PromptField
            label={t("wizard.promptAction")}
            value={shot.actionDesc ?? ""}
            onChange={(v) => handleChange("actionDesc", v)}
            systemPrompt={SYSTEM_PROMPT_MOTION_PROMPT}
            resetKey={shotId}
            placeholder={t("promptPh.motion")}
            color="amber"
          />
          <PromptField
            label={t("wizard.promptCamera")}
            value={shot.cameraDesc ?? ""}
            onChange={(v) => handleChange("cameraDesc", v)}
            systemPrompt={SYSTEM_PROMPT_MOTION_PROMPT}
            resetKey={shotId}
            placeholder={t("promptPh.camera")}
            color="amber"
          />
          <PromptField
            label={t("wizard.promptEnvChange")}
            value={shot.envChangeDesc ?? ""}
            onChange={(v) => handleChange("envChangeDesc", v)}
            systemPrompt={SYSTEM_PROMPT_MOTION_PROMPT}
            resetKey={shotId}
            placeholder={t("promptPh.environment")}
            color="amber"
          />
          <PromptField
            label={t("wizard.promptMotionSpeed")}
            value={shot.motionSpeedDesc ?? ""}
            onChange={(v) => handleChange("motionSpeedDesc", v)}
            systemPrompt={SYSTEM_PROMPT_MOTION_PROMPT}
            resetKey={shotId}
            placeholder={t("promptPh.motionQuality")}
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
            placeholder={t("promptPh.negativeImage")}
            color="red"
            rows={1}
          />
          <PromptField
            label={t("wizard.negativeMotionPrompt")}
            value={shot.negativeMotionPrompt ?? ""}
            onChange={(v) => handleChange("negativeMotionPrompt", v)}
            systemPrompt={SYSTEM_PROMPT_NEGATIVE_PROMPT}
            resetKey={shotId}
            placeholder={t("promptPh.negativeMotion")}
            color="red"
            rows={1}
          />
        </div>
      )}
    </div>
  );
}
