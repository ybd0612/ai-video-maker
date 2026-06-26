// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/StepVideos.tsx
// Step 4: Generate videos for all shots, with "draw card" re-roll.
// ────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef } from "react";
import { useProjectStore, selectActiveProject } from "@/stores/projectStore";
import { useT } from "@/i18n";
import { ShotCard } from "./ShotCard";
import { PromptSubFields } from "./PromptSubFields";
import { DualFrameToggle } from "./DualFrameToggle";
import { Lightbox } from "@/components/ui/Lightbox";
import { useWizardActions } from "./useWizardActions";
import { RefreshCw } from "lucide-react";

export function StepVideos() {
  const t = useT();
  const project = useProjectStore(selectActiveProject);
  const setWizardStep = useProjectStore((s) => s.setWizardStep);
  const { generateVideosForStep, rerollVideo } = useWizardActions();

  const shots = project?.shots ?? [];
  const allVideoed = shots.length > 0 && shots.every((s) => !!s.videoUrl);
  const generatingCount = shots.filter((s) => s.status === "videoing").length;
  const hasStarted = useRef(false);

  // Auto-generate videos when entering this step
  useEffect(() => {
    if (!hasStarted.current && shots.length > 0) {
      const needsVideos = shots.some((s) => !s.videoUrl && s.imageUrl);
      if (needsVideos) {
        hasStarted.current = true;
        generateVideosForStep();
      }
    }
  }, [shots.length, generateVideosForStep]);

  const handleRerollAll = () => {
    shots.forEach((shot) => {
      if (shot.videoUrl) {
        rerollVideo(shot.id);
      }
    });
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 py-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-200">
          {t("wizard.step4")} ({shots.filter((s) => !!s.videoUrl).length}/{shots.length})
        </h2>
        <div className="flex items-center gap-2">
          {generatingCount > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-amber-400">
              <RefreshCw size={11} className="animate-spin" />
              {generatingCount} {t("wizard.generating")}
            </span>
          )}
          <button
            onClick={handleRerollAll}
            disabled={generatingCount > 0}
            className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-emerald-400 hover:bg-emerald-950/30 transition disabled:opacity-50"
          >
            <RefreshCw size={11} />
            {t("wizard.rerollAll")}
          </button>
          {allVideoed && (
            <button
              onClick={() => setWizardStep(4)}
              className="flex items-center gap-1 rounded bg-emerald-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-emerald-500 transition"
            >
              {t("wizard.next")} →
            </button>
          )}
        </div>
      </div>

      {/* Shot cards with videos */}
      <div className="flex flex-col gap-2">
        {shots.map((shot) => (
          <ShotCard
            key={shot.id}
            shot={shot}
            mode="video"
            onReroll={() => rerollVideo(shot.id)}
            isGenerating={shot.status === "videoing"}
          >
            {/* Show reference image + generated video side by side */}
            <div className="flex gap-2">
              {shot.imageUrl && (
                <Lightbox src={shot.imageUrl} alt={`Ref ${shot.index + 1}`}>
                  <div className="w-1/3 overflow-hidden rounded-md border border-slate-700">
                    <img
                      src={shot.imageUrl}
                      alt={`Ref ${shot.index + 1}`}
                      className="w-full object-cover h-24"
                    />
                  </div>
                </Lightbox>
              )}
              {shot.videoUrl ? (
                <div className="flex-1 overflow-hidden rounded-md border border-slate-700">
                  <video
                    src={shot.videoUrl}
                    controls
                    loop
                    className="w-full h-24 object-contain bg-black"
                  />
                </div>
              ) : shot.status === "videoing" ? (
                <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-amber-700 bg-amber-950/10 h-24">
                  <div className="flex flex-col items-center gap-1">
                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full bg-amber-500 transition-all duration-500"
                        style={{ width: `${shot.videoProgress ?? 0}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-amber-400">
                      {shot.videoProgress ?? 0}%
                    </span>
                    {shot.videoRetryCount && shot.videoRetryCount > 0 && (
                      <span className="text-[9px] text-slate-500">
                        Retry {shot.videoRetryCount}/3
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-slate-700 bg-slate-800/30 h-24">
                  <span className="text-[10px] text-slate-600">Waiting...</span>
                </div>
              )}
            </div>

            {/* Edit motion sub-elements */}
            <PromptSubFields
              shotId={shot.id}
              sections={["motion", "negative"]}
            />

            {/* 首尾帧控制 */}
            <DualFrameToggle shot={shot} />
          </ShotCard>
        ))}
      </div>
    </div>
  );
}
