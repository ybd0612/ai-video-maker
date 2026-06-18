// ────────────────────────────────────────────────────────────────────────────
// src/features/history/HistoryPanel.tsx
// Left panel tab for operation history timeline.
// ────────────────────────────────────────────────────────────────────────────

import { useProjectStore, type HistoryAction } from "@/stores/projectStore";
import { useT } from "@/i18n";
import {
  FolderPlus, FolderMinus, ArrowRightLeft,
  FileText, Play, CheckCircle2, XCircle,
  RefreshCw, Settings, Trash2,
} from "lucide-react";

const actionIcons: Record<HistoryAction, typeof FolderPlus> = {
  project_created: FolderPlus,
  project_deleted: FolderMinus,
  project_switched: ArrowRightLeft,
  script_generated: FileText,
  pipeline_started: Play,
  pipeline_completed: CheckCircle2,
  pipeline_failed: XCircle,
  shot_regenerated: RefreshCw,
  settings_changed: Settings,
};

const actionColors: Record<HistoryAction, string> = {
  project_created: "text-emerald-400",
  project_deleted: "text-red-400",
  project_switched: "text-sky-400",
  script_generated: "text-violet-400",
  pipeline_started: "text-amber-400",
  pipeline_completed: "text-emerald-400",
  pipeline_failed: "text-red-400",
  shot_regenerated: "text-sky-400",
  settings_changed: "text-slate-400",
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function HistoryPanel() {
  const t = useT();
  const history = useProjectStore((s) => s.history);
  const projects = useProjectStore((s) => s.projects);
  const clearHistory = useProjectStore((s) => s.clearHistory);

  // Group history by date
  const grouped: Record<string, typeof history> = {};
  for (const entry of [...history].reverse()) {
    const dateKey = formatDate(entry.timestamp);
    if (!grouped[dateKey]) grouped[dateKey] = [];
    grouped[dateKey].push(entry);
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 px-3 py-1.5">
        <span className="text-[10px] text-slate-500">
          {t("pipeline.historyCount").replace("{count}", String(history.length))}
        </span>
        {history.length > 0 && (
          <button
            onClick={clearHistory}
            className="rounded p-0.5 text-slate-600 hover:text-red-400 transition"
            title={t("pipeline.clearHistory")}
          >
            <Trash2 size={10} />
          </button>
        )}
      </div>

      {/* History list */}
      <div className="flex-1 overflow-y-auto">
        {history.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <span className="text-xs text-slate-600">{t("pipeline.noHistory")}</span>
          </div>
        ) : (
          Object.entries(grouped).map(([dateKey, entries]) => (
            <div key={dateKey}>
              <div className="sticky top-0 bg-slate-950 px-3 py-1 text-[9px] font-medium text-slate-600">
                {dateKey}
              </div>
              {entries.map((entry) => {
                const Icon = actionIcons[entry.action] ?? FileText;
                const color = actionColors[entry.action] ?? "text-slate-400";
                const project = projects.find((p) => p.id === entry.projectId);

                return (
                  <div
                    key={entry.id}
                    className="flex items-start gap-2 px-3 py-1.5 hover:bg-slate-900/50 transition"
                  >
                    <Icon size={10} className={`mt-0.5 flex-shrink-0 ${color}`} />
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-[10px] text-slate-300">
                        {entry.description}
                      </p>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] text-slate-600">
                          {formatTime(entry.timestamp)}
                        </span>
                        {project && (
                          <span className="truncate text-[9px] text-slate-700">
                            {project.title}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
