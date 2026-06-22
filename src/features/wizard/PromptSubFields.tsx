// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/PromptSubFields.tsx
// Structured sub-element editor for visual and motion prompts.
// ────────────────────────────────────────────────────────────────────────────

import { useProjectStore } from "@/stores/projectStore";
import { useT } from "@/i18n";
import { PromptField } from "./PromptField";
import { Image, Video } from "lucide-react";

interface PromptSubFieldsProps {
  shotId: string;
  /** Which sections to show */
  sections?: ("image" | "motion" | "negative")[];
  /** Callback for AI assist on a specific field */
  onAiAssist?: (field: string, currentValue: string) => void;
}

export function PromptSubFields({
  shotId,
  sections = ["image", "motion", "negative"],
  onAiAssist,
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

  const handleAiAssist = (field: string, currentValue: string) => {
    onAiAssist?.(field, currentValue);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Text-to-Image sub-elements */}
      {sections.includes("image") && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-violet-400">
            <Image size={11} />
            {t("wizard.sectionImage")}
          </div>
          <PromptField
            label={t("wizard.promptSubject")}
            value={shot.subjectDesc ?? ""}
            onChange={(v) => handleChange("subjectDesc", v)}
            onAiAssist={() => handleAiAssist("subjectDesc", shot.subjectDesc ?? "")}
            placeholder="一位长发黑色长发的年轻女性"
            color="violet"
          />
          <PromptField
            label={t("wizard.promptScene")}
            value={shot.sceneDesc ?? ""}
            onChange={(v) => handleChange("sceneDesc", v)}
            onAiAssist={() => handleAiAssist("sceneDesc", shot.sceneDesc ?? "")}
            placeholder="坐在阳光充足的咖啡馆窗边"
            color="violet"
          />
          <PromptField
            label={t("wizard.promptDetail")}
            value={shot.detailDesc ?? ""}
            onChange={(v) => handleChange("detailDesc", v)}
            onAiAssist={() => handleAiAssist("detailDesc", shot.detailDesc ?? "")}
            placeholder="穿着白色衬衫，精致首饰"
            color="violet"
          />
          <PromptField
            label={t("wizard.promptLighting")}
            value={shot.lightingDesc ?? ""}
            onChange={(v) => handleChange("lightingDesc", v)}
            onAiAssist={() => handleAiAssist("lightingDesc", shot.lightingDesc ?? "")}
            placeholder="温暖的金色夕阳光，电影感轮廓光"
            color="violet"
          />
          <PromptField
            label={t("wizard.promptStyle")}
            value={shot.styleDesc ?? ""}
            onChange={(v) => handleChange("styleDesc", v)}
            onAiAssist={() => handleAiAssist("styleDesc", shot.styleDesc ?? "")}
            placeholder="写实风格，8K，超精细"
            color="violet"
          />
        </div>
      )}

      {/* Image-to-Video sub-elements */}
      {sections.includes("motion") && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-400">
            <Video size={11} />
            {t("wizard.sectionVideo")}
          </div>
          <PromptField
            label={t("wizard.promptAction")}
            value={shot.actionDesc ?? ""}
            onChange={(v) => handleChange("actionDesc", v)}
            onAiAssist={() => handleAiAssist("actionDesc", shot.actionDesc ?? "")}
            placeholder="缓缓转头，温柔微笑"
            color="amber"
          />
          <PromptField
            label={t("wizard.promptCamera")}
            value={shot.cameraDesc ?? ""}
            onChange={(v) => handleChange("cameraDesc", v)}
            onAiAssist={() => handleAiAssist("cameraDesc", shot.cameraDesc ?? "")}
            placeholder="镜头缓缓推进，特写跟踪镜头"
            color="amber"
          />
          <PromptField
            label={t("wizard.promptEnvChange")}
            value={shot.envChangeDesc ?? ""}
            onChange={(v) => handleChange("envChangeDesc", v)}
            onAiAssist={() => handleAiAssist("envChangeDesc", shot.envChangeDesc ?? "")}
            placeholder="咖啡杯蒸汽上升，窗外树叶摇曳"
            color="amber"
          />
          <PromptField
            label={t("wizard.promptMotionSpeed")}
            value={shot.motionSpeedDesc ?? ""}
            onChange={(v) => handleChange("motionSpeedDesc", v)}
            onAiAssist={() => handleAiAssist("motionSpeedDesc", shot.motionSpeedDesc ?? "")}
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
            placeholder="解刨异常，多余肢体，模糊，变形"
            color="red"
            rows={1}
          />
          <PromptField
            label={t("wizard.negativeMotionPrompt")}
            value={shot.negativeMotionPrompt ?? ""}
            onChange={(v) => handleChange("negativeMotionPrompt", v)}
            placeholder="变形，闪烁，突兀剪辑，镜头抖动"
            color="red"
            rows={1}
          />
        </div>
      )}
    </div>
  );
}
