// ────────────────────────────────────────────────────────────────────────────
// src/stores/projectStore.ts
// Central store for the video pipeline project.
// Supports multiple projects, active project switching, and operation history.
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

export type HistoryAction =
  | "project_created"
  | "project_deleted"
  | "project_switched"
  | "script_generated"
  | "pipeline_started"
  | "pipeline_completed"
  | "pipeline_failed"
  | "shot_regenerated"
  | "settings_changed";

export interface HistoryEntry {
  id: string;
  projectId: string;
  action: HistoryAction;
  description: string;
  timestamp: number;
}

/* ── ID generator ───────────────────────────────────────────────────────── */

let counter = 0;
function newId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now()}_${counter}`;
}

/* ── Store shape ────────────────────────────────────────────────────────── */

interface ProjectState {
  /* Multi-project state */
  projects: Project[];
  activeProjectId: string | null;
  history: HistoryEntry[];

  /* Derived (computed via getter in component) */
  getActiveProject: () => Project | null;

  /* Project actions */
  createProject: (title: string) => Project;
  switchProject: (id: string) => void;
  updateProject: (updates: Partial<Pick<Project, "title" | "aspectRatio" | "style" | "language">>) => void;
  deleteProject: (id: string) => void;
  duplicateProject: (id: string) => Project | null;
  setProjectStatus: (status: ProjectStatus, error?: string) => void;
  clearProject: () => void;

  /* Shot actions */
  setShots: (shots: Shot[]) => void;
  addShot: (shot: Omit<Shot, "id" | "index" | "status">) => Shot;
  updateShot: (id: string, updates: Partial<Omit<Shot, "id" | "index">>) => void;
  removeShot: (id: string) => void;
  reorderShots: (fromIndex: number, toIndex: number) => void;
  setShotStatus: (id: string, status: ShotStatus, error?: string) => void;

  /* History actions */
  addHistory: (action: HistoryAction, description: string) => void;
  clearHistory: () => void;
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

function updateActive(
  projects: Project[],
  activeProjectId: string | null,
  updater: (p: Project) => Project,
): Project[] {
  if (!activeProjectId) return projects;
  return projects.map((p) => (p.id === activeProjectId ? updater(p) : p));
}

/* ── Store ──────────────────────────────────────────────────────────────── */

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      projects: [],
      activeProjectId: null,
      history: [],

      getActiveProject: () => {
        const { projects, activeProjectId } = get();
        return projects.find((p) => p.id === activeProjectId) ?? null;
      },

      /* ── Project actions ────────────────────────────────────────────── */

      createProject: (title) => {
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
        set((s) => ({
          projects: [...s.projects, project],
          activeProjectId: project.id,
        }));
        get().addHistory("project_created", `创建项目「${title}」`);
        return project;
      },

      switchProject: (id) => {
        const project = get().projects.find((p) => p.id === id);
        if (!project) return;
        set({ activeProjectId: id });
        get().addHistory("project_switched", `切换到项目「${project.title}」`);
      },

      updateProject: (updates) =>
        set((s) => ({
          projects: updateActive(s.projects, s.activeProjectId, (p) => ({
            ...p,
            ...updates,
            updatedAt: Date.now(),
          })),
        })),

      deleteProject: (id) => {
        const project = get().projects.find((p) => p.id === id);
        if (!project) return;
        set((s) => {
          const remaining = s.projects.filter((p) => p.id !== id);
          const newActiveId =
            s.activeProjectId === id
              ? remaining.length > 0
                ? remaining[remaining.length - 1].id
                : null
              : s.activeProjectId;
          return { projects: remaining, activeProjectId: newActiveId };
        });
        get().addHistory("project_deleted", `删除项目「${project.title}」`);
      },

      duplicateProject: (id) => {
        const source = get().projects.find((p) => p.id === id);
        if (!source) return null;
        const now = Date.now();
        const dup: Project = {
          ...structuredClone(source),
          id: newId("proj"),
          title: `${source.title} (副本)`,
          status: "idle",
          shots: source.shots.map((sh, i) => ({
            ...sh,
            id: newId("shot"),
            index: i,
            status: "idle" as const,
            error: undefined,
            videoProgress: undefined,
          })),
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({
          projects: [...s.projects, dup],
          activeProjectId: dup.id,
        }));
        get().addHistory("project_created", `复制项目「${source.title}」`);
        return dup;
      },

      setProjectStatus: (status, error) =>
        set((s) => ({
          projects: updateActive(s.projects, s.activeProjectId, (p) => ({
            ...p,
            status,
            error,
            updatedAt: Date.now(),
          })),
        })),

      clearProject: () => {
        const { activeProjectId } = get();
        if (!activeProjectId) return;
        set((s) => ({
          projects: s.projects.filter((p) => p.id !== activeProjectId),
          activeProjectId:
            s.projects.length > 1
              ? s.projects.find((p) => p.id !== activeProjectId)?.id ?? null
              : null,
        }));
        get().addHistory("project_deleted", "清空当前项目");
      },

      /* ── Shot actions ───────────────────────────────────────────────── */

      setShots: (shots) =>
        set((s) => ({
          projects: updateActive(s.projects, s.activeProjectId, (p) => ({
            ...p,
            shots: shots.map((sh, i) => ({ ...sh, index: i })),
            updatedAt: Date.now(),
          })),
        })),

      addShot: (shot) => {
        const newShot: Shot = {
          ...shot,
          id: newId("shot"),
          index: get().getActiveProject()?.shots.length ?? 0,
          status: "idle",
        };
        set((s) => ({
          projects: updateActive(s.projects, s.activeProjectId, (p) => ({
            ...p,
            shots: [...p.shots, newShot],
            updatedAt: Date.now(),
          })),
        }));
        return newShot;
      },

      updateShot: (id, updates) =>
        set((s) => ({
          projects: updateActive(s.projects, s.activeProjectId, (p) => ({
            ...p,
            shots: p.shots.map((sh) =>
              sh.id === id ? { ...sh, ...updates } : sh,
            ),
            updatedAt: Date.now(),
          })),
        })),

      removeShot: (id) =>
        set((s) => ({
          projects: updateActive(s.projects, s.activeProjectId, (p) => ({
            ...p,
            shots: p.shots
              .filter((sh) => sh.id !== id)
              .map((sh, i) => ({ ...sh, index: i })),
            updatedAt: Date.now(),
          })),
        })),

      reorderShots: (fromIndex, toIndex) =>
        set((s) => ({
          projects: updateActive(s.projects, s.activeProjectId, (p) => {
            const shots = [...p.shots];
            const [moved] = shots.splice(fromIndex, 1);
            if (!moved) return p;
            shots.splice(toIndex, 0, moved);
            return {
              ...p,
              shots: shots.map((sh, i) => ({ ...sh, index: i })),
              updatedAt: Date.now(),
            };
          }),
        })),

      setShotStatus: (id, status, error) =>
        set((s) => ({
          projects: updateActive(s.projects, s.activeProjectId, (p) => ({
            ...p,
            shots: p.shots.map((sh) =>
              sh.id === id ? { ...sh, status, error } : sh,
            ),
            updatedAt: Date.now(),
          })),
        })),

      /* ── History actions ────────────────────────────────────────────── */

      addHistory: (action, description) => {
        const { activeProjectId } = get();
        const entry: HistoryEntry = {
          id: newId("hist"),
          projectId: activeProjectId ?? "",
          action,
          description,
          timestamp: Date.now(),
        };
        set((s) => ({
          history: [...s.history.slice(-199), entry], // keep last 200
        }));
      },

      clearHistory: () => set({ history: [] }),
    }),
    {
      name: "wxhb-project",
      version: 2,
      migrate: (persisted: unknown, version: number) => {
        // Migrate from v1 (single project) to v2 (multi-project)
        if (version < 2) {
          const old = persisted as Record<string, unknown>;
          const project = old.project as Project | null;
          if (project) {
            return {
              projects: [project],
              activeProjectId: project.id,
              history: [],
            } as Record<string, unknown>;
          }
        }
        return persisted as Record<string, unknown>;
      },
    },
  ),
);
