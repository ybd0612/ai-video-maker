// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/StepVideos.tsx
// Step 5: Generate videos for all shots, with dual-frame control.
// ────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useRef } from "react";
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
  const videoedCount = shots.filter((s) => !!s.videoUrl).length;
  const allVideoed = shots.length > 0 && shots.every((s) => !!s.videoUrl);
  const failedCount = shots.filter((s) => s.status === "failed").length;
  const generatingCount = shots.filter((s) => s.status === "videoing").length;
  const videoGenerationStarted = project?.videoGenerationStarted ?? false;

  // 生成完成 toast：allVideoed 从 false→true 时短暂提示
  const [showDoneToast, setShowDoneToast] = useState(false);
  const prevAllVideoedRef = useRef(allVideoed);
  useEffect(() => {
    if (allVideoed && !prevAllVideoedRef.current) {
      setShowDoneToast(true);
      const timer = setTimeout(() => setShowDoneToast(false), 4000);
      prevAllVideoedRef.current = allVideoed;
      return () => clearTimeout(timer);
    }
    prevAllVideoedRef.current = allVideoed;
  }, [allVideoed]);

  // 自动开始/恢复视频生成：首次进入触发，切回时继续未完成的 shot
  useEffect(() => {
    if (shots.length > 0) {
      const needsVideos = shots.some((s) => !s.videoUrl && s.imageUrl);
      if (needsVideos) {
        generateVideosForStep();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoGenerationStarted, shots.length]);

  // auto 模式：所有视频完成后自动推进到 Step 6
  useEffect(() => {
    if (allVideoed && project?.automationMode === "auto") {
      setWizardStep(6);
    }
  }, [allVideoed, project?.automationMode, setWizardStep]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 py-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-200">
          {t("wizard.step5")} ({videoedCount}/{shots.length})
        </h2>
        <div className="flex items-center gap-2">
          {generatingCount > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-amber-400">
              <RefreshCw size={11} className="animate-spin" />
              {generatingCount} {t("wizard.generating")}
            </span>
          )}
          {failedCount > 0 && (
            <button
              onClick={() => shots.filter((s) => s.status === "failed" && s.imageUrl).forEach((s) => rerollVideo(s.id))}
              disabled={generatingCount > 0}
              className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-red-400 hover:bg-red-950/30 transition disabled:opacity-50"
            >
              <RefreshCw size={11} />
              {t("wizard.retryFailed")} ({failedCount})
            </button>
          )}
          <button
            onClick={() => shots.forEach((s) => s.videoUrl && rerollVideo(s.id))}
            disabled={generatingCount > 0}
            className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-emerald-400 hover:bg-emerald-950/30 transition disabled:opacity-50"
          >
            <RefreshCw size={11} />
            {t("wizard.rerollAll")}
          </button>
        </div>
      </div>

      {/* 步骤级进度条 */}
      {shots.length > 0 && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full bg-amber-500 transition-all duration-300"
            style={{ width: `${(videoedCount / shots.length) * 100}%` }}
          />
        </div>
      )}

      {/* 生成完成 toast */}
      {showDoneToast && (
        <div className="rounded-lg border border-emerald-700 bg-emerald-950/40 px-4 py-2.5 text-center text-xs text-emerald-300">
          ✓ {t("wizard.videosDone")}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {shots.map((shot) => (
          <ShotCard
            key={shot.id}
            shot={shot}
            mode="video"
            onReroll={() => rerollVideo(shot.id)}
            isGenerating={shot.status === "videoing"}
          >
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
                  <span className="text-[10px] text-slate-600">{t("wizard.waiting")}</span>
                </div>
              )}
            </div>

            <PromptSubFields shotId={shot.id} sections={["motion", "negative"]} />

            {/* 首尾帧控制 */}
            <DualFrameToggle shot={shot} />
          </ShotCard>
        ))}
      </div>

      {allVideoed && (
        <div className="text-center text-emerald-400 text-xs">
          ✓ {t("wizard.allReady")}
        </div>
      )}
    </div>
  );
}
