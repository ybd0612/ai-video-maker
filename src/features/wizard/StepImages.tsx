// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/StepImages.tsx
// Step 4: Generate images for all shots, with re-roll support.
// ────────────────────────────────────────────────────────────────────────────

import { useEffect } from "react";
import { useProjectStore, selectActiveProject } from "@/stores/projectStore";
import { useT } from "@/i18n";
import { ShotCard } from "./ShotCard";
import { PromptSubFields } from "./PromptSubFields";
import { Lightbox } from "@/components/ui/Lightbox";
import { useWizardActions } from "./useWizardActions";
import { ReviewCheckpoint } from "./ReviewCheckpoint";
import { RefreshCw } from "lucide-react";

export function StepImages() {
  const t = useT();
  const project = useProjectStore(selectActiveProject);
  const setWizardStep = useProjectStore((s) => s.setWizardStep);
  const { generateImagesForStep, rerollImage } = useWizardActions();

  const shots = project?.shots ?? [];
  const allImaged = shots.length > 0 && shots.every((s) => !!s.imageUrl);
  const generatingCount = shots.filter((s) => s.status === "imaging").length;
  const imageGenerationStarted = project?.imageGenerationStarted ?? false;

  // 自动开始/恢复图片生成：首次进入触发，切回时继续未完成的 shot
  useEffect(() => {
    if (shots.length > 0) {
      const needsImages = shots.some((s) => !s.imageUrl);
      if (needsImages) {
        generateImagesForStep();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageGenerationStarted, shots.length]);

  // auto 模式：所有图片完成后自动推进到 Step 5（跳过审核卡点）
  useEffect(() => {
    if (allImaged && project?.automationMode === "auto") {
      setWizardStep(5);
    }
  }, [allImaged, project?.automationMode, setWizardStep]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 py-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-200">
          {t("wizard.step4")} ({shots.filter((s) => !!s.imageUrl).length}/{shots.length})
        </h2>
        <div className="flex items-center gap-2">
          {generatingCount > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-violet-400">
              <RefreshCw size={11} className="animate-spin" />
              {generatingCount} {t("wizard.generating")}
            </span>
          )}
          <button
            onClick={() => shots.forEach((s) => s.imageUrl && rerollImage(s.id))}
            disabled={generatingCount > 0}
            className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-emerald-400 hover:bg-emerald-950/30 transition disabled:opacity-50"
          >
            <RefreshCw size={11} />
            {t("wizard.rerollAll")}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {shots.map((shot) => (
          <ShotCard
            key={shot.id}
            shot={shot}
            mode="image"
            onReroll={() => rerollImage(shot.id)}
            isGenerating={shot.status === "imaging"}
          >
            {shot.imageUrl && (
              <Lightbox src={shot.imageUrl} alt={`Shot ${shot.index + 1}`}>
                <div className="overflow-hidden rounded-md border border-slate-700">
                  <img
                    src={shot.imageUrl}
                    alt={`Shot ${shot.index + 1}`}
                    className="w-full object-contain max-h-48"
                  />
                </div>
              </Lightbox>
            )}
            <PromptSubFields shotId={shot.id} sections={["image", "negative"]} />
          </ShotCard>
        ))}
      </div>

      {allImaged && (
        <ReviewCheckpoint
          mode={project?.automationMode ?? "semi-auto"}
          onConfirm={() => setWizardStep(5)}
          onSkip={() => setWizardStep(5)}
        />
      )}
    </div>
  );
}
