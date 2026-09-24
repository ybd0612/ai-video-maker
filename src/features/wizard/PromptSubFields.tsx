// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/PromptSubFields.tsx
// Structured review/editor for visual and motion sub-fields; full prompts remain the API SSOT.
// 每个子字段都带框内「润色 / 撤销」（AiPolishField）。
// ────────────────────────────────────────────────────────────────────────────

import { useProjectStore } from "@/stores/projectStore";
import { useT } from "@/i18n";
import { PromptField } from "./PromptField";
import {
  SYSTEM_PROMPT_VISUAL_PROMPT,
  SYSTEM_PROMPT_MOTION_PROMPT,
  rewritePromptFromFields,
} from "@/services/chatService";
import { Image, Video } from "lucide-react";
import { useSettingsStore } from "@/stores/settingsStore";

const activeRewrites = new Map<string, Promise<void>>();

interface PromptSubFieldsProps {
  shotId: string;
  /** Which sections to show */
  sections?: ("image" | "motion" | "negative")[];
}

export function PromptSubFields({
  shotId,
  sections = ["image", "motion"],
}: PromptSubFieldsProps) {
  const t = useT();
  const shot = useProjectStore((s) => {
    const project = s.projects.find((p) => p.id === s.activeProjectId);
    return project?.shots.find((sh) => sh.id === shotId);
  });
  const updateShot = useProjectStore((s) => s.updateShot);
  const apiKey = useSettingsStore((s) => s.providerConfig.apiKey);
  const baseUrl = useSettingsStore((s) => s.providerConfig.baseUrl);

  if (!shot) return null;

  const handleChange = (field: string, value: string) => {
    updateShot(shotId, { [field]: value });
  };

  const commitPrompt = (kind: "visual" | "motion") => {
    const latest = useProjectStore.getState().projects
      .flatMap((project) => project.shots)
      .find((item) => item.id === shotId);
    if (!latest || !apiKey || !baseUrl) return;
    const fields: Record<string, string> = kind === "visual"
      ? { scene: latest.sceneDesc ?? "", detail: latest.detailDesc ?? "", lighting: latest.lightingDesc ?? "", style: latest.styleDesc ?? "" }
      : { action: latest.actionDesc ?? "", camera: latest.cameraDesc ?? "", environment: latest.envChangeDesc ?? "", speed: latest.motionSpeedDesc ?? "" };
    const key = `${shotId}:${kind}`;
    if (activeRewrites.has(key)) return;
    const task = rewritePromptFromFields({ apiKey, baseUrl, kind, currentPrompt: kind === "visual" ? latest.visualPrompt : latest.motionPrompt, fields })
      .then((prompt) => useProjectStore.getState().updateShot(shotId, kind === "visual" ? { visualPrompt: prompt } : { motionPrompt: prompt }))
      .catch(() => undefined)
      .finally(() => activeRewrites.delete(key));
    activeRewrites.set(key, task);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Text-to-Image sub-elements */}
      {sections.includes("image") && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-[0.6875rem] font-semibold text-accent">
            <Image className="h-3 w-3" />
            {t("wizard.sectionImage")}
          </div>
          <PromptField
            label={t("wizard.promptScene")}
            value={shot.sceneDesc ?? ""}
            onChange={(v) => handleChange("sceneDesc", v)}
            systemPrompt={SYSTEM_PROMPT_VISUAL_PROMPT}
            onCommit={() => commitPrompt("visual")}
            resetKey={shotId}
            placeholder={t("promptPh.scene")}
            color="violet"
          />
          <PromptField
            label={t("wizard.promptDetail")}
            value={shot.detailDesc ?? ""}
            onChange={(v) => handleChange("detailDesc", v)}
            systemPrompt={SYSTEM_PROMPT_VISUAL_PROMPT}
            onCommit={() => commitPrompt("visual")}
            resetKey={shotId}
            placeholder={t("promptPh.style")}
            color="violet"
          />
          <PromptField
            label={t("wizard.promptLighting")}
            value={shot.lightingDesc ?? ""}
            onChange={(v) => handleChange("lightingDesc", v)}
            systemPrompt={SYSTEM_PROMPT_VISUAL_PROMPT}
            onCommit={() => commitPrompt("visual")}
            resetKey={shotId}
            placeholder={t("promptPh.lighting")}
            color="violet"
          />
          <PromptField
            label={t("wizard.promptStyle")}
            value={shot.styleDesc ?? ""}
            onChange={(v) => handleChange("styleDesc", v)}
            systemPrompt={SYSTEM_PROMPT_VISUAL_PROMPT}
            onCommit={() => commitPrompt("visual")}
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
            <Video className="h-3 w-3" />
            {t("wizard.sectionVideo")}
          </div>
          <PromptField
            label={t("wizard.promptAction")}
            value={shot.actionDesc ?? ""}
            onChange={(v) => handleChange("actionDesc", v)}
            systemPrompt={SYSTEM_PROMPT_MOTION_PROMPT}
            onCommit={() => commitPrompt("motion")}
            resetKey={shotId}
            placeholder={t("promptPh.motion")}
            color="amber"
          />
          <PromptField
            label={t("wizard.promptCamera")}
            value={shot.cameraDesc ?? ""}
            onChange={(v) => handleChange("cameraDesc", v)}
            systemPrompt={SYSTEM_PROMPT_MOTION_PROMPT}
            onCommit={() => commitPrompt("motion")}
            resetKey={shotId}
            placeholder={t("promptPh.camera")}
            color="amber"
          />
          <PromptField
            label={t("wizard.promptEnvChange")}
            value={shot.envChangeDesc ?? ""}
            onChange={(v) => handleChange("envChangeDesc", v)}
            systemPrompt={SYSTEM_PROMPT_MOTION_PROMPT}
            onCommit={() => commitPrompt("motion")}
            resetKey={shotId}
            placeholder={t("promptPh.environment")}
            color="amber"
          />
          <PromptField
            label={t("wizard.promptMotionSpeed")}
            value={shot.motionSpeedDesc ?? ""}
            onChange={(v) => handleChange("motionSpeedDesc", v)}
            systemPrompt={SYSTEM_PROMPT_MOTION_PROMPT}
            onCommit={() => commitPrompt("motion")}
            resetKey={shotId}
            placeholder={t("promptPh.motionQuality")}
            color="amber"
          />
        </div>
      )}

    </div>
  );
}
