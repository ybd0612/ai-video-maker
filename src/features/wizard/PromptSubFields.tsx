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
            {t("wizard.promptSubject").replace("wizard.promptSubject", "文生图")}
          </div>
          <PromptField
            label={t("wizard.promptSubject")}
            value={shot.subjectDesc ?? ""}
            onChange={(v) => handleChange("subjectDesc", v)}
            onAiAssist={() => handleAiAssist("subjectDesc", shot.subjectDesc ?? "")}
            placeholder="A young woman with long dark hair"
            color="violet"
          />
          <PromptField
            label={t("wizard.promptScene")}
            value={shot.sceneDesc ?? ""}
            onChange={(v) => handleChange("sceneDesc", v)}
            onAiAssist={() => handleAiAssist("sceneDesc", shot.sceneDesc ?? "")}
            placeholder="sitting in a sunlit cafe by the window"
            color="violet"
          />
          <PromptField
            label={t("wizard.promptDetail")}
            value={shot.detailDesc ?? ""}
            onChange={(v) => handleChange("detailDesc", v)}
            onAiAssist={() => handleAiAssist("detailDesc", shot.detailDesc ?? "")}
            placeholder="wearing a white blouse, delicate jewelry"
            color="violet"
          />
          <PromptField
            label={t("wizard.promptLighting")}
            value={shot.lightingDesc ?? ""}
            onChange={(v) => handleChange("lightingDesc", v)}
            onAiAssist={() => handleAiAssist("lightingDesc", shot.lightingDesc ?? "")}
            placeholder="warm golden hour light, cinematic rim light"
            color="violet"
          />
          <PromptField
            label={t("wizard.promptStyle")}
            value={shot.styleDesc ?? ""}
            onChange={(v) => handleChange("styleDesc", v)}
            onAiAssist={() => handleAiAssist("styleDesc", shot.styleDesc ?? "")}
            placeholder="photorealistic, 8k, ultra-detailed"
            color="violet"
          />
        </div>
      )}

      {/* Image-to-Video sub-elements */}
      {sections.includes("motion") && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-400">
            <Video size={11} />
            {t("wizard.promptAction").replace("wizard.promptAction", "图生视频")}
          </div>
          <PromptField
            label={t("wizard.promptAction")}
            value={shot.actionDesc ?? ""}
            onChange={(v) => handleChange("actionDesc", v)}
            onAiAssist={() => handleAiAssist("actionDesc", shot.actionDesc ?? "")}
            placeholder="slowly turns her head and smiles gently"
            color="amber"
          />
          <PromptField
            label={t("wizard.promptCamera")}
            value={shot.cameraDesc ?? ""}
            onChange={(v) => handleChange("cameraDesc", v)}
            onAiAssist={() => handleAiAssist("cameraDesc", shot.cameraDesc ?? "")}
            placeholder="camera slowly dollies in, close-up tracking shot"
            color="amber"
          />
          <PromptField
            label={t("wizard.promptEnvChange")}
            value={shot.envChangeDesc ?? ""}
            onChange={(v) => handleChange("envChangeDesc", v)}
            onAiAssist={() => handleAiAssist("envChangeDesc", shot.envChangeDesc ?? "")}
            placeholder="steam rising from the coffee cup, leaves swaying outside"
            color="amber"
          />
          <PromptField
            label={t("wizard.promptMotionSpeed")}
            value={shot.motionSpeedDesc ?? ""}
            onChange={(v) => handleChange("motionSpeedDesc", v)}
            onAiAssist={() => handleAiAssist("motionSpeedDesc", shot.motionSpeedDesc ?? "")}
            placeholder="cinematic slow-motion, 24fps"
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
            placeholder="bad anatomy, extra limbs, blurry, deformed"
            color="red"
            rows={1}
          />
          <PromptField
            label={t("wizard.negativeMotionPrompt")}
            value={shot.negativeMotionPrompt ?? ""}
            onChange={(v) => handleChange("negativeMotionPrompt", v)}
            placeholder="morphing, flickering, sudden cuts, shaky camera"
            color="red"
            rows={1}
          />
        </div>
      )}
    </div>
  );
}
