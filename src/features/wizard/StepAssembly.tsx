// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/StepAssembly.tsx
// Step 6: Preview all videos in sequence, concatenate, download.
// ────────────────────────────────────────────────────────────────────────────

import { useState, useCallback, useEffect, useRef } from "react";
import { useProjectStore, selectActiveProject } from "@/stores/projectStore";
import { useT } from "@/i18n";
import { concatenateVideos } from "@/services/renderService";
import { Download, Loader2, Film, Square } from "lucide-react";

export function StepAssembly() {
  const t = useT();
  const project = useProjectStore(selectActiveProject);
  const setProjectStatusById = useProjectStore((s) => s.setProjectStatusById);

  const shots = project?.shots ?? [];
  const videoShots = shots.filter((s) => s.videoUrl);
  const missingShots = shots.filter((s) => !s.videoUrl);
  const canRender = shots.length > 0 && missingShots.length === 0;

  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderedUrl, setRenderedUrl] = useState<string | null>(null);
  const renderAbortRef = useRef<AbortController | null>(null);
  const renderedUrlRef = useRef<string | null>(null);
  const renderedProjectIdRef = useRef<string | null>(project?.id ?? null);

  // 活动项目切换后，旧项目的成片不能继续显示；同时释放旧 Blob URL。
  useEffect(() => {
    const nextProjectId = project?.id ?? null;
    if (renderedProjectIdRef.current !== nextProjectId) {
      if (renderedUrlRef.current) {
        URL.revokeObjectURL(renderedUrlRef.current);
        renderedUrlRef.current = null;
      }
      setRenderedUrl(null);
      setRenderProgress(0);
      setRenderError(null);
      setIsRendering(false);
      renderedProjectIdRef.current = nextProjectId;
    }
  }, [project?.id]);

  // 组件卸载时释放当前成片 Blob URL，避免内存泄漏。
  useEffect(() => {
    return () => {
      if (renderedUrlRef.current) {
        URL.revokeObjectURL(renderedUrlRef.current);
      }
    };
  }, []);

  // auto 模式：镜头视频齐全时自动拼接成片（一条龙收尾）。
  // 仅在本次观察期间「从未就绪到就绪」触发一次；已有成片 / 拼接失败后
  // 不自动重试（失败走手动按钮）。autoRenderRef 挡 StrictMode 双挂载重复调用。
  const autoRenderRef = useRef(false);
  useEffect(() => {
    if (autoRenderRef.current) return;
    if (project?.automationMode !== "auto") return;
    if (!canRender || isRendering || renderedUrl) return;
    autoRenderRef.current = true;
    void handleRender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.automationMode, canRender, isRendering, renderedUrl]);

  const handleRender = useCallback(async () => {
    if (!canRender || !project) return;
    const targetProjectId = project.id;
    const controller = new AbortController();
    renderAbortRef.current = controller;
    setIsRendering(true);
    setRenderProgress(0);
    setRenderError(null);
    setProjectStatusById(targetProjectId, "rendering");

    try {
      const urls = videoShots.map((s) => s.videoUrl!);
      const url = await concatenateVideos({
        videoUrls: urls,
        onProgress: setRenderProgress,
        signal: controller.signal,
      });
      const activeProjectId = useProjectStore.getState().activeProjectId;
      if (activeProjectId !== targetProjectId) {
        URL.revokeObjectURL(url);
        return;
      }
      if (renderedUrlRef.current) {
        URL.revokeObjectURL(renderedUrlRef.current);
      }
      renderedUrlRef.current = url;
      renderedProjectIdRef.current = targetProjectId;
      setRenderedUrl(url);
      setProjectStatusById(targetProjectId, "done");
    } catch (err) {
      // 用户取消拼接：不视为失败，复位状态并允许重新拼接
      if (controller.signal.aborted) {
        setProjectStatusById(targetProjectId, "idle");
        return;
      }
      console.error("Assembly failed:", err);
      setRenderError(err instanceof Error ? err.message : String(err));
      setProjectStatusById(targetProjectId, "failed", err instanceof Error ? err.message : String(err));
    } finally {
      renderAbortRef.current = null;
      setIsRendering(false);
    }
  }, [canRender, project, videoShots, setProjectStatusById]);

  /** 取消拼接：中止下载/终止 FFmpeg 进程 */
  const handleCancelRender = () => {
    renderAbortRef.current?.abort();
  };

  const handleDownload = () => {
    if (!renderedUrl || !project) return;
    const a = document.createElement("a");
    a.href = renderedUrl;
    a.download = `${project.title || "video"}.mp4`;
    a.click();
  };

  // 重新拼接：释放旧 Blob URL 后重新执行拼接（复用 handleRender 的完整性校验与状态管理）
  const handleRerender = () => {
    if (renderedUrlRef.current) {
      URL.revokeObjectURL(renderedUrlRef.current);
      renderedUrlRef.current = null;
    }
    setRenderedUrl(null);
    handleRender();
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 py-6">
      <div className="text-center">
        <h2 className="text-lg font-bold text-ink">
          {t("wizard.step6")}
        </h2>
        <p className="mt-1 text-sm text-ink-4">
          {videoShots.length}/{shots.length} {t("wizard.step5")} ready
        </p>
      </div>

      {/* 视频序列预览 */}
      <div className="flex flex-wrap gap-2">
        {videoShots.map((shot) => (
          <div key={shot.id} className="flex flex-col items-center gap-1">
            <div className="h-16 w-24 overflow-hidden rounded border border-line bg-black">
              <video
                src={shot.videoUrl!}
                className="h-full w-full object-contain"
                muted
              />
            </div>
            <span className="text-[0.5625rem] text-ink-4">
              #{shot.index + 1}
            </span>
          </div>
        ))}
      </div>

      {missingShots.length > 0 && (
        <div className="rounded-lg border border-warn bg-warn-deep/30 p-3 text-center text-xs text-warn">
          {t("pipeline.needAllVideos", { done: videoShots.length, total: shots.length })}
          <div className="mt-1 text-warn/80">
            缺少镜头：{missingShots.map((shot) => `#${shot.index + 1}`).join("、")}
          </div>
        </div>
      )}

      {/* 拼接按钮 */}
      {!renderedUrl && (
        <div className="mx-auto flex items-center gap-2">
          <button
            onClick={handleRender}
            disabled={isRendering || !canRender}
            className="flex items-center gap-2 rounded-xl bg-success-solid px-8 py-3 text-sm font-semibold text-white transition hover:bg-success-solid disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRendering ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("wizard.generating")} {renderProgress}%
              </>
            ) : (
              <>
                <Film className="h-4 w-4" />
                {t("pipeline.concatVideos")}
              </>
            )}
          </button>
          {isRendering && (
            <button
              onClick={handleCancelRender}
              className="flex items-center gap-1.5 rounded-lg bg-danger-solid px-4 py-2.5 text-sm font-medium text-white transition hover:bg-danger-solid"
            >
              <Square className="h-3.5 w-3.5" />
              {t("wizard.cancelRender")}
            </button>
          )}
        </div>
      )}

      {/* 拼接进度条 */}
      {isRendering && (
        <div className="mx-auto w-full max-w-md">
          <div className="h-2 overflow-hidden rounded-full bg-raised">
            <div
              className="h-full rounded-full bg-success-solid transition-all duration-300"
              style={{ width: `${renderProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* 拼接失败原因（含 FFmpeg 日志尾部，便于反馈定位） */}
      {renderError && (
        <div className="mx-auto w-full max-w-md rounded-lg border border-danger bg-danger-deep/30 p-3 text-left text-xs text-danger">
          <div className="font-semibold text-danger">{t("assembly.failedPrefix")}：</div>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all">{renderError}</pre>
        </div>
      )}

      {/* 成片预览与下载 */}
      {renderedUrl && (
        <div className="flex flex-col items-center gap-4">
          <div className="w-full max-w-lg overflow-hidden rounded-xl border border-line bg-black">
            <video
              src={renderedUrl}
              controls
              loop
              autoPlay
              className="w-full"
            />
          </div>
          <p className="max-w-lg text-center text-xs text-warn">
            {t("assembly.sessionPreviewHint")}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRerender}
              disabled={isRendering}
              className="flex items-center gap-2 rounded-lg bg-hover px-6 py-2.5 text-sm font-medium text-ink transition hover:bg-hover disabled:opacity-50"
            >
              <Film className="h-3.5 w-3.5" />
              {t("wizard.reassemble")}
            </button>
            <button
              onClick={handleDownload}
              className="flex items-center gap-2 rounded-lg bg-info-solid px-6 py-2.5 text-sm font-medium text-white transition hover:bg-info-solid"
            >
              <Download className="h-3.5 w-3.5" />
              {t("pipeline.download")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
