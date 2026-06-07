// ────────────────────────────────────────────────────────────────────────────
// src/stores/taskStore.ts
// Task & folder management — tree structure for organizing canvas workflows.
// Persisted to localStorage. Folders contain tasks; tasks hold canvas snapshots.
// ────────────────────────────────────────────────────────────────────────────

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Node, Edge, Viewport } from "@xyflow/react";

/* ── Data models ────────────────────────────────────────────────────────── */

export interface CanvasSnapshot {
  nodes: Node<Record<string, unknown>>[];
  edges: Edge[];
  viewport: Viewport;
  capturedAt: number;
}

export interface Task {
  id: string;
  name: string;
  folderId: string | null;
  canvasData: CanvasSnapshot;
  createdAt: number;
  updatedAt: number;
}

export interface Folder {
  id: string;
  name: string;
  createdAt: number;
}

/* ── ID generator ───────────────────────────────────────────────────────── */

let counter = 0;
function newId(prefix: string): string {
  counter += 1;
  return `${prefix}__${Date.now()}_${counter}`;
}

/* ── Store shape ────────────────────────────────────────────────────────── */

interface TaskState {
  tasks: Task[];
  folders: Folder[];
  activeTaskId: string | null;

  /* Folder actions */
  createFolder: (name: string) => Folder;
  renameFolder: (id: string, name: string) => void;
  deleteFolder: (id: string) => void;

  /* Task actions */
  createTask: (name: string, canvasData: CanvasSnapshot, folderId?: string | null) => Task;
  updateTask: (id: string, updates: Partial<Pick<Task, "name" | "canvasData" | "folderId">>) => void;
  deleteTask: (id: string) => void;
  moveTask: (taskId: string, folderId: string | null) => void;
  setActiveTaskId: (id: string | null) => void;
  getTaskById: (id: string) => Task | undefined;
}

/* ── Store ──────────────────────────────────────────────────────────────── */

export const useTaskStore = create<TaskState>()(
  persist(
    (set, get) => ({
      tasks: [],
      folders: [],
      activeTaskId: null,

      /* ── Folders ──────────────────────────────────────────────────────── */

      createFolder: (name) => {
        const folder: Folder = { id: newId("folder"), name, createdAt: Date.now() };
        set((s) => ({ folders: [...s.folders, folder] }));
        return folder;
      },

      renameFolder: (id, name) =>
        set((s) => ({
          folders: s.folders.map((f) => (f.id === id ? { ...f, name } : f)),
        })),

      deleteFolder: (id) =>
        set((s) => ({
          folders: s.folders.filter((f) => f.id !== id),
          // Move tasks out of deleted folder to root
          tasks: s.tasks.map((t) =>
            t.folderId === id ? { ...t, folderId: null } : t,
          ),
        })),

      /* ── Tasks ────────────────────────────────────────────────────────── */

      createTask: (name, canvasData, folderId = null) => {
        const now = Date.now();
        const task: Task = {
          id: newId("task"),
          name,
          folderId: folderId ?? null,
          canvasData: { ...canvasData, capturedAt: now },
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ tasks: [...s.tasks, task], activeTaskId: task.id }));
        return task;
      },

      updateTask: (id, updates) =>
        set((s) => ({
          tasks: s.tasks.map((t) => {
            if (t.id !== id) return t;
            return {
              ...t,
              ...updates,
              canvasData: updates.canvasData
                ? { ...updates.canvasData, capturedAt: Date.now() }
                : t.canvasData,
              updatedAt: Date.now(),
            };
          }),
        })),

      deleteTask: (id) =>
        set((s) => ({
          tasks: s.tasks.filter((t) => t.id !== id),
          activeTaskId: s.activeTaskId === id ? null : s.activeTaskId,
        })),

      moveTask: (taskId, folderId) =>
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === taskId ? { ...t, folderId, updatedAt: Date.now() } : t,
          ),
        })),

      setActiveTaskId: (id) => set({ activeTaskId: id }),
      getTaskById: (id) => get().tasks.find((t) => t.id === id),
    }),
    {
      name: "wxhb-tasks",
      version: 2,
      migrate: (persistedState: unknown, version: number) => {
        if (version === 0 || version === 1) {
          // Migrate from v1: width/height -> size in canvasData
          const state = persistedState as { tasks?: Array<{ canvasData?: { nodes?: Array<{ data?: Record<string, unknown> }> } }> };
          if (state.tasks) {
            state.tasks = state.tasks.map((task) => {
              if (task.canvasData?.nodes) {
                task.canvasData.nodes = task.canvasData.nodes.map((node) => {
                  if (node.data && 'width' in node.data && 'height' in node.data && !('size' in node.data)) {
                    const { width, height, ...rest } = node.data;
                    return { ...node, data: { ...rest, size: `${width}x${height}` } };
                  }
                  return node;
                });
              }
              return task;
            });
          }
        }
        return persistedState as TaskState;
      },
    },
  ),
);