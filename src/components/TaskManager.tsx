// ────────────────────────────────────────────────────────────────────────────
// src/components/TaskManager.tsx
// Task management — save/load canvas snapshots as named tasks.
// Tab-style switcher with auto-save before switching.
// ────────────────────────────────────────────────────────────────────────────

import { useState, useCallback, useEffect, useRef } from "react";
import { Save, FolderOpen, Trash2, Pencil, Check, X, Plus, ChevronDown, ChevronUp, History, RotateCcw } from "lucide-react";
import { useCanvasStore } from "@/stores/canvasStore";
import { useTaskStore, type Task, type CanvasSnapshot, type HistoryEntry } from "@/stores/taskStore";
import { useT } from "@/i18n";
import { confirmDialog } from "@/components/ui/ConfirmDialog";
import { sanitizeTaskName } from "@/lib/validation";

/* ── Helpers ────────────────────────────────────────────────────────────── */

function captureSnapshot(): CanvasSnapshot {
  const { nodes, edges, viewport } = useCanvasStore.getState();
  return { nodes, edges, viewport, capturedAt: Date.now() };
}

function loadSnapshotIntoCanvas(snap: CanvasSnapshot) {
  const store = useCanvasStore.getState();
  store.loadSnapshot({ nodes: snap.nodes as never, edges: snap.edges, viewport: snap.viewport });
}

/* ── TabButton — one task tab ───────────────────────────────────────────── */

