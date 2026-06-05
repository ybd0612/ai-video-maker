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

export interface HistoryEntry {
  canvasData: CanvasSnapshot;
  savedAt: number;
  label: string;
}

export interface Task {
  id: string;
  name: string;
  description: string;
  canvasData: CanvasSnapshot;
  history: HistoryEntry[];
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
  pushHistory: (taskId: string, label?: string) => void;
  restoreFromHistory: (taskId: string, index: number) => void;
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
          history: [],
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
            const updated = { ...t, ...updates, updatedAt: Date.now() };
            if (updates.canvasData) {
              // Push current canvasData to history before overwriting
              const entry: HistoryEntry = {
                canvasData: t.canvasData,
                savedAt: Date.now(),
                label: new Date().toLocaleTimeString(),
              };
              updated.history = [...(t.history ?? []), entry].slice(-20); // keep last 20
              updated.canvasData = { ...updates.canvasData, capturedAt: Date.now() };
            }
            return updated;
          }),
        })),

      deleteTask: (id) =>
        set((s) => ({
          tasks: s.tasks.filter((t) => t.id !== id),
          activeTaskId: s.activeTaskId === id ? null : s.activeTaskId,
        })),

      setActiveTaskId: (id) => set({ activeTaskId: id }),

      getTaskById: (id) => get().tasks.find((t) => t.id === id),

      pushHistory: (taskId, label) =>
        set((s) => ({
          tasks: s.tasks.map((t) => {
            if (t.id !== taskId) return t;
            const entry: HistoryEntry = {
              canvasData: t.canvasData,
              savedAt: Date.now(),
              label: label ?? new Date().toLocaleTimeString(),
            };
            return { ...t, history: [...(t.history ?? []), entry].slice(-20) };
          }),
        })),

      restoreFromHistory: (taskId, index) =>
        set((s) => ({
          tasks: s.tasks.map((t) => {
            if (t.id !== taskId) return t;
            const entry = t.history?.[index];
            if (!entry) return t;
            // Push current state to history before restoring
            const current: HistoryEntry = {
              canvasData: t.canvasData,
              savedAt: Date.now(),
              label: "Before restore: " + new Date().toLocaleTimeString(),
            };
            return {
              ...t,
              canvasData: entry.canvasData,
              history: [...(t.history ?? []), current].slice(-20),
              updatedAt: Date.now(),
            };
          }),
        })),
    }),
    { name: "wxhb-tasks" },
  ),
);
