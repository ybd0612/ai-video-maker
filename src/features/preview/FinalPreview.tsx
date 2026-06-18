// ────────────────────────────────────────────────────────────────────────────
// src/features/preview/FinalPreview.tsx
// Shows the concatenated final video and a download button.
// ────────────────────────────────────────────────────────────────────────────

import { useState, useCallback } from "react";
import { useProjectStore } from "@/stores/projectStore";
import { useT } from "@/i18n";
import { concatenateVideos } from "@/services/renderService";
import { Download, Loader2, Scissors } from "lucide-react";

export function FinalPreview() {
  const project = useProjectStore((s) => s.project);
  const t = useT();
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderedUrl, setRenderedUrl] = useState<string | null>(null);

  const shots = project?.shots ?? [];
  const videoedShots = shots.filter((s) => s.videoUrl);
  const canRender = videoedShots.length === shots.length && shots.length > 0;

  const handleRender = useCallback(async () => {
    if (!canRender) return;
    setIsRendering(true);
    setRenderProgress(0);
    try {
      const urls = shots.map((s) => s.videoUrl!);
      const url = await concatenateVideos({
        videoUrls: urls,
        onProgress: setRenderProgress,
      });
      setRenderedUrl(url);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRendering(false);
    }
  }, [canRender, shots]);

  const handleDownload = useCallback(() => {
    if (!renderedUrl) return;
    const a = document.createElement("a");
    a.href = renderedUrl;
    a.download = `${project?.title ?? "video"}.mp4`;
    a.click();
  }, [renderedUrl, project?.title]);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-slate-100">
          {t("pipeline.finalVideo")}
        </h2>
        <p className="text-xs text-slate-500">
          {t("pipeline.finalVideoHint")}
        </p>
      </div>

      {/* Render button */}
      {!renderedUrl && (
        <button
          onClick={handleRender}
          disabled={!canRender || isRendering}
          className="flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isRendering ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              {t("pipeline.rendering")} {renderProgress}%
            </>
          ) : (
            <>
              <Scissors size={14} />
              {t("pipeline.concatVideos")}
            </>
          )}
        </button>
      )}

      {/* Render progress */}
      {isRendering && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-300"
            style={{ width: `${renderProgress}%` }}
          />
        </div>
      )}

      {/* Not all shots ready */}
      {!canRender && !isRendering && (
        <div className="rounded-md border border-slate-700 bg-slate-800/50 p-3 text-xs text-slate-400">
          {t("pipeline.needAllVideos", {
            done: videoedShots.length,
            total: shots.length,
          })}
        </div>
      )}

      {/* Output video */}
      {renderedUrl && (
        <div className="space-y-3">
          <video
            src={renderedUrl}
            controls
            loop
            className="w-full rounded-lg border border-slate-700"
          />
          <button
            onClick={handleDownload}
            className="flex items-center justify-center gap-1.5 rounded-md bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-500"
          >
            <Download size={12} />
            {t("pipeline.download")}
          </button>
        </div>
      )}
    </div>
  );
}