function TabButton({
  task,
  isActive,
  onClick,
  onDelete,
  onRename,
  onRestoreHistory,
}: {
  task: Task;
  isActive: boolean;
  onClick: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
  onRestoreHistory: (index: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(task.name);
  const [showHistory, setShowHistory] = useState(false);
  const t = useT();

  const commitRename = () => {
    const sanitized = sanitizeTaskName(editName);
    if (sanitized) onRename(sanitized);
    setEditing(false);
  };

  const historyCount = task.history?.length ?? 0;

  if (editing) {
    return (
      <div className="flex items-center gap-1 rounded-md border border-emerald-500/50 bg-slate-800 px-1.5 py-1">
        <input
          autoFocus
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setEditing(false); }}
          maxLength={20} className="w-20 rounded border-0 bg-transparent px-0.5 text-xs text-slate-100 focus:outline-none"
        />
        <button onClick={commitRename} className="text-emerald-400"><Check size={11} /></button>
        <button onClick={() => setEditing(false)} className="text-slate-500"><X size={11} /></button>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div
        onClick={onClick}
        className={`group relative flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition select-none ${
          isActive
            ? "border-emerald-500/60 bg-emerald-950/40 text-emerald-300 font-semibold"
            : "border-slate-700/50 bg-slate-800/40 text-slate-400 hover:border-slate-600 hover:text-slate-200"
        }`}
      >
        <FolderOpen size={10} className={isActive ? "text-emerald-400" : "text-slate-600"} />
        <span className="truncate max-w-[80px]">{task.name}</span>
        <span className="text-xs text-slate-600">({task.canvasData.nodes.length})</span>

        {/* History toggle */}
        {historyCount > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); setShowHistory(!showHistory); }}
            className={`ml-auto flex items-center gap-0.5 rounded px-1 py-0.5 text-xs transition ${showHistory ? "text-amber-400 bg-amber-950/30" : "text-slate-600 hover:text-slate-400"}`}
            title={`${historyCount} ${t("task.historyEntries")}`}
          >
            <History size={9} /> {historyCount}
          </button>
        )}

        {/* Hover actions */}
        <div className="absolute -top-1 -right-1 flex gap-0.5 opacity-0 transition group-hover:opacity-100">
          <button
            onClick={(e) => { e.stopPropagation(); setEditName(task.name); setEditing(true); }}
            className="rounded bg-slate-700 p-0.5 text-slate-400 hover:text-slate-100"
            title="Rename"
          >
            <Pencil size={9} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="rounded bg-slate-700 p-0.5 text-slate-400 hover:text-red-400"
            title="Delete"
          >
            <Trash2 size={9} />
          </button>
        </div>
      </div>

      {/* History list */}
      {showHistory && historyCount > 0 && (
        <div className="ml-3 mt-1 space-y-0.5 border-l border-slate-700/60 pl-2">
          {(task.history ?? []).slice().reverse().map((entry: HistoryEntry, ri: number) => {
            const actualIndex = historyCount - 1 - ri;
            const d = new Date(entry.savedAt);
            return (
              <button
                key={entry.savedAt}
                onClick={(e) => { e.stopPropagation(); onRestoreHistory(actualIndex); }}
                className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-[11px] text-slate-500 transition hover:bg-slate-800 hover:text-amber-300"
                title={t("task.restoreVersion")}
              >
                <RotateCcw size={8} />
                <span>
                  v{actualIndex + 1} &middot; {d.toLocaleDateString()} {d.toLocaleTimeString()}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── TaskManager ────────────────────────────────────────────────────────── */

export function TaskManager() {
  const [expanded, setExpanded] = useState(true);
  const [saveName, setSaveName] = useState("");

  const tasks = useTaskStore((s) => s.tasks);
  const createTask = useTaskStore((s) => s.createTask);
  const updateTask = useTaskStore((s) => s.updateTask);
  const deleteTask = useTaskStore((s) => s.deleteTask);
  const activeTaskId = useTaskStore((s) => s.activeTaskId);
  const setActiveTaskId = useTaskStore((s) => s.setActiveTaskId);
  const restoreFromHistory = useTaskStore((s) => s.restoreFromHistory);
  const t = useT();

  /* ── New blank task ──────────────────────────────────────────────────── */
  const handleSaveNew = useCallback(() => {
    // Auto-save current task before creating a new one
    if (activeTaskId) {
      const snapshot = captureSnapshot();
      updateTask(activeTaskId, { canvasData: snapshot });
    }
    const name = sanitizeTaskName(saveName) || `Task ${tasks.length + 1}`;
    const emptySnap: CanvasSnapshot = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, capturedAt: Date.now() };
    const task = createTask(name, emptySnap);
    loadSnapshotIntoCanvas(task.canvasData);
    setSaveName("");
  }, [saveName, tasks.length, createTask, activeTaskId, updateTask]);

  /* ── Switch task (auto-saves current first) ──────────────────────────── */
  const handleSwitch = useCallback(
    (task: Task) => {
      if (activeTaskId) {
        const snapshot = captureSnapshot();
        updateTask(activeTaskId, { canvasData: snapshot });
      }
      setActiveTaskId(task.id);
      loadSnapshotIntoCanvas(task.canvasData);
    },
    [activeTaskId, updateTask, setActiveTaskId],
  );

  /* ── Delete with confirmation ────────────────────────────────────────── */
  const handleDelete = useCallback(
    async (task: Task) => {
      const ok = await confirmDialog({
        title: t("dialog.delete"),
        message: t("task.deleteConfirm", { name: task.name }),
        confirmLabel: t("dialog.delete"),
        variant: "danger",
      });
      if (ok) deleteTask(task.id);
    },
    [deleteTask, t],
  );

  /* ── Restore a history entry ─────────────────────────────────────────── */
  const handleRestoreHistory = useCallback(
    (taskId: string, index: number) => {
      if (activeTaskId) {
        const snapshot = captureSnapshot();
        updateTask(activeTaskId, { canvasData: snapshot });
      }
      restoreFromHistory(taskId, index);
      const task = useTaskStore.getState().getTaskById(taskId);
      if (task) {
        loadSnapshotIntoCanvas(task.canvasData);
      }
      setActiveTaskId(taskId);
    },
    [activeTaskId, updateTask, restoreFromHistory, setActiveTaskId],
  );

  const activeTask = tasks.find((t) => t.id === activeTaskId);

  const tabRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const didInitRef = useRef(false);
  useEffect(() => {
    if (!didInitRef.current) {
      didInitRef.current = true;
      return;
    }
    if (activeTaskId) {
      const el = tabRefs.current[activeTaskId];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [activeTaskId]);

  return (
    <div className="border-t border-slate-800">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500 transition hover:text-slate-300"
      >
        <Save size={11} />
        {t("task.title")}
        {activeTask && <span className="ml-1 text-emerald-500 normal-case">/ {activeTask.name}</span>}
        <span className="ml-auto">{expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}</span>
      </button>

      {expanded && (
        <div className="space-y-2.5 overflow-hidden px-3 pb-3">

          {/* ── Action bar ──────────────────────────────────────────────── */}
          <div className="flex gap-1.5 min-w-0 overflow-hidden">
            <input
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSaveNew()}
              placeholder={t("task.newPlaceholder")}
              className="flex-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
            />
            <button
              onClick={handleSaveNew}
              title="Create a new blank task"
              className="shrink-0 flex items-center gap-1 whitespace-nowrap rounded-md bg-emerald-600 px-2 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus size={11} /> {t("task.new")}
            </button>
          </div>

          {/* ── Task tabs ───────────────────────────────────────────────── */}
          {tasks.length === 0 ? (
            <p className="py-3 text-center text-xs text-slate-600">
              {t("task.noTasks")}
            </p>
          ) : (
            <div className="space-y-1">
              <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto overflow-x-hidden">
                {[...tasks]
                  .map((task) => (
                    <div key={task.id} ref={(el) => { tabRefs.current[task.id] = el; }} className="w-full">
                      <TabButton
                        task={task}
                        isActive={task.id === activeTaskId}
                        onClick={() => handleSwitch(task)}
                        onDelete={() => handleDelete(task)}
                        onRename={(name) => updateTask(task.id, { name })}
                        onRestoreHistory={(index) => handleRestoreHistory(task.id, index)}
                      />
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
