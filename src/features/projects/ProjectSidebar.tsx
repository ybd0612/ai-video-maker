// ────────────────────────────────────────────────────────────────────────────
// src/features/projects/ProjectSidebar.tsx
// Left panel tab for project list management (create / switch / delete / duplicate).
// ────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import { useProjectStore } from "@/stores/projectStore";
import { useT } from "@/i18n";
import {
  Plus, Copy, Trash2, CheckCircle2,
  Film, Loader2,
} from "lucide-react";
import { confirmDialog } from "@/components/ui/ConfirmDialog";

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

  const statusIcon = (status: string) => {
    switch (status) {
      case "done":
        return <CheckCircle2 size={10} className="text-emerald-400" />;
      case "scripting":
      case "imaging":
      case "videoing":
      case "rendering":
        return <Loader2 size={10} className="animate-spin text-sky-400" />;
      case "failed":
        return <span className="block h-2 w-2 rounded-full bg-red-500" />;
      default:
        return <Film size={10} className="text-slate-600" />;
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Create project */}
      <div className="border-b border-slate-800 p-2">
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
              className="flex-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
            />
            <button
              onClick={handleCreate}
              className="rounded bg-emerald-600 px-2 py-1 text-[10px] text-white hover:bg-emerald-500"
            >
              {t("dialog.confirm")}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setIsCreating(true)}
            className="flex w-full items-center justify-center gap-1 rounded border border-dashed border-slate-700 py-1.5 text-[10px] text-slate-500 hover:border-emerald-600 hover:text-emerald-400 transition"
          >
            <Plus size={10} />
            {t("pipeline.newProject")}
          </button>
        )}
      </div>

      {/* Project list */}
      <div className="flex-1 overflow-y-auto">
        {projects.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <span className="text-xs text-slate-600">{t("pipeline.noProjects")}</span>
          </div>
        ) : (
          <div className="flex flex-col">
            {projects.map((proj) => {
              const isActive = proj.id === activeProjectId;
              const shotCount = proj.shots.length;
              const doneCount = proj.shots.filter((s) => s.status === "videoed").length;

              return (
                <div
                  key={proj.id}
                  onClick={() => switchProject(proj.id)}
                  className={`group flex cursor-pointer flex-col gap-1 border-b border-slate-800/50 px-3 py-2 transition hover:bg-slate-900 ${
                    isActive ? "bg-slate-900 border-l-2 border-l-emerald-500" : ""
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {statusIcon(proj.status)}
                    <span
                      className={`flex-1 truncate text-xs font-medium ${
                        isActive ? "text-emerald-300" : "text-slate-300"
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
                        className="rounded p-0.5 text-slate-600 hover:text-sky-400"
                        title={t("pipeline.duplicateProject")}
                      >
                        <Copy size={10} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(proj.id, proj.title);
                        }}
                        className="rounded p-0.5 text-slate-600 hover:text-red-400"
                        title={t("pipeline.deleteProject")}
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  </div>
                  {shotCount > 0 && (
                    <div className="flex items-center gap-2 pl-5">
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-800">
                        <div
                          className="h-full rounded-full bg-emerald-600 transition-all"
                          style={{ width: `${(doneCount / shotCount) * 100}%` }}
                        />
                      </div>
                      <span className="text-[9px] text-slate-600">
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
