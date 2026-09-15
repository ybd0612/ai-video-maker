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
import { ProjectSidebar } from "@/features/projects/ProjectSidebar";
import {
  Settings, Trash2,
  FolderOpen, Layers,
  Moon, Sun, TerminalSquare,
} from "lucide-react";
import { LogConsoleDock } from "@/components/LogConsoleDock";
import { ApiKeyBanner } from "@/components/ApiKeyBanner";
import { confirmDialog } from "@/components/ui/ConfirmDialog";
import { CreationWizard } from "@/features/wizard/CreationWizard";
import { useWizardActions } from "@/features/wizard/useWizardActions";

type LeftTab = "projects" | "shots";

export function ProjectWorkspace() {
  const t = useT();
  const project = useProjectStore(selectActiveProject);
  const projects = useProjectStore((s) => s.projects);
  const clearProject = useProjectStore((s) => s.clearProject);
  const openSettings = useSettingsStore((s) => s.setSettingsDialogOpen);
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const showLogPanel = useSettingsStore((s) => s.showLogPanel);
  const setShowLogPanel = useSettingsStore((s) => s.setShowLogPanel);
  const { rerollImage, rerollVideo } = useWizardActions();

  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
  const [leftTab, setLeftTab] = useState<LeftTab>("shots");

  // 注：失败视频的自动重试已统一由向导视频步骤（StepVideos → generateVideosForStep）接管。
  // 此前此处存在 retryFailedVideos 入口，会与向导批量生成并行，重复创建服务端视频任务（token 双倍消耗）。

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
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-app">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-line-soft px-4 py-2">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold text-ink">
            {t("pipeline.title")}
          </h1>
          {project && (
            <span className="text-xs text-ink-4">
              {project.title}
            </span>
          )}
          {projects.length > 1 && (
            <span className="rounded bg-raised px-1.5 py-0.5 text-[0.625rem] text-ink-4">
              {projects.length} {t("pipeline.projectCount")}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Log panel toggle（DevTools 式底部停靠面板） */}
          <button
            onClick={() => setShowLogPanel(!showLogPanel)}
            className={`rounded-md p-1.5 hover:bg-raised ${
              showLogPanel ? "text-accent" : "text-ink-4 hover:text-ink-2"
            }`}
            title={showLogPanel ? t("log.hidePanel") : t("log.showPanel")}
          >
            <TerminalSquare size={14} />
          </button>

          {/* Theme toggle: light / dark */}
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="rounded-md p-1.5 text-ink-4 hover:bg-raised hover:text-ink-2"
            title={t("sidebar.theme")}
          >
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
          </button>

          {/* Settings */}
          <button
            onClick={() => openSettings(true)}
            className="rounded-md p-1.5 text-ink-4 hover:bg-raised hover:text-ink"
            title={t("sidebar.settings")}
          >
            <Settings size={14} />
          </button>

          {/* Clear */}
          {project && (
            <button
              onClick={handleClear}
              className="rounded-md p-1.5 text-ink-4 hover:bg-danger-deep hover:text-danger"
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
        <aside className="flex w-60 flex-col border-r border-line-soft bg-app">
          {/* Tab bar */}
          <div className="flex border-b border-line-soft">
            <button
              onClick={() => setLeftTab("projects")}
              className={`flex flex-1 items-center justify-center gap-1 py-2 text-[0.625rem] font-medium transition ${
                leftTab === "projects"
                  ? "border-b-2 border-success text-success"
                  : "text-ink-5 hover:text-ink-3"
              }`}
            >
              <FolderOpen size={10} />
              {t("pipeline.tabProjects")}
            </button>
            <button
              onClick={() => setLeftTab("shots")}
              className={`flex flex-1 items-center justify-center gap-1 py-2 text-[0.625rem] font-medium transition ${
                leftTab === "shots"
                  ? "border-b-2 border-success text-success"
                  : "text-ink-5 hover:text-ink-3"
              }`}
            >
              <Layers size={10} />
              {t("pipeline.shots")} ({shots.length})
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
        </aside>

        {/* Center: always show wizard */}
        <main className="flex-1 overflow-hidden">
          <CreationWizard />
        </main>

        {/* Right panel: shot editor */}
        {shots.length > 0 && (
          <aside className="w-72 border-l border-line-soft bg-app">
            <ShotEditor
              shot={selectedShot}
              onClose={() => setSelectedShotId(null)}
              onRegenerateImage={rerollImage}
              onRegenerateVideo={rerollVideo}
            />
          </aside>
        )}
      </div>

      {/* Bottom dock: 运行日志（DevTools 风格，可拖拽高度） */}
      {showLogPanel && <LogConsoleDock />}
    </div>
  );
}

