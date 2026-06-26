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

export type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;

export type AutomationMode = 'auto' | 'semi-auto' | 'manual';

/* ── Data models ────────────────────────────────────────────────────────── */

export interface Character {
  id: string;
  name: string;
  description: string;
  appearancePrompt: string;
  avatarUrl?: string;
  /** AI-generated portrait from appearancePrompt (text-to-image) */
  generatedPortraitUrl?: string;
  /** 资产一致性优化 - 用于标识角色在提示词中的命名空间 */
  assetNamespace: string;  // 如 "[Hero_A]"
  /** 自动生成的完整提示词 */
  fullPrompt: string;
  /** 多视角矩阵图 */
  multiViewUrl?: string;
}

export interface DialogueLine {
  id: string;
  characterId: string | null; // null = narrator
  text: string;
  delivery?: string; // e.g. "温柔地", for Phase 2 TTS
}

export interface Shot {
  id: string;
  index: number;
  scriptText: string;
  visualPrompt: string;
  motionPrompt: string;
  dialogues: DialogueLine[];
  activeCharacterIds: string[];
  duration: number;
  status: ShotStatus;
  imageUrl?: string;
  videoUrl?: string;
  videoProgress?: number;
  videoRetryCount?: number;
  error?: string;
  // Structured sub-elements for text-to-image (optional, composed into visualPrompt)
  subjectDesc?: string;      // Subject: "A young woman with long dark hair"
  sceneDesc?: string;        // Scene/background: "sitting in a sunlit cafe"
  detailDesc?: string;       // Details/clothing: "wearing a white blouse"
  lightingDesc?: string;     // Lighting/color: "warm golden hour light"
  styleDesc?: string;        // Art style: "photorealistic, 8k"
  negativePrompt?: string;   // Negative prompt: "bad anatomy, extra limbs"
  // Structured sub-elements for image-to-video (optional, composed into motionPrompt)
  actionDesc?: string;       // Subject action: "slowly turns her head"
  cameraDesc?: string;       // Camera movement: "camera slowly dollies in"
  envChangeDesc?: string;    // Environment changes: "steam rising from cup"
  motionSpeedDesc?: string;  // Motion speed: "cinematic slow-motion, 24fps"
  negativeMotionPrompt?: string; // Negative motion: "morphing, flickering"
  // 首尾帧控制
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  useDualFrame: boolean;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface SceneReference {
  id: string;
  name: string;         // 场景名称，如"城市街道"
  imageUrl?: string;    // 生成的场景参考图
  prompt: string;       // 英文生成提示词
  description: string;  // 中文描述
}

export interface Project {
  id: string;
  title: string;
  wizardStep: WizardStep;
  automationMode: AutomationMode;
  characters: Character[];
  aspectRatio: AspectRatio;
  style: string;
  language: "zh" | "en";
  shots: Shot[];
  status: ProjectStatus;
  error?: string;
  createdAt: number;
  updatedAt: number;
  /** Step 1: saved idea prompt text */
  ideaPrompt?: string;
  /** Step 1: saved AI chat history */
  ideaChatHistory?: ChatTurn[];
  /** Step 2: scene reference images for img2img consistency */
  sceneReferences?: SceneReference[];
  /** Step 2: overall style reference image URL */
  styleReferenceUrl?: string;
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

  /* Project actions */
  createProject: (title: string) => Project;
  switchProject: (id: string) => void;
  updateProject: (updates: Partial<Pick<Project, "title" | "aspectRatio" | "style" | "language" | "ideaPrompt" | "ideaChatHistory" | "sceneReferences" | "styleReferenceUrl">>) => void;
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

  /* Character actions */
  addCharacter: (character: Omit<Character, "id">) => Character;
  updateCharacter: (id: string, updates: Partial<Omit<Character, "id">>) => void;
  removeCharacter: (id: string) => void;

  /* Wizard step */
  setWizardStep: (step: WizardStep) => void;

  /* Automation mode */
  setAutomationMode: (mode: AutomationMode) => void;

  /* Scene reference actions */
  addSceneReference: (ref: Omit<SceneReference, "id">) => SceneReference;
  updateSceneReference: (id: string, updates: Partial<Omit<SceneReference, "id">>) => void;
  removeSceneReference: (id: string) => void;

  /* Dialogue actions */
  addDialogueLine: (shotId: string, line: Omit<DialogueLine, "id">) => void;
  updateDialogueLine: (shotId: string, lineId: string, updates: Partial<Omit<DialogueLine, "id">>) => void;
  removeDialogueLine: (shotId: string, lineId: string) => void;
  reorderDialogueLines: (shotId: string, fromIndex: number, toIndex: number) => void;
  setActiveCharacters: (shotId: string, characterIds: string[]) => void;

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

