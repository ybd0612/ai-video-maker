// ────────────────────────────────────────────────────────────────────────────
// src/pages/ProjectWorkspace.tsx
// Main page: pipeline-based UI with multi-project management.
// Layout: left sidebar (projects) | center wizard.
//
// 2026-09-16：旧右栏分镜编辑器（ShotEditor / ShotList）已移除 ——
// 分镜的唯一编辑入口收敛到向导步骤 3 的「列表卡 → 详情页（AI 指令改写）」，
// 避免同一份镜头数据存在两处可编辑入口而产生数据不一致。
// ────────────────────────────────────────────────────────────────────────────

import { useProjectStore, selectActiveProject } from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useT } from "@/i18n";
import { ProjectSidebar } from "@/features/projects/ProjectSidebar";
import { Settings, Moon, Sun, TerminalSquare } from "lucide-react";
import { LogConsoleDock } from "@/components/LogConsoleDock";
import { ApiKeyBanner } from "@/components/ApiKeyBanner";
import { CreationWizard } from "@/features/wizard/CreationWizard";

export function ProjectWorkspace() {
  const t = useT();
  const project = useProjectStore(selectActiveProject);
  const projects = useProjectStore((s) => s.projects);
  const openSettings = useSettingsStore((s) => s.setSettingsDialogOpen);
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const showLogPanel = useSettingsStore((s) => s.showLogPanel);
  const setShowLogPanel = useSettingsStore((s) => s.setShowLogPanel);

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
            <TerminalSquare className="h-3.5 w-3.5" />
          </button>

          {/* Theme toggle: light / dark */}
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="rounded-md p-1.5 text-ink-4 hover:bg-raised hover:text-ink-2"
            title={t("sidebar.theme")}
          >
            {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </button>

          {/* Settings */}
          <button
            onClick={() => openSettings(true)}
            className="rounded-md p-1.5 text-ink-4 hover:bg-raised hover:text-ink"
            title={t("sidebar.settings")}
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      <ApiKeyBanner />

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel: projects */}
        <aside className="flex w-60 flex-col border-r border-line-soft bg-app">
          <ProjectSidebar />
        </aside>

        {/* Center: wizard */}
        <main className="flex-1 overflow-hidden">
          <CreationWizard />
        </main>
      </div>

      {/* Bottom dock: 运行日志（DevTools 风格，可拖拽高度） */}
      {showLogPanel && <LogConsoleDock />}
    </div>
  );
}
