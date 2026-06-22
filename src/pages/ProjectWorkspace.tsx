// ────────────────────────────────────────────────────────────────────────────
// src/pages/ProjectWorkspace.tsx
// Main page: pipeline-based UI with multi-project management.
// Layout: left sidebar (projects/shots) | center preview | right editor.
// ────────────────────────────────────────────────────────────────────────────

import { useState, useCallback, useRef, useEffect } from "react";
import { useProjectStore, selectActiveProject, type Shot } from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useT } from "@/i18n";
import { ScriptPanel } from "@/features/script/ScriptPanel";
import { ShotList } from "@/features/shots/ShotList";
import { ShotEditor } from "@/features/shots/ShotEditor";
import { ShotPreview } from "@/features/preview/ShotPreview";
import { FinalPreview } from "@/features/preview/FinalPreview";
import { runPipeline, runSingleShot, retryFailedVideos } from "@/services/pipelineService";
import { generateScript } from "@/services/scriptService";
import { generateImage, aspectRatioToImageSize } from "@/services/imageService";
import { generateVideo, aspectRatioToVideoSize } from "@/services/videoService";
import { SYSTEM_PROMPT_SCRIPT_TEXT, SYSTEM_PROMPT_VISUAL_PROMPT, SYSTEM_PROMPT_MAIN_PROMPT, SYSTEM_PROMPT_MOTION_PROMPT } from "@/services/chatService";
import { AiAssistDrawer } from "@/components/ui/AiAssistDrawer";
import { ModeToggle } from "@/components/ui/ModeToggle";
import { CharacterPanel } from "@/features/characters/CharacterPanel";
import { ProjectSidebar } from "@/features/projects/ProjectSidebar";
import { HistoryPanel } from "@/features/history/HistoryPanel";
import {
  Settings, Trash2, Play, Square, RotateCcw,
  FolderOpen, Clock, Layers,
} from "lucide-react";
import { ApiKeyBanner } from "@/components/ApiKeyBanner";
import { confirmDialog } from "@/components/ui/ConfirmDialog";

type AspectRatio = "9:16" | "16:9" | "1:1";
type LeftTab = "projects" | "shots" | "characters" | "history";