      /* ── Project actions ────────────────────────────────────────────── */

      createProject: (title) => {
        const now = Date.now();
        const project: Project = {
          id: newId("proj"),
          title,
          wizardStep: 1 as WizardStep,
          automationMode: 'semi-auto',
          characters: [],
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
          wizardStep: 1 as WizardStep,
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
          index: (get().projects.find((p) => p.id === get().activeProjectId)?.shots.length) ?? 0,
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

      /* ── Character actions ───────────────────────────────────────────── */

      addCharacter: (character) => {
        const newChar: Character = { ...character, id: newId("char") };
        set((s) => ({
          projects: updateActive(s.projects, s.activeProjectId, (p) => ({
            ...p,
            characters: [...p.characters, newChar],
            updatedAt: Date.now(),
          })),
        }));
        return newChar;
      },

      updateCharacter: (id, updates) =>
        set((s) => ({
          projects: updateActive(s.projects, s.activeProjectId, (p) => ({
            ...p,
            characters: p.characters.map((c) =>
              c.id === id ? { ...c, ...updates } : c,
            ),
            updatedAt: Date.now(),
          })),
        })),

      removeCharacter: (id) =>
        set((s) => ({
          projects: updateActive(s.projects, s.activeProjectId, (p) => ({
            ...p,
            characters: p.characters.filter((c) => c.id !== id),
            // Nullify dialogues referencing this character, remove from activeCharacterIds
            shots: p.shots.map((sh) => ({
              ...sh,
              activeCharacterIds: sh.activeCharacterIds.filter((cid) => cid !== id),
              dialogues: sh.dialogues.map((d) =>
                d.characterId === id ? { ...d, characterId: null } : d,
              ),
            })),
            updatedAt: Date.now(),
          })),
        })),

      setWizardStep: (step) =>
        set((s) => ({
          projects: updateActive(s.projects, s.activeProjectId, (p) => ({
            ...p,
            wizardStep: step,
            updatedAt: Date.now(),
          })),
        })),

      setAutomationMode: (mode) =>
        set((s) => ({
          projects: updateActive(s.projects, s.activeProjectId, (p) => ({
            ...p,
            automationMode: mode,
            updatedAt: Date.now(),
          })),
        })),

      /* ── Scene reference actions ─────────────────────────────────────── */

      addSceneReference: (ref) => {
        const newRef: SceneReference = { ...ref, id: newId("scene") };
        set((s) => ({
          projects: updateActive(s.projects, s.activeProjectId, (p) => ({
            ...p,
            sceneReferences: [...(p.sceneReferences ?? []), newRef],
            updatedAt: Date.now(),
          })),
        }));
        return newRef;
      },

      updateSceneReference: (id, updates) =>
        set((s) => ({
          projects: updateActive(s.projects, s.activeProjectId, (p) => ({
            ...p,
            sceneReferences: (p.sceneReferences ?? []).map((r) =>
              r.id === id ? { ...r, ...updates } : r,
            ),
            updatedAt: Date.now(),
          })),
        })),

      removeSceneReference: (id) =>
        set((s) => ({
          projects: updateActive(s.projects, s.activeProjectId, (p) => ({
            ...p,
            sceneReferences: (p.sceneReferences ?? []).filter((r) => r.id !== id),
            updatedAt: Date.now(),
          })),
        })),

      /* ── Dialogue actions ────────────────────────────────────────────── */

      addDialogueLine: (shotId, line) => {
        const newLine: DialogueLine = { ...line, id: newId("dlg") };
        set((s) => ({
          projects: updateActive(s.projects, s.activeProjectId, (p) => ({
            ...p,
            shots: p.shots.map((sh) =>
              sh.id === shotId
                ? { ...sh, dialogues: [...sh.dialogues, newLine] }
                : sh,
            ),
            updatedAt: Date.now(),
          })),
        }));
      },

      updateDialogueLine: (shotId, lineId, updates) =>
        set((s) => ({
          projects: updateActive(s.projects, s.activeProjectId, (p) => ({
            ...p,
            shots: p.shots.map((sh) =>
              sh.id === shotId
                ? {
                    ...sh,
                    dialogues: sh.dialogues.map((d) =>
                      d.id === lineId ? { ...d, ...updates } : d,
                    ),
                  }
                : sh,
            ),
            updatedAt: Date.now(),
          })),
        })),

      removeDialogueLine: (shotId, lineId) =>
        set((s) => ({
          projects: updateActive(s.projects, s.activeProjectId, (p) => ({
            ...p,
            shots: p.shots.map((sh) =>
              sh.id === shotId
                ? { ...sh, dialogues: sh.dialogues.filter((d) => d.id !== lineId) }
                : sh,
            ),
            updatedAt: Date.now(),
          })),
        })),

      reorderDialogueLines: (shotId, fromIndex, toIndex) =>
        set((s) => ({
          projects: updateActive(s.projects, s.activeProjectId, (p) => ({
            ...p,
            shots: p.shots.map((sh) => {
              if (sh.id !== shotId) return sh;
              const lines = [...sh.dialogues];
              const [moved] = lines.splice(fromIndex, 1);
              if (!moved) return sh;
              lines.splice(toIndex, 0, moved);
              return { ...sh, dialogues: lines };
            }),
            updatedAt: Date.now(),
          })),
        })),

      setActiveCharacters: (shotId, characterIds) =>
        set((s) => ({
          projects: updateActive(s.projects, s.activeProjectId, (p) => ({
            ...p,
            shots: p.shots.map((sh) =>
              sh.id === shotId ? { ...sh, activeCharacterIds: characterIds } : sh,
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
      version: 6,
      migrate: (persisted: unknown, version: number) => {
        // Migrate from v1 (single project) to v2 (multi-project)
        if (version < 2) {
          const old = persisted as Record<string, unknown>;
          const project = old.project as Project | null;
          if (project) {
            (persisted as Record<string, unknown>).projects = [project];
            (persisted as Record<string, unknown>).activeProjectId = project.id;
            (persisted as Record<string, unknown>).history = [];
          }
        }

        // Migrate from v2 to v3: add character system + dialogue system
        if (version < 3) {
          const state = persisted as {
            projects?: Array<Record<string, unknown>>;
          };
          if (state.projects) {
            state.projects = state.projects.map((p) => ({
              ...p,
              mode: "simple",
              characters: [],
              shots: ((p.shots as Array<Record<string, unknown>>) ?? []).map(
                (s) => ({
                  ...s,
                  dialogues: [],
                  activeCharacterIds: [],
                }),
              ),
            }));
          }
        }

        // Migrate from v3 to v4: add wizardStep + structured prompt sub-elements
        if (version < 4) {
          const state = persisted as {
            projects?: Array<Record<string, unknown>>;
          };
          if (state.projects) {
            state.projects = state.projects.map((p) => ({
              ...p,
              wizardStep: 1,
            }));
          }
        }

        // Migrate from v4 to v5: unified flow, remove mode, 4-step wizard
        if (version < 5) {
          const state = persisted as {
            projects?: Array<Record<string, unknown>>;
          };
          if (state.projects) {
            state.projects = state.projects.map((p) => {
              const { mode, ...rest } = p;
              // Map old wizard steps to new 4-step flow
              const oldStep = (p.wizardStep as number) ?? 1;
              let newStep: number;
              if (mode === "drama") {
                // drama: 1(chars)→skip, 2(idea)→1, 3(storyboard)→2, 4(images)→3, 5(videos)→3, 6(assembly)→4
                newStep = oldStep <= 1 ? 1 : oldStep === 2 ? 1 : oldStep === 3 ? 2 : 4;
              } else {
                // simple: 1(idea)→1, 2(storyboard)→2, 3(images)→3, 4(videos)→3, 5(assembly)→4
                newStep = oldStep <= 2 ? oldStep : oldStep <= 4 ? 3 : 4;
              }
              return { ...rest, wizardStep: newStep };
            });
          }
        }

        // Migrate from v5 to v6: add sceneReferences and styleReferenceUrl
        if (version < 6) {
          const state = persisted as {
            projects?: Array<Record<string, unknown>>;
          };
          if (state.projects) {
            state.projects = state.projects.map((p) => ({
              ...p,
              sceneReferences: (p.sceneReferences as unknown[]) ?? [],
              styleReferenceUrl: (p.styleReferenceUrl as string) ?? undefined,
            }));
          }
        }

        return persisted as Record<string, unknown>;
      },
    },
  ),
);

/**
 * Standalone selector for getting the active project.
 * Use with: const project = useProjectStore(selectActiveProject)
 * Zustand tracks `projects` and `activeProjectId` dependencies correctly.
 */
export const selectActiveProject = (s: ProjectState): Project | undefined =>
  s.projects.find((p) => p.id === s.activeProjectId);
