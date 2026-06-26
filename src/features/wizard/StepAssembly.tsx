// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/StepAssembly.tsx
// Step 6: Preview all videos in sequence, concatenate, download.
// ────────────────────────────────────────────────────────────────────────────

import { useState, useCallback } from "react";
import { useProjectStore, selectActiveProject } from "@/stores/projectStore";
import { useT } from "@/i18n";
import { concatenateVideos } from "@/services/renderService";
import { Download, Loader2, Film } from "lucide-react";

export function StepAssembly() {
  const t = useT();
  const project = useProjectStore(selectActiveProject);
  const setProjectStatus = useProjectStore((s) => s.setProjectStatus);

  const shots = project?.shots ?? [];
  const videoShots = shots.filter((s) => s.videoUrl);

  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderedUrl, setRenderedUrl] = useState<string | null>(null);

  const handleRender = useCallback(async () => {
    if (videoShots.length === 0) return;
    setIsRendering(true);
    setRenderProgress(0);
    setProjectStatus("rendering");

    try {
      const urls = videoShots.map((s) => s.videoUrl!);
      const url = await concatenateVideos({
        videoUrls: urls,
        onProgress: setRenderProgress,
      });
      setRenderedUrl(url);
      setProjectStatus("done");
    } catch (err) {
      console.error("Assembly failed:", err);
      setProjectStatus("failed", err instanceof Error ? err.message : String(err));
    } finally {
      setIsRendering(false);
    }
  }, [videoShots, setProjectStatus]);

  const handleDownload = () => {
    if (!renderedUrl || !project) return;
    const a = document.createElement("a");
    a.href = renderedUrl;
    a.download = `${project.title || "video"}.mp4`;
    a.click();
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 py-6">
      <div className="text-center">
        <h2 className="text-lg font-bold text-slate-100">
          {t("wizard.step6")}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {videoShots.length}/{shots.length} {t("wizard.step5")} ready
        </p>
      </div>

      {/* 视频序列预览 */}
      <div className="flex flex-wrap gap-2">
        {videoShots.map((shot) => (
          <div key={shot.id} className="flex flex-col items-center gap-1">
            <div className="h-16 w-24 overflow-hidden rounded border border-slate-700 bg-black">
              <video
                src={shot.videoUrl!}
                className="h-full w-full object-contain"
                muted
              />
            </div>
            <span className="text-[9px] text-slate-500">
              #{shot.index + 1}
            </span>
          </div>
        ))}
      </div>

      {/* 拼接按钮 */}
      {!renderedUrl && (
        <button
          onClick={handleRender}
          disabled={isRendering || videoShots.length === 0}
          className="mx-auto flex items-center gap-2 rounded-xl bg-emerald-600 px-8 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isRendering ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              {t("wizard.generating")} {renderProgress}%
            </>
          ) : (
            <>
              <Film size={16} />
              {t("pipeline.concatVideos")}
            </>
          )}
        </button>
      )}

      {/* 拼接进度条 */}
      {isRendering && (
        <div className="mx-auto w-full max-w-md">
          <div className="h-2 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-300"
              style={{ width: `${renderProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* 成片预览与下载 */}
      {renderedUrl && (
        <div className="flex flex-col items-center gap-4">
          <div className="w-full max-w-lg overflow-hidden rounded-xl border border-slate-700 bg-black">
            <video
              src={renderedUrl}
              controls
              loop
              autoPlay
              className="w-full"
            />
          </div>
          <button
            onClick={handleDownload}
            className="flex items-center gap-2 rounded-lg bg-sky-600 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-sky-500"
          >
            <Download size={14} />
            {t("pipeline.download")}
          </button>
        </div>
      )}
    </div>
  );
}
