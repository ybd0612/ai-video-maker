// ────────────────────────────────────────────────────────────────────────────
// src/stores/taskStore.ts
// Task management store — saves/loads canvas snapshots as named tasks.
// Each task holds a full canvasData snapshot (nodes + edges + viewport).
// Persisted to localStorage for instant access.
// ────────────────────────────────────────────────────────────────────────────

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Node, Edge, Viewport } from "@xyflow/react";

/* ── Task data model ────────────────────────────────────────────────────── */

export interface CanvasSnapshot {
  nodes: Node<Record<string, unknown>>[];
  edges: Edge[];
  viewport: Viewport;
  capturedAt: number;
}

export interface Task {
  id: string;
  name: string;
  description: string;
  canvasData: CanvasSnapshot;
  createdAt: number;
  updatedAt: number;
}

/* ── Store shape ────────────────────────────────────────────────────────── */

interface TaskState {
  tasks: Task[];
  activeTaskId: string | null;

  createTask: (name: string, canvasData: CanvasSnapshot, description?: string) => Task;
  updateTask: (id: string, updates: Partial<Pick<Task, "name" | "description" | "canvasData">>) => void;
  deleteTask: (id: string) => void;
  setActiveTaskId: (id: string | null) => void;
  getTaskById: (id: string) => Task | undefined;
}

/* ── ID generator ──────────────────────────────────────────────────────── */

let counter = 0;
function newId(): string {
  counter += 1;
  return `task__${Date.now()}_${counter}`;
}

/* ── Store ──────────────────────────────────────────────────────────────── */

export const useTaskStore = create<TaskState>()(
  persist(
    (set, get) => ({
      tasks: [],
      activeTaskId: null,

      createTask: (name, canvasData, description = "") => {
        const now = Date.now();
        const task: Task = {
          id: newId(),
          name,
          description,
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

      setActiveTaskId: (id) => set({ activeTaskId: id }),

      getTaskById: (id) => get().tasks.find((t) => t.id === id),
    }),
    { name: "wxhb-tasks" },
  ),
);