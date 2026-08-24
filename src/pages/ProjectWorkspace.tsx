// ────────────────────────────────────────────────────────────────────────────
// src/pages/ProjectWorkspace.tsx
// Main page: pipeline-based UI with multi-project management.
// Layout: left sidebar (projects/shots) | center preview | right editor.
// ────────────────────────────────────────────────────────────────────────────

import { useState, useCallback } from "react";
import { useProjectStore, selectActiveProject } from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useT } from "@/i18n";
import { ShotList } from "@/features/shots/ShotList";
import { ShotEditor } from "@/features/shots/ShotEditor";
import { SYSTEM_PROMPT_SCRIPT_TEXT, SYSTEM_PROMPT_VISUAL_PROMPT, SYSTEM_PROMPT_MOTION_PROMPT } from "@/services/chatService";
import { AiAssistDrawer } from "@/components/ui/AiAssistDrawer";
import { CharacterPanel } from "@/features/characters/CharacterPanel";
import { ProjectSidebar } from "@/features/projects/ProjectSidebar";
import { HistoryPanel } from "@/features/history/HistoryPanel";
import {
  Settings, Trash2,
  FolderOpen, Clock, Layers,
} from "lucide-react";
import { ApiKeyBanner } from "@/components/ApiKeyBanner";
import { confirmDialog } from "@/components/ui/ConfirmDialog";
import { CreationWizard } from "@/features/wizard/CreationWizard";
import { useWizardActions } from "@/features/wizard/useWizardActions";

type AspectRatio = "9:16" | "16:9" | "1:1";
type LeftTab = "projects" | "shots" | "characters" | "history";

export function ProjectWorkspace() {
  const t = useT();
  const project = useProjectStore(selectActiveProject);
  const projects = useProjectStore((s) => s.projects);
  const updateProject = useProjectStore((s) => s.updateProject);
  const clearProject = useProjectStore((s) => s.clearProject);
  const updateShot = useProjectStore((s) => s.updateShot);
  const openSettings = useSettingsStore((s) => s.setSettingsDialogOpen);
  const { rerollImage, rerollVideo } = useWizardActions();

  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
  const [leftTab, setLeftTab] = useState<LeftTab>("shots");

  // AI Assist drawer state
  const [aiAssistTarget, setAiAssistTarget] = useState<{
    field: "scriptText" | "visualPrompt" | "motionPrompt" | "mainPrompt";
    shotId?: string;
    currentValue: string;
    fieldName: string;
    systemPrompt: string;
  } | null>(null);

  // 注：失败视频的自动重试已统一由向导视频步骤（StepVideos → generateVideosForStep）接管。
  // 此前此处存在 retryFailedVideos 入口，会与向导批量生成并行，重复创建服务端视频任务（token 双倍消耗）。
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

  const handleAiAssistApply = useCallback(
    (value: string) => {
      if (!aiAssistTarget) return;
      if (aiAssistTarget.shotId) {
        updateShot(aiAssistTarget.shotId, { [aiAssistTarget.field]: value });
      }
    },
    [aiAssistTarget, updateShot],
  );

  // Run full pipeline
  // 注：旧版“一键成片”入口已从顶栏移除——它与 6 步向导主流程并存时
  // 会并行重新生成全部图片/视频（无幂等守卫），导致重复服务端任务（token 双倍消耗）。
  // 失败视频的自动重试已统一由向导视频步骤（StepVideos → generateVideosForStep）接管。

  // Clear project
  const handleClear = useCallback(async () => {
    const ok = await confirmDialog({
      title: t("pipeline.deleteProject"),
      message: t("pipeline.deleteProjectConfirm").replace("{title}", project?.title ?? ""),
      confirmLabel: t("dialog.confirm"),
      variant: "danger",
    });
    if (ok) {
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
          {/* Aspect ratio selector */}
          {project && (
            <select
              value={project.aspectRatio}
              onChange={async (e) => {
                const next = e.target.value as AspectRatio;
                if (next === project.aspectRatio) return;
                // 画幅变更后已生成的图片/视频不会自动重新生成：若有生成产物，
                // 先确认再切换，避免用户误以为内容会跟随新画幅自动更新
                const hasGenerated = project.shots.some((s) => s.imageUrl || s.videoUrl);
                if (hasGenerated) {
                  const ok = await confirmDialog({
                    title: t("wizard.aspectRatioChangeTitle"),
                    message: t("wizard.aspectRatioChangeMessage"),
                    confirmLabel: t("dialog.confirm"),
                  });
                  if (!ok) return; // 受控 select 保持原值，自动回退
                }
                updateProject({ aspectRatio: next });
              }}
              className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-300 focus:outline-none"
            >
              <option value="16:9">16:9</option>
              <option value="9:16">9:16</option>
              <option value="1:1">1:1</option>
            </select>
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
              title={t("pipeline.deleteProject")}
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

        {/* Center: always show wizard */}
        <main className="flex-1 overflow-hidden">
          <CreationWizard />
        </main>

        {/* Right panel: shot editor */}
        {shots.length > 0 && (
          <aside className="w-72 border-l border-slate-800 bg-slate-950">
            <ShotEditor
              shot={selectedShot}
              onClose={() => setSelectedShotId(null)}
              onRegenerateImage={rerollImage}
              onRegenerateVideo={rerollVideo}
              onOpenAiAssist={handleOpenShotAiAssist}
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

