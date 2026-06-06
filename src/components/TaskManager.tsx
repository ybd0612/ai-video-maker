// ────────────────────────────────────────────────────────────────────────────
// src/components/TaskManager.tsx
// Task management — save/load canvas snapshots as named tasks.
// Tab-style switcher with auto-save before switching.
// ────────────────────────────────────────────────────────────────────────────

import { useState, useCallback, useEffect, useRef } from "react";
import { Save, FolderOpen, Trash2, Pencil, Check, X, Plus, ChevronDown, ChevronUp } from "lucide-react";
import { useCanvasStore } from "@/stores/canvasStore";
import { useTaskStore, type Task, type CanvasSnapshot } from "@/stores/taskStore";
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
}: {
  task: Task;
  isActive: boolean;
  onClick: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(task.name);

  const commitRename = () => {
    const sanitized = sanitizeTaskName(editName);
    if (sanitized) onRename(sanitized);
    setEditing(false);
  };

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
    </div>
  );
}

/* ── TaskManager ────────────────────────────────────────────────────────── */

export function TaskManager() {
  const [expanded, setExpanded] = useState(true);
  const t = useT();

  const tasks = useTaskStore((s) => s.tasks);
  const activeTaskId = useTaskStore((s) => s.activeTaskId);
  const createTask = useTaskStore((s) => s.createTask);
  const updateTask = useTaskStore((s) => s.updateTask);
  const deleteTask = useTaskStore((s) => s.deleteTask);
  const setActiveTaskId = useTaskStore((s) => s.setActiveTaskId);

  /* ── Auto-save current task on unload / task switch ─────────────────── */
  useEffect(() => {
    const saveCurrent = () => {
      if (!activeTaskId) return;
      const snapshot = captureSnapshot();
      updateTask(activeTaskId, { canvasData: snapshot });
    };
    window.addEventListener("beforeunload", saveCurrent);

  return () => window.removeEventListener("beforeunload", saveCurrent);
  }, [activeTaskId, updateTask]);

  /* ── Load active task snapshot on mount (after store hydration) ─────── */
  const didInitRef2 = useRef(false);
  useEffect(() => {
    if (didInitRef2.current) return;
    didInitRef2.current = true;
    // Delay to let zustand persist hydrate from localStorage
    setTimeout(() => {
      const { activeTaskId: currentId, tasks: currentTasks } = useTaskStore.getState();
      if (!currentId) return;
      const task = currentTasks.find((t) => t.id === currentId);
      if (task) {
        loadSnapshotIntoCanvas(task.canvasData);
      }
    }, 100);
  }, []);

  /* ── New blank task ──────────────────────────────────────────────────── */
  const handleSaveNew = useCallback(() => {
    if (activeTaskId) {
      const snapshot = captureSnapshot();
      updateTask(activeTaskId, { canvasData: snapshot });
    }
    const name = `Task ${tasks.length + 1}`;
    const emptySnap: CanvasSnapshot = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, capturedAt: Date.now() };
    const task = createTask(name, emptySnap);
    loadSnapshotIntoCanvas(task.canvasData);
  }, [tasks.length, createTask, activeTaskId, updateTask]);

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

  const activeTask = tasks.find((t) => t.id === activeTaskId);

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

          {/* ── New button ──────────────────────────────────────────────── */}
          <button
            onClick={handleSaveNew}
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-emerald-500"
          >
            <Plus size={12} /> {t("task.new")}
          </button>

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
