// ────────────────────────────────────────────────────────────────────────────
// src/features/projects/ProjectSidebar.tsx
// Left panel tab for project list management (create / switch / delete / duplicate).
// ────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import { useProjectStore } from "@/stores/projectStore";
import { useT } from "@/i18n";
import {
  Plus, Copy, Trash2, CheckCircle2,
  Film, Loader2, Search, SortAsc, SortDesc,
} from "lucide-react";
import { confirmDialog } from "@/components/ui/ConfirmDialog";

type SortMode = 'newest' | 'oldest';

export function ProjectSidebar() {
  const t = useT();
  const projects = useProjectStore((s) => s.projects);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const createProject = useProjectStore((s) => s.createProject);
  const switchProject = useProjectStore((s) => s.switchProject);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const duplicateProject = useProjectStore((s) => s.duplicateProject);

  const [newTitle, setNewTitle] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortMode>('newest');

  const handleCreate = () => {
    const title = newTitle.trim() || `${t("pipeline.newProject")} ${projects.length + 1}`;
    createProject(title);
    setNewTitle("");
    setIsCreating(false);
  };

  const handleDelete = async (id: string, title: string) => {
    const ok = await confirmDialog({
      title: t("pipeline.deleteProject"),
      message: t("pipeline.deleteProjectConfirm").replace("{title}", title),
      confirmLabel: t("dialog.confirm"),
      variant: "danger",
    });
    if (ok) deleteProject(id);
  };

  const handleDuplicate = (id: string) => {
    duplicateProject(id);
  };

  // Filter + sort
  const filtered = projects
    .filter(p => p.title.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => sort === 'newest'
      ? (b.createdAt ?? 0) - (a.createdAt ?? 0)
      : (a.createdAt ?? 0) - (b.createdAt ?? 0));

  const statusIcon = (status: string) => {
    switch (status) {
      case "done":
        return <CheckCircle2 size={10} className="text-success" />;
      case "scripting":
      case "imaging":
      case "videoing":
      case "rendering":
        return <Loader2 size={10} className="animate-spin text-info" />;
      case "failed":
        return <span className="block h-2 w-2 rounded-full bg-danger-solid" />;
      default:
        return <Film size={10} className="text-ink-5" />;
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Create project */}
      <div className="border-b border-line-soft p-2">
        {isCreating ? (
          <div className="flex gap-1">
            <input
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
                if (e.key === "Escape") setIsCreating(false);
              }}
              placeholder={t("pipeline.projectNamePlaceholder")}
              className="flex-1 rounded border border-line bg-raised px-2 py-1 text-xs text-ink placeholder:text-ink-5 focus:border-success focus:outline-none"
            />
            <button
              onClick={handleCreate}
              className="rounded bg-success-solid px-2 py-1 text-[0.625rem] text-white hover:bg-success-solid"
            >
              {t("dialog.confirm")}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setIsCreating(true)}
            className="flex w-full items-center justify-center gap-1 rounded border border-dashed border-line py-1.5 text-[0.625rem] text-ink-4 hover:border-success hover:text-success transition"
          >
            <Plus size={10} />
            {t("pipeline.newProject")}
          </button>
        )}
      </div>

      {/* Search + Sort */}
      <div className="flex items-center gap-1 border-b border-line-soft px-2 py-1.5">
        <div className="relative flex-1">
          <Search size={10} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-ink-5" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("pipeline.searchPlaceholder")}
            className="w-full rounded border border-line bg-raised pl-5 pr-2 py-1 text-[0.625rem] text-ink placeholder:text-ink-5 focus:border-success focus:outline-none"
          />
        </div>
        <button
          onClick={() => setSort(s => s === 'newest' ? 'oldest' : 'newest')}
          title={t(sort === 'newest' ? "pipeline.sortOldest" : "pipeline.sortNewest")}
          className="rounded p-1 text-ink-5 hover:text-success"
        >
          {sort === 'newest' ? <SortDesc size={10} /> : <SortAsc size={10} />}
        </button>
      </div>

      {/* Project list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <span className="text-xs text-ink-5">
              {search ? t("pipeline.noSearchResults") : t("pipeline.noProjects")}
            </span>
          </div>
        ) : (
          <div className="flex flex-col">
            {filtered.map((proj) => {
              const isActive = proj.id === activeProjectId;
              const shotCount = proj.shots.length;
              const doneCount = proj.shots.filter((s) => s.status === "videoed").length;

              return (
                <div
                  key={proj.id}
                  onClick={async () => {
                    // 切换项目前提示：当前项目仍有任务在后台运行（写回按项目 ID，切换安全，但需用户知情）
                    const current = useProjectStore.getState().projects.find((p) => p.id === activeProjectId);
                    const running = current &&
                      (current.status === "scripting" || current.status === "imaging" ||
                        current.status === "videoing" || current.status === "rendering");
                    if (running) {
                      const ok = await confirmDialog({
                        title: t("wizard.taskRunningSwitchTitle"),
                        message: t("wizard.taskRunningSwitchConfirm", { title: current!.title }),
                        confirmLabel: t("dialog.confirm"),
                      });
                      if (!ok) return;
                    }
                    switchProject(proj.id);
                  }}
                  className={`group flex cursor-pointer flex-col gap-1 border-b border-line-soft/50 px-3 py-2 transition hover:bg-surface ${
                    isActive ? "bg-surface border-l-2 border-l-emerald-500" : ""
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {statusIcon(proj.status)}
                    <span
                      className={`flex-1 truncate text-xs font-medium ${
                        isActive ? "text-success" : "text-ink-2"
                      }`}
                    >
                      {proj.title}
                    </span>
                    {/* Actions (visible on hover) */}
                    <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDuplicate(proj.id);
                        }}
                        className="rounded p-0.5 text-ink-5 hover:text-info"
                        title={t("pipeline.duplicateProject")}
                      >
                        <Copy size={10} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(proj.id, proj.title);
                        }}
                        className="rounded p-0.5 text-ink-5 hover:text-danger"
                        title={t("pipeline.deleteProject")}
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  </div>
                  {shotCount > 0 && (
                    <div className="flex items-center gap-2 pl-5">
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-raised">
                        <div
                          className="h-full rounded-full bg-success-solid transition-all"
                          style={{ width: `${(doneCount / shotCount) * 100}%` }}
                        />
                      </div>
                      <span className="text-[0.5625rem] text-ink-5">
                        {doneCount}/{shotCount}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
