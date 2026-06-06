import { useState, useCallback, useEffect, useRef } from "react";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FileText,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
} from "lucide-react";
import { useCanvasStore } from "@/stores/canvasStore";
import { useTaskStore, type Task, type Folder as FolderType, type CanvasSnapshot } from "@/stores/taskStore";
import { useT } from "@/i18n";
import { confirmDialog } from "@/components/ui/ConfirmDialog";

/* ── Helpers ────────────────────────────────────────────────────────────── */

function captureSnapshot(): CanvasSnapshot {
  const { nodes, edges, viewport } = useCanvasStore.getState();
  return { nodes, edges, viewport, capturedAt: Date.now() };
}

function loadSnapshotIntoCanvas(snap: CanvasSnapshot) {
  const store = useCanvasStore.getState();
  store.loadSnapshot({ nodes: snap.nodes as never, edges: snap.edges, viewport: snap.viewport });
}

/* ── Inline editable label ──────────────────────────────────────────────── */

function EditableLabel({
  value,
  onCommit,
  onCancel,
}: {
  value: string;
  onCommit: (v: string) => void;
  onCancel: () => void;
}) {
  const [editVal, setEditVal] = useState(value);
  return (
    <div className="flex items-center gap-0.5">
      <input
        autoFocus
        value={editVal}
        onChange={(e) => setEditVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { onCommit(editVal); }
          if (e.key === "Escape") onCancel();
        }}
        maxLength={20}
        className="w-20 rounded border-0 bg-transparent px-0.5 text-xs text-slate-100 focus:outline-none"
      />
      <button onClick={() => onCommit(editVal)} className="text-emerald-400"><Check size={11} /></button>
      <button onClick={onCancel} className="text-slate-500"><X size={11} /></button>
    </div>
  );
}

/* ── FolderItem ─────────────────────────────────────────────────────────── */

