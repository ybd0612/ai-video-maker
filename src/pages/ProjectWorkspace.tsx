// ────────────────────────────────────────────────────────────────────────────
// src/pages/ProjectWorkspace.tsx
// Main page: replaces CanvasWorkspace with the pipeline-based UI.
// Layout: left shot list | center preview | right shot editor.
// ────────────────────────────────────────────────────────────────────────────

import { useState, useCallback, useRef } from "react";
import { useProjectStore, type Shot } from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useT } from "@/i18n";
import { ScriptPanel } from "@/features/script/ScriptPanel";
import { ShotList } from "@/features/shots/ShotList";
import { ShotEditor } from "@/features/shots/ShotEditor";
import { ShotPreview } from "@/features/preview/ShotPreview";
import { runPipeline } from "@/services/pipelineService";
import { generateScript } from "@/services/scriptService";
import { generateImage, aspectRatioToImageSize } from "@/services/imageService";
import { generateVideo, aspectRatioToVideoSize } from "@/services/videoService";
import { Settings, Trash2, Play, Square } from "lucide-react";
import { ApiKeyBanner } from "@/components/ApiKeyBanner";
import { confirmDialog } from "@/components/ui/ConfirmDialog";

type AspectRatio = "9:16" | "16:9" | "1:1";

export function ProjectWorkspace() {
  const t = useT();
  const project = useProjectStore((s) => s.project);
  const createProject = useProjectStore((s) => s.createProject);
  const updateProject = useProjectStore((s) => s.updateProject);
  const clearProject = useProjectStore((s) => s.clearProject);
  const setShots = useProjectStore((s) => s.setShots);
  const setShotStatus = useProjectStore((s) => s.setShotStatus);
  const updateShot = useProjectStore((s) => s.updateShot);
  const openSettings = useSettingsStore((s) => s.setSettingsDialogOpen);

  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
  const [isScripting, setIsScripting] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [hasProject, setHasProject] = useState(!!project);
  const abortRef = useRef<AbortController | null>(null);

  // Create project if needed, then generate script
  const handleGenerateScript = useCallback(
    async (prompt: string) => {
      const { providerConfig } = useSettingsStore.getState();
      if (!providerConfig.apiKey || !providerConfig.baseUrl) {
        openSettings(true);
        return;
      }

      let proj = useProjectStore.getState().project;
      if (!proj) {
        proj = createProject(prompt.slice(0, 30) || t("pipeline.newProject"), prompt);
        setHasProject(true);
      }

      setIsScripting(true);
      try {
        const rawShots = await generateScript({
          apiKey: providerConfig.apiKey,
          baseUrl: providerConfig.baseUrl,
          prompt,
          language: proj.language,
          aspectRatio: proj.aspectRatio,
        });

        const shots: Shot[] = rawShots.map((s, i) => ({
          id: `shot_${Date.now()}_${i}`,
          index: i,
          status: "scripted" as const,
          ...s,
        }));

        setShots(shots);
      } catch (err) {
        alert(err instanceof Error ? err.message : String(err));
      } finally {
        setIsScripting(false);
      }
    },
    [createProject, setShots, openSettings, t],
  );

  // Run full pipeline
  const handleRunAll = useCallback(async () => {
    const proj = useProjectStore.getState().project;
    if (!proj || proj.shots.length === 0) return;

    setIsRunning(true);
    abortRef.current = new AbortController();

    try {
      await runPipeline("", {
        signal: abortRef.current.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.message !== "Pipeline cancelled.") {
        alert(err.message);
      }
    } finally {
      setIsRunning(false);
      abortRef.current = null;
    }
  }, []);

  // Cancel running pipeline
  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // Regenerate image for a single shot
  const handleRegenerateImage = useCallback(async (shotId: string) => {
    const { providerConfig } = useSettingsStore.getState();
    if (!providerConfig.apiKey || !providerConfig.baseUrl) return;

    const proj = useProjectStore.getState().project;
    if (!proj) return;

    const shot = proj.shots.find((s) => s.id === shotId);
    if (!shot) return;

    setShotStatus(shotId, "imaging");
    try {
      const size = aspectRatioToImageSize(proj.aspectRatio);
      const imageUrl = await generateImage({
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        prompt: shot.visualPrompt,
        size,
      });
      updateShot(shotId, { imageUrl, status: "imaged" });
    } catch (err) {
      setShotStatus(shotId, "failed", err instanceof Error ? err.message : String(err));
    }
  }, [setShotStatus, updateShot]);

  // Regenerate video for a single shot
  const handleRegenerateVideo = useCallback(async (shotId: string) => {
    const { providerConfig } = useSettingsStore.getState();
    if (!providerConfig.apiKey || !providerConfig.baseUrl) return;

    const proj = useProjectStore.getState().project;
    if (!proj) return;

    const shot = proj.shots.find((s) => s.id === shotId);
    if (!shot || !shot.imageUrl) return;

    setShotStatus(shotId, "videoing");
    try {
      const size = aspectRatioToVideoSize(proj.aspectRatio);
      const result = await generateVideo({
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        prompt: shot.visualPrompt,
        imageUrl: shot.imageUrl,
        size,
        duration: shot.duration,
      });
      updateShot(shotId, { videoUrl: result.videoUrl, status: "videoed" });
    } catch (err) {
      setShotStatus(shotId, "failed", err instanceof Error ? err.message : String(err));
    }
  }, [setShotStatus, updateShot]);

  // Clear project
  const handleClear = useCallback(async () => {
    const ok = await confirmDialog({
      title: t("pipeline.clearProject"),
      message: t("pipeline.clearConfirm"),
      confirmLabel: t("dialog.confirm"),
      variant: "danger",
    });
    if (ok) {
      clearProject();
      setSelectedShotId(null);
      setHasProject(false);
    }
  }, [clearProject, t]);

  const selectedShot = project?.shots.find((s) => s.id === selectedShotId) ?? null;
  const shots = project?.shots ?? [];

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-950">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold text-slate-100">
            {t("pipeline.title")}
          </h1>
          {project && (
            <span className="text-xs text-slate-500">
              {project.title}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Aspect ratio selector */}
          {project && (
            <select
              value={project.aspectRatio}
              onChange={(e) => updateProject({ aspectRatio: e.target.value as AspectRatio })}
              className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-300 focus:outline-none"
            >
              <option value="16:9">16:9</option>
              <option value="9:16">9:16</option>
              <option value="1:1">1:1</option>
            </select>
          )}

          {/* Run all / Cancel */}
          {shots.length > 0 && (
            isRunning ? (
              <button
                onClick={handleCancel}
                className="flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500"
              >
                <Square size={12} />
                {t("pipeline.cancel")}
              </button>
            ) : (
              <button
                onClick={handleRunAll}
                className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
              >
                <Play size={12} />
                {t("pipeline.runAll")}
              </button>
            )
          )}

          {/* Settings */}
          <button
            onClick={() => openSettings(true)}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
            title={t("sidebar.settings")}
          >
            <Settings size={14} />
          </button>

          {/* Clear */}
          {project && (
            <button
              onClick={handleClear}
              className="rounded-md p-1.5 text-slate-500 hover:bg-red-950 hover:text-red-400"
              title={t("pipeline.clearProject")}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </header>

      <ApiKeyBanner />

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel: shot list */}
        <aside className="flex w-60 flex-col border-r border-slate-800 bg-slate-950">
          <div className="border-b border-slate-800 px-3 py-2">
            <span className="text-xs font-medium text-slate-400">
              {t("pipeline.shots")} ({shots.length})
            </span>
          </div>
          <ShotList
            selectedShotId={selectedShotId}
            onSelect={setSelectedShotId}
          />
        </aside>

        {/* Center: preview or script input */}
        <main className="flex-1 overflow-hidden">
          {!hasProject && shots.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <div className="w-full max-w-lg">
                <ScriptPanel onGenerate={handleGenerateScript} isGenerating={isScripting} />
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col">
              {/* Pipeline progress bar */}
              {shots.length > 0 && (
                <PipelineProgress shots={shots} isRunning={isRunning} />
              )}
              <div className="flex-1 overflow-y-auto">
                <ShotPreview shotId={selectedShotId} />
              </div>
            </div>
          )}
        </main>

        {/* Right panel: shot editor */}
        {shots.length > 0 && (
          <aside className="w-72 border-l border-slate-800 bg-slate-950">
            <ShotEditor
              shot={selectedShot}
              onClose={() => setSelectedShotId(null)}
              onRegenerateImage={handleRegenerateImage}
              onRegenerateVideo={handleRegenerateVideo}
              isProcessing={isRunning}
            />
          </aside>
        )}
      </div>
    </div>
  );
}

/* ── Pipeline progress bar ──────────────────────────────────────────────── */

function PipelineProgress({
  shots,
  isRunning,
}: {
  shots: Shot[];
  isRunning: boolean;
}) {
  const t = useT();
  const total = shots.length;
  const scripted = shots.filter((s) =>
    ["scripted", "imaging", "imaged", "videoing", "videoed"].includes(s.status),
  ).length;
  const imaged = shots.filter((s) =>
    ["imaged", "videoing", "videoed"].includes(s.status),
  ).length;
  const videoed = shots.filter((s) => s.status === "videoed").length;
  const failed = shots.filter((s) => s.status === "failed").length;

  const phases = [
    { label: t("pipeline.phaseScript"), count: scripted, total, color: "bg-sky-500" },
    { label: t("pipeline.phaseImage"), count: imaged, total, color: "bg-violet-500" },
    { label: t("pipeline.phaseVideo"), count: videoed, total, color: "bg-amber-500" },
  ];

  return (
    <div className="flex items-center gap-4 border-b border-slate-800 px-4 py-2">
      {phases.map((phase) => (
        <div key={phase.label} className="flex items-center gap-2">
          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-800">
            <div
              className={`h-full rounded-full transition-all ${phase.color}`}
              style={{ width: `${total > 0 ? (phase.count / total) * 100 : 0}%` }}
            />
          </div>
          <span className="text-[10px] text-slate-500">
            {phase.label} {phase.count}/{total}
          </span>
        </div>
      ))}
      {failed > 0 && (
        <span className="text-[10px] text-red-400">
          {failed} {t("pipeline.failed")}
        </span>
      )}
      {isRunning && (
        <span className="text-[10px] text-emerald-400 animate-pulse">
          {t("pipeline.running")}
        </span>
      )}
    </div>
  );
}


