// ────────────────────────────────────────────────────────────────────────────
// src/stores/projectStore.ts
// Central store for the video pipeline project.
// Replaces canvasStore + taskStore with a flat project → shots model.
// ────────────────────────────────────────────────────────────────────────────

import { create } from "zustand";
import { persist } from "zustand/middleware";

/* ── Status enums ───────────────────────────────────────────────────────── */

export type ProjectStatus =
  | "idle"
  | "scripting"
  | "imaging"
  | "videoing"
  | "rendering"
  | "done"
  | "failed";

export type ShotStatus =
  | "idle"
  | "scripting"
  | "scripted"
  | "imaging"
  | "imaged"
  | "videoing"
  | "videoed"
  | "failed";

export type AspectRatio = "9:16" | "16:9" | "1:1";

/* ── Data models ────────────────────────────────────────────────────────── */

export interface Shot {
  id: string;
  index: number;
  scriptText: string;
  visualPrompt: string;
  duration: number;
  status: ShotStatus;
  imageUrl?: string;
  videoUrl?: string;
  videoProgress?: number;
  error?: string;
}

export interface Project {
  id: string;
  title: string;
  aspectRatio: AspectRatio;
  style: string;
  language: "zh" | "en";
  shots: Shot[];
  status: ProjectStatus;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

/* ── ID generator ───────────────────────────────────────────────────────── */

let counter = 0;
function newId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now()}_${counter}`;
}

/* ── Store shape ────────────────────────────────────────────────────────── */

interface ProjectState {
  project: Project | null;

  /* Project actions */
  createProject: (title: string, prompt: string) => Project;
  updateProject: (updates: Partial<Pick<Project, "title" | "aspectRatio" | "style" | "language">>) => void;
  setProjectStatus: (status: ProjectStatus, error?: string) => void;
  clearProject: () => void;

  /* Shot actions */
  setShots: (shots: Shot[]) => void;
  addShot: (shot: Omit<Shot, "id" | "index" | "status">) => Shot;
  updateShot: (id: string, updates: Partial<Omit<Shot, "id" | "index">>) => void;
  removeShot: (id: string) => void;
  reorderShots: (fromIndex: number, toIndex: number) => void;
  setShotStatus: (id: string, status: ShotStatus, error?: string) => void;
}

/* ── Store ──────────────────────────────────────────────────────────────── */

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      project: null,

      createProject: (title, _prompt) => {
        const now = Date.now();
        const project: Project = {
          id: newId("proj"),
          title,
          aspectRatio: "16:9",
          style: "",
          language: "zh",
          shots: [],
          status: "idle",
          createdAt: now,
          updatedAt: now,
        };
        set({ project });
        return project;
      },

      updateProject: (updates) =>
        set((s) => {
          if (!s.project) return s;
          return { project: { ...s.project, ...updates, updatedAt: Date.now() } };
        }),

      setProjectStatus: (status, error) =>
        set((s) => {
          if (!s.project) return s;
          return {
            project: {
              ...s.project,
              status,
              error,
              updatedAt: Date.now(),
            },
          };
        }),

      clearProject: () => set({ project: null }),

      setShots: (shots) =>
        set((s) => {
          if (!s.project) return s;
          const indexed = shots.map((sh, i) => ({ ...sh, index: i }));
          return { project: { ...s.project, shots: indexed, updatedAt: Date.now() } };
        }),

      addShot: (shot) => {
        const newShot: Shot = {
          ...shot,
          id: newId("shot"),
          index: get().project?.shots.length ?? 0,
          status: "idle",
        };
        set((s) => {
          if (!s.project) return s;
          return {
            project: {
              ...s.project,
              shots: [...s.project.shots, newShot],
              updatedAt: Date.now(),
            },
          };
        });
        return newShot;
      },

      updateShot: (id, updates) =>
        set((s) => {
          if (!s.project) return s;
          return {
            project: {
              ...s.project,
              shots: s.project.shots.map((sh) =>
                sh.id === id ? { ...sh, ...updates } : sh,
              ),
              updatedAt: Date.now(),
            },
          };
        }),

      removeShot: (id) =>
        set((s) => {
          if (!s.project) return s;
          const filtered = s.project.shots
            .filter((sh) => sh.id !== id)
            .map((sh, i) => ({ ...sh, index: i }));
          return { project: { ...s.project, shots: filtered, updatedAt: Date.now() } };
        }),

      reorderShots: (fromIndex, toIndex) =>
        set((s) => {
          if (!s.project) return s;
          const shots = [...s.project.shots];
          const [moved] = shots.splice(fromIndex, 1);
          if (!moved) return s;
          shots.splice(toIndex, 0, moved);
          const reindexed = shots.map((sh, i) => ({ ...sh, index: i }));
          return { project: { ...s.project, shots: reindexed, updatedAt: Date.now() } };
        }),

      setShotStatus: (id, status, error) =>
        set((s) => {
          if (!s.project) return s;
          return {
            project: {
              ...s.project,
              shots: s.project.shots.map((sh) =>
                sh.id === id ? { ...sh, status, error } : sh,
              ),
              updatedAt: Date.now(),
            },
          };
        }),
    }),
    {
      name: "wxhb-project",
      version: 1,
    },
  ),
);