export function ProjectWorkspace() {
  const t = useT();
  const project = useProjectStore(selectActiveProject);
  const projects = useProjectStore((s) => s.projects);
  const createProject = useProjectStore((s) => s.createProject);
  const updateProject = useProjectStore((s) => s.updateProject);
  const clearProject = useProjectStore((s) => s.clearProject);
  const setShots = useProjectStore((s) => s.setShots);
  const setShotStatus = useProjectStore((s) => s.setShotStatus);
  const updateShot = useProjectStore((s) => s.updateShot);
  const addHistory = useProjectStore((s) => s.addHistory);
  const openSettings = useSettingsStore((s) => s.setSettingsDialogOpen);

  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
  const [isScripting, setIsScripting] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [previewTab, setPreviewTab] = useState<"shot" | "final">("shot");
  const [leftTab, setLeftTab] = useState<LeftTab>("shots");
  const abortRef = useRef<AbortController | null>(null);

  // AI Assist drawer state
  const [aiAssistTarget, setAiAssistTarget] = useState<{
    field: "scriptText" | "visualPrompt" | "motionPrompt" | "mainPrompt";
    shotId?: string;
    currentValue: string;
    fieldName: string;
    systemPrompt: string;
  } | null>(null);
  const [mainPromptOverride, setMainPromptOverride] = useState<string | undefined>(undefined);

  // Auto-retry failed videos on page load
  useEffect(() => {
    if (!project) return;
    const failedVideoShots = project.shots.filter(
      (s) => s.status === "failed" && s.imageUrl && !s.videoUrl && (s.videoRetryCount ?? 0) < 3,
    );
    if (failedVideoShots.length === 0) return;

    const { providerConfig } = useSettingsStore.getState();
    if (!providerConfig.apiKey || !providerConfig.baseUrl) return;

    setIsRunning(true);
    abortRef.current = new AbortController();
    retryFailedVideos({ signal: abortRef.current.signal })
      .catch(() => { /* ignore — already handled in store */ })
      .finally(() => {
        setIsRunning(false);
        abortRef.current = null;
      });
  }, [project?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // AI Assist handlers
  const handleOpenShotAiAssist = useCallback(
    (field: "scriptText" | "visualPrompt" | "motionPrompt", currentValue: string) => {
      const systemPrompt =
        field === "scriptText" ? SYSTEM_PROMPT_SCRIPT_TEXT
        : field === "visualPrompt" ? SYSTEM_PROMPT_VISUAL_PROMPT
        : SYSTEM_PROMPT_MOTION_PROMPT;
      const fieldName =
        field === "scriptText" ? t("pipeline.scriptText")
        : field === "visualPrompt" ? t("pipeline.visualPrompt")
        : t("pipeline.motionPrompt");
      setAiAssistTarget({
        field,
        shotId: selectedShotId ?? undefined,
        currentValue,
        fieldName,
        systemPrompt,
      });
    },
    [selectedShotId, t],
  );

  const handleOpenMainPromptAiAssist = useCallback(
    (currentValue: string) => {
      setAiAssistTarget({
        field: "mainPrompt",
        currentValue,
        fieldName: t("pipeline.scriptPanelTitle"),
        systemPrompt: SYSTEM_PROMPT_MAIN_PROMPT,
      });
    },
    [t],
  );

  const handleAiAssistApply = useCallback(
    (value: string) => {
      if (!aiAssistTarget) return;
      if (aiAssistTarget.field === "mainPrompt") {
        setMainPromptOverride(value);
      } else if (aiAssistTarget.shotId) {
        updateShot(aiAssistTarget.shotId, { [aiAssistTarget.field]: value });
      }
    },
    [aiAssistTarget, updateShot],
  );

  // Create project if needed, then generate script
  const handleGenerateScript = useCallback(
    async (prompt: string) => {
      const { providerConfig } = useSettingsStore.getState();
      if (!providerConfig.apiKey || !providerConfig.baseUrl) {
        openSettings(true);
        return;
      }

      let proj = selectActiveProject(useProjectStore.getState());
      if (!proj) {
        proj = createProject(prompt.slice(0, 30) || t("pipeline.newProject"));
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
        addHistory("script_generated", `生成 ${shots.length} 个分镜`);
      } catch (err) {
        alert(err instanceof Error ? err.message : String(err));
      } finally {
        setIsScripting(false);
      }
    },
    [createProject, setShots, openSettings, t, addHistory],
  );

  // Run full pipeline
  const handleRunAll = useCallback(async () => {
    const proj = selectActiveProject(useProjectStore.getState());
    if (!proj || proj.shots.length === 0) return;

    setIsRunning(true);
    abortRef.current = new AbortController();
    addHistory("pipeline_started", "开始一键成片");

    try {
      await runPipeline("", {
        signal: abortRef.current.signal,
      });
      addHistory("pipeline_completed", "一键成片完成");
    } catch (err) {
      if (err instanceof Error && err.message !== "Pipeline cancelled.") {
        alert(err.message);
        addHistory("pipeline_failed", `成片失败: ${err.message}`);
      }
    } finally {
      setIsRunning(false);
      abortRef.current = null;
    }
  }, [addHistory]);

  // Cancel running pipeline
  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // Retry all failed shots (skip script phase, only re-run image+video)
  const handleRetryFailed = useCallback(async () => {
    const proj = selectActiveProject(useProjectStore.getState());
    if (!proj) return;
    const failedShotIds = proj.shots.filter((s) => s.status === "failed").map((s) => s.id);
    if (failedShotIds.length === 0) return;
    for (const id of failedShotIds) {
      useProjectStore.getState().setShotStatus(id, "idle");
    }
    setIsRunning(true);
    abortRef.current = new AbortController();
    try {
      await Promise.allSettled(
        failedShotIds.map((id) => runSingleShot(id, { signal: abortRef.current!.signal })),
      );
    } catch (err) {
      if (err instanceof Error && err.message !== "Pipeline cancelled.") alert(err.message);
    } finally {
      setIsRunning(false);
      abortRef.current = null;
    }
  }, []);

  // Regenerate image for a single shot
  const handleRegenerateImage = useCallback(async (shotId: string) => {
    const { providerConfig } = useSettingsStore.getState();
    if (!providerConfig.apiKey || !providerConfig.baseUrl) return;

    const proj = selectActiveProject(useProjectStore.getState());
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
      addHistory("shot_regenerated", `重新生成镜头 ${shot.index + 1} 的图片`);
    } catch (err) {
      setShotStatus(shotId, "failed", err instanceof Error ? err.message : String(err));
    }
  }, [setShotStatus, updateShot, addHistory]);

  // Regenerate video for a single shot
  const handleRegenerateVideo = useCallback(async (shotId: string) => {
    const { providerConfig } = useSettingsStore.getState();
    if (!providerConfig.apiKey || !providerConfig.baseUrl) return;

    const proj = selectActiveProject(useProjectStore.getState());
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
      addHistory("shot_regenerated", `重新生成镜头 ${shot.index + 1} 的视频`);
    } catch (err) {
      setShotStatus(shotId, "failed", err instanceof Error ? err.message : String(err));
    }
  }, [setShotStatus, updateShot, addHistory]);

  // Clear project
  const handleClear = useCallback(async () => {
    const ok = await confirmDialog({
      title: t("pipeline.clearProject"),
      message: t("pipeline.clearConfirm"),
      confirmLabel: t("dialog.confirm"),
      variant: "danger",
    });
    if (ok) {
      abortRef.current?.abort();
      clearProject();
      setSelectedShotId(null);
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
          {projects.length > 1 && (
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500">
              {projects.length} {t("pipeline.projectCount")}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Mode toggle */}
          {project && <ModeToggle />}

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

          {/* Run all / Cancel / Retry */}
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
              <div className="flex items-center gap-2">
                <button
                  onClick={handleRunAll}
                  className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
                >
                  <Play size={12} />
                  {t("pipeline.runAll")}
                </button>
                {shots.some((s) => s.status === "failed") && (
                  <button
                    onClick={handleRetryFailed}
                    className="flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500"
                  >
                    <RotateCcw size={12} />
                    {t("pipeline.retryFailed")}
                  </button>
                )}
              </div>
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
        {/* Left panel: tabs for projects / shots / history */}
        <aside className="flex w-60 flex-col border-r border-slate-800 bg-slate-950">
          {/* Tab bar */}
          <div className="flex border-b border-slate-800">
            <button
              onClick={() => setLeftTab("projects")}
              className={`flex flex-1 items-center justify-center gap-1 py-2 text-[10px] font-medium transition ${
                leftTab === "projects"
                  ? "border-b-2 border-emerald-500 text-emerald-400"
                  : "text-slate-600 hover:text-slate-400"
              }`}
            >
              <FolderOpen size={10} />
              {t("pipeline.tabProjects")}
            </button>
            <button
              onClick={() => setLeftTab("shots")}
              className={`flex flex-1 items-center justify-center gap-1 py-2 text-[10px] font-medium transition ${
                leftTab === "shots"
                  ? "border-b-2 border-emerald-500 text-emerald-400"
                  : "text-slate-600 hover:text-slate-400"
              }`}
            >
              <Layers size={10} />
              {t("pipeline.shots")} ({shots.length})
            </button>
            <button
              onClick={() => setLeftTab("characters")}
              className={`flex flex-1 items-center justify-center gap-1 py-2 text-[10px] font-medium transition ${
                leftTab === "characters"
                  ? "border-b-2 border-emerald-500 text-emerald-400"
                  : "text-slate-600 hover:text-slate-400"
              }`}
            >
              🎭
              {t("characters.title")}
            </button>
            <button
              onClick={() => setLeftTab("history")}
              className={`flex flex-1 items-center justify-center gap-1 py-2 text-[10px] font-medium transition ${
                leftTab === "history"
                  ? "border-b-2 border-emerald-500 text-emerald-400"
                  : "text-slate-600 hover:text-slate-400"
              }`}
            >
              <Clock size={10} />
              {t("pipeline.tabHistory")}
            </button>
          </div>

          {/* Tab content */}
          {leftTab === "projects" && <ProjectSidebar />}
          {leftTab === "shots" && (
            <ShotList
              selectedShotId={selectedShotId}
              onSelect={setSelectedShotId}
            />
          )}
          {leftTab === "history" && <HistoryPanel />}
          {leftTab === "characters" && <CharacterPanel />}
        </aside>

        {/* Center: preview or script input */}
        <main className="flex-1 overflow-hidden">
          {!project ? (
            <div className="flex h-full items-center justify-center">
              <div className="w-full max-w-lg">
                <ScriptPanel onGenerate={handleGenerateScript} isGenerating={isScripting} onOpenAiAssist={handleOpenMainPromptAiAssist} promptOverride={mainPromptOverride} />
              </div>
            </div>
          ) : shots.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <div className="w-full max-w-lg">
                <ScriptPanel onGenerate={handleGenerateScript} isGenerating={isScripting} onOpenAiAssist={handleOpenMainPromptAiAssist} promptOverride={mainPromptOverride} />
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col">
              {/* Pipeline progress bar */}
              <PipelineProgress shots={shots} isRunning={isRunning} />
              {/* Tab switcher */}
              <div className="flex border-b border-slate-800">
                <button
                  onClick={() => setPreviewTab("shot")}
                  className={`px-4 py-1.5 text-xs font-medium transition ${
                    previewTab === "shot"
                      ? "border-b-2 border-emerald-500 text-emerald-400"
                      : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {t("pipeline.tabShot")}
                </button>
                <button
                  onClick={() => setPreviewTab("final")}
                  className={`px-4 py-1.5 text-xs font-medium transition ${
                    previewTab === "final"
                      ? "border-b-2 border-emerald-500 text-emerald-400"
                      : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {t("pipeline.tabFinal")}
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                {previewTab === "shot" ? (
                  <ShotPreview shotId={selectedShotId} />
                ) : (
                  <FinalPreview />
                )}
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
              onOpenAiAssist={handleOpenShotAiAssist}
              isProcessing={isRunning}
            />
          </aside>
        )}
      </div>

      {/* AI Assist Drawer */}
      <AiAssistDrawer
        open={aiAssistTarget !== null}
        onClose={() => setAiAssistTarget(null)}
        currentValue={aiAssistTarget?.currentValue ?? ""}
        fieldName={aiAssistTarget?.fieldName ?? ""}
        systemPrompt={aiAssistTarget?.systemPrompt ?? ""}
        onApply={handleAiAssistApply}
      />
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
