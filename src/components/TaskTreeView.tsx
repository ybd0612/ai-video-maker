import { useState, useCallback, useEffect, useRef } from "react";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FileText,
  Pencil,
  Trash2,
  Check,
  X,
} from "lucide-react";
import { useCanvasStore } from "@/stores/canvasStore";
import { useTaskStore, type Task, type Folder as FolderType, type CanvasSnapshot } from "@/stores/taskStore";
import { useT } from "@/i18n";
import { confirmDialog } from "@/components/ui/ConfirmDialog";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/ContextMenu";

/* ── Helpers ────────────────────────────────────────────────────────────── */

// Flag to prevent auto-save during task switching
export let isSwitchingTask = false;

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
  onNewTaskInFolder,
  children,
}: {
  folder: FolderType;
  onNewTaskInFolder: (folderId: string) => void;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
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

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: t("task.new"), icon: <FileText size={12} />, color: "text-emerald-400", onClick: () => onNewTaskInFolder(folder.id) },
        { label: t("task.rename"), icon: <Pencil size={12} />, onClick: () => setEditing(true) },
        { label: t("dialog.delete"), icon: <Trash2 size={12} />, color: "text-red-400", onClick: handleDelete },
      ],
    });
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
          onContextMenu={handleContextMenu}
        >
          {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          {expanded ? <FolderOpen size={12} className="text-amber-400" /> : <Folder size={12} className="text-amber-400" />}
          <span className="flex-1 truncate">{folder.name}</span>
        </div>
      )}
      {expanded && <div className="ml-3 border-l border-slate-800 pl-1">{children}</div>}
      {ctxMenu && <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxMenu.items} onClose={() => setCtxMenu(null)} />}
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
  onMove,
  folders,
}: {
  task: Task;
  isActive: boolean;
  onClick: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
  onMove: (folderId: string | null) => void;
  folders: FolderType[];
}) {
  const [editing, setEditing] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const t = useT();

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const moveItems: ContextMenuItem[] = folders
      .filter((f) => f.id !== task.folderId)
      .map((f) => ({
        label: f.name,
        icon: <Folder size={12} />,
        color: "text-amber-400",
        onClick: () => onMove(f.id),
      }));
    if (task.folderId) {
      moveItems.push({
        label: t("task.moveToRoot"),
        icon: <FileText size={12} />,
        onClick: () => onMove(null),
      });
    }
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: t("task.open"), icon: <FileText size={12} />, color: "text-emerald-400", onClick },
        { label: t("task.rename"), icon: <Pencil size={12} />, onClick: () => setEditing(true) },
        ...(moveItems.length > 0 ? [{ label: t("task.moveTo"), icon: <Folder size={12} />, color: "text-amber-400", onClick: () => {} }, ...moveItems] : []),
        { label: t("dialog.delete"), icon: <Trash2 size={12} />, color: "text-red-400", onClick: onDelete },
      ],
    });
  };

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
      onContextMenu={handleContextMenu}
      className={`group relative ml-5 flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-xs transition select-none ${
        isActive
          ? "bg-emerald-950/40 text-emerald-300 font-semibold"
          : "text-slate-400 hover:bg-slate-800/40 hover:text-slate-200"
      }`}
    >
      <FileText size={11} className={isActive ? "text-emerald-400" : "text-slate-600"} />
      <span className="flex-1 truncate">{task.name}</span>
      <span className="text-[10px] text-slate-600">({task.canvasData.nodes.length})</span>
      {ctxMenu && <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxMenu.items} onClose={() => setCtxMenu(null)} />}
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
  const moveTask = useTaskStore((s) => s.moveTask);
  const createFolder = useTaskStore((s) => s.createFolder);
  const setActiveTaskId = useTaskStore((s) => s.setActiveTaskId);

  const [rootCtx, setRootCtx] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);

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

  const handleNewTask = useCallback((folderId?: string | null) => {
    if (activeTaskId) {
      const snapshot = captureSnapshot();
      updateTask(activeTaskId, { canvasData: snapshot });
    }
    const name = `${t("task.new")} ${tasks.length + 1}`;
    const emptySnap: CanvasSnapshot = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, capturedAt: Date.now() };
    const task = createTask(name, emptySnap, folderId ?? null);
    loadSnapshotIntoCanvas(task.canvasData);
  }, [tasks.length, createTask, activeTaskId, updateTask, t]);

  const handleNewFolder = useCallback(() => {
    createFolder(`${t("task.folder")} ${folders.length + 1}`);
  }, [folders.length, createFolder, t]);

  const handleSwitch = useCallback(
    (task: Task) => {
      isSwitchingTask = true;
      if (activeTaskId) {
        const snapshot = captureSnapshot();
        updateTask(activeTaskId, { canvasData: snapshot });
      }
      setActiveTaskId(task.id);
      loadSnapshotIntoCanvas(task.canvasData);
      // Reset flag after a short delay to allow the effect to run
      setTimeout(() => { isSwitchingTask = false; }, 100);
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

  /* ── Root area context menu ─────────────────────────────────────────── */

  const handleRootContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setRootCtx({
        x: e.clientX,
        y: e.clientY,
        items: [
          { label: t("task.new"), icon: <FileText size={12} />, color: "text-emerald-400", onClick: () => handleNewTask(null) },
          { label: t("task.folder"), icon: <Folder size={12} />, color: "text-amber-400", onClick: handleNewFolder },
        ],
      });
    },
    [handleNewTask, handleNewFolder, t],
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
    <div className="px-2 py-2 flex-1 min-h-0" onContextMenu={handleRootContextMenu}>
      {/* Tree */}
      {tasks.length === 0 && folders.length === 0 ? (
        <p className="py-4 text-center text-xs text-slate-600">{t("task.noTasks")}</p>
      ) : (
        <div className="space-y-0.5">
          {/* Folders */}
          {folders.map((folder) => (
            <FolderItem key={folder.id} folder={folder} onNewTaskInFolder={(fid) => handleNewTask(fid)}>
              {(folderMap.get(folder.id) ?? []).map((task) => (
                <TaskLeaf
                  key={task.id}
                  task={task}
                  isActive={task.id === activeTaskId}
                  onClick={() => handleSwitch(task)}
                  onDelete={() => handleDeleteTask(task)}
                  onRename={(name) => updateTask(task.id, { name })}
                  onMove={(fid) => moveTask(task.id, fid)}
                  folders={folders}
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
              onMove={(fid) => moveTask(task.id, fid)}
              folders={folders}
            />
          ))}
        </div>
      )}
      {rootCtx && <ContextMenu x={rootCtx.x} y={rootCtx.y} items={rootCtx.items} onClose={() => setRootCtx(null)} />}
    </div>
  );
}