function FolderItem({
  folder,
  children,
}: {
  folder: FolderType;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const renameFolder = useTaskStore((s) => s.renameFolder);
  const deleteFolder = useTaskStore((s) => s.deleteFolder);
  const t = useT();

  const handleDelete = async () => {
    const ok = await confirmDialog({
      title: t("dialog.delete"),
      message: t("task.deleteFolderConfirm", { name: folder.name }),
      confirmLabel: t("dialog.delete"),
      variant: "danger",
    });
    if (ok) deleteFolder(folder.id);
  };

  return (
    <div className="ml-1">
      {editing ? (
        <div className="flex items-center gap-1 py-0.5">
          <Folder size={12} className="text-amber-400" />
          <EditableLabel
            value={folder.name}
            onCommit={(v) => { renameFolder(folder.id, v.trim() || folder.name); setEditing(false); }}
            onCancel={() => setEditing(false)}
          />
        </div>
      ) : (
        <div
          className="group flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-xs text-slate-400 transition hover:bg-slate-800/60 hover:text-slate-200"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          {expanded ? <FolderOpen size={12} className="text-amber-400" /> : <Folder size={12} className="text-amber-400" />}
          <span className="flex-1 truncate">{folder.name}</span>
          <div className="flex gap-0.5 opacity-0 transition group-hover:opacity-100">
            <button onClick={(e) => { e.stopPropagation(); setEditing(true); }} className="rounded p-0.5 text-slate-500 hover:text-slate-100"><Pencil size={9} /></button>
            <button onClick={(e) => { e.stopPropagation(); handleDelete(); }} className="rounded p-0.5 text-slate-500 hover:text-red-400"><Trash2 size={9} /></button>
          </div>
        </div>
      )}
      {expanded && <div className="ml-3 border-l border-slate-800 pl-1">{children}</div>}
    </div>
  );
}

/* ── TaskLeaf ───────────────────────────────────────────────────────────── */

function TaskLeaf({
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

  if (editing) {
    return (
      <div className="ml-5 flex items-center gap-1 py-0.5">
        <FileText size={11} className="text-emerald-400" />
        <EditableLabel
          value={task.name}
          onCommit={(v) => { onRename(v.trim() || task.name); setEditing(false); }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      className={`group relative ml-5 flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-xs transition select-none ${
        isActive
          ? "bg-emerald-950/40 text-emerald-300 font-semibold"
          : "text-slate-400 hover:bg-slate-800/40 hover:text-slate-200"
      }`}
    >
      <FileText size={11} className={isActive ? "text-emerald-400" : "text-slate-600"} />
      <span className="flex-1 truncate">{task.name}</span>
      <span className="text-[10px] text-slate-600">({task.canvasData.nodes.length})</span>
      <div className="flex gap-0.5 opacity-0 transition group-hover:opacity-100">
        <button onClick={(e) => { e.stopPropagation(); setEditing(true); }} className="rounded p-0.5 text-slate-500 hover:text-slate-100"><Pencil size={9} /></button>
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="rounded p-0.5 text-slate-500 hover:text-red-400"><Trash2 size={9} /></button>
      </div>
    </div>
  );
}

/* ── TaskTreeView ───────────────────────────────────────────────────────── */

export function TaskTreeView() {
  const t = useT();
  const tasks = useTaskStore((s) => s.tasks);
  const folders = useTaskStore((s) => s.folders);
  const activeTaskId = useTaskStore((s) => s.activeTaskId);
  const createTask = useTaskStore((s) => s.createTask);
  const updateTask = useTaskStore((s) => s.updateTask);
  const deleteTask = useTaskStore((s) => s.deleteTask);
  const createFolder = useTaskStore((s) => s.createFolder);
  const setActiveTaskId = useTaskStore((s) => s.setActiveTaskId);

  /* Auto-save current task on unload */
  useEffect(() => {
    const saveCurrent = () => {
      if (!activeTaskId) return;
      const snapshot = captureSnapshot();
      updateTask(activeTaskId, { canvasData: snapshot });
    };
    window.addEventListener("beforeunload", saveCurrent);
    return () => window.removeEventListener("beforeunload", saveCurrent);
  }, [activeTaskId, updateTask]);

  /* Restore active task on mount */
  const didInitRef = useRef(false);
  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    setTimeout(() => {
      const { activeTaskId: currentId, tasks: currentTasks } = useTaskStore.getState();
      if (!currentId) return;
      const task = currentTasks.find((tk) => tk.id === currentId);
      if (task) loadSnapshotIntoCanvas(task.canvasData);
    }, 100);
  }, []);

  /* ── Actions ────────────────────────────────────────────────────────── */

  const handleNewTask = useCallback(() => {
    if (activeTaskId) {
      const snapshot = captureSnapshot();
      updateTask(activeTaskId, { canvasData: snapshot });
    }
    const name = `${t("task.new")} ${tasks.length + 1}`;
    const emptySnap: CanvasSnapshot = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, capturedAt: Date.now() };
    const task = createTask(name, emptySnap);
    loadSnapshotIntoCanvas(task.canvasData);
  }, [tasks.length, createTask, activeTaskId, updateTask, t]);

  const handleNewFolder = useCallback(() => {
    createFolder(`${t("task.folder")} ${folders.length + 1}`);
  }, [folders.length, createFolder, t]);

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

  const handleDeleteTask = useCallback(
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

  /* ── Group tasks by folder ──────────────────────────────────────────── */

  const rootTasks = tasks.filter((tk) => !tk.folderId);
  const folderMap = new Map<string, Task[]>();
  for (const tk of tasks) {
    if (tk.folderId) {
      const arr = folderMap.get(tk.folderId) ?? [];
      arr.push(tk);
      folderMap.set(tk.folderId, arr);
    }
  }

  return (
    <div className="px-2 py-2">
      {/* Action bar */}
      <div className="mb-2 flex gap-1">
        <button
          onClick={handleNewTask}
          className="flex flex-1 items-center justify-center gap-1 rounded-md bg-emerald-600 px-2 py-1.5 text-[11px] font-medium text-white transition hover:bg-emerald-500"
        >
          <Plus size={11} /> {t("task.new")}
        </button>
        <button
          onClick={handleNewFolder}
          className="flex items-center justify-center gap-1 rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1.5 text-[11px] text-slate-400 transition hover:border-slate-600 hover:text-slate-200"
        >
          <Folder size={11} /> {t("task.folder")}
        </button>
      </div>

      {/* Tree */}
      {tasks.length === 0 && folders.length === 0 ? (
        <p className="py-4 text-center text-xs text-slate-600">{t("task.noTasks")}</p>
      ) : (
        <div className="space-y-0.5">
          {/* Folders */}
          {folders.map((folder) => (
            <FolderItem key={folder.id} folder={folder}>
              {(folderMap.get(folder.id) ?? []).map((task) => (
                <TaskLeaf
                  key={task.id}
                  task={task}
                  isActive={task.id === activeTaskId}
                  onClick={() => handleSwitch(task)}
                  onDelete={() => handleDeleteTask(task)}
                  onRename={(name) => updateTask(task.id, { name })}
                />
              ))}
            </FolderItem>
          ))}

          {/* Root tasks (no folder) */}
          {rootTasks.map((task) => (
            <TaskLeaf
              key={task.id}
              task={task}
              isActive={task.id === activeTaskId}
              onClick={() => handleSwitch(task)}
              onDelete={() => handleDeleteTask(task)}
              onRename={(name) => updateTask(task.id, { name })}
            />
          ))}
        </div>
      )}
    </div>
  );
}