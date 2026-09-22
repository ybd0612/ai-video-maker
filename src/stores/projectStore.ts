// ────────────────────────────────────────────────────────────────────────────
// src/stores/projectStore.ts
// 多项目状态 store（Zustand + persist）。
// 结构（2026-09-15 拆分）：类型 → projectTypes.ts；迁移链 → projectMigrations.ts；
// 纯操作函数 → projectOps.ts；本文件只保留 store 实现与 selectors，
// 并 re-export 兼容入口（全项目 import 路径不变）。
// ────────────────────────────────────────────────────────────────────────────

import { create } from "zustand";
import { persist } from "zustand/middleware";

import {
  applyAssetUpdate,
  applyShotUpdates,
  hasAnyField,
  invalidateShotForAsset,
  newId,
  updateActive,
  STORYBOARD_SHOT_FIELDS,
  VISUAL_SHOT_FIELDS,
} from "./projectOps";
import { migratePersistedState } from "./projectMigrations";
import type { Asset, DialogueLine, Project, ProjectState, Shot, VisualDirection, WizardStep } from "./projectTypes";

// 兼容 re-export：全项目统一从 "@/stores/projectStore" 导入
export type {
  ProjectStatus, ShotStatus, AspectRatio, WizardStep, AutomationMode,
  StyleDetails, VisualDirection, AssetType, AssetDerivation,
  CharacterDetails, SceneDetails, ProductDetails, PropDetails, AssetDetails,
  Asset, DialogueLine, Shot, ChatTurn, Project, ProjectState,
} from "./projectTypes";
export { newId, applyShotUpdates, applyAssetUpdate } from "./projectOps";
export { migratePersistedState } from "./projectMigrations";

/* ── Store ──────────────────────────────────────────────────────────────── */

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      projects: [],
      activeProjectId: null,

      /* ── Project actions ────────────────────────────────────────────── */

      createProject: (title) => {
        const now = Date.now();
        const project: Project = {
          id: newId("proj"),
          title,
          wizardStep: 1 as WizardStep,
          automationMode: 'semi-auto',
          assets: [],
          aspectRatio: "16:9",
          style: "",
          language: "zh",
          shots: [],
          status: "idle",
          assetGenerationStarted: false,
          imageGenerationStarted: false,
          videoGenerationStarted: false,
          assetsReviewed: false,
          storyboardReviewed: false,
          imagesReviewed: false,
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({
          projects: [...s.projects, project],
          activeProjectId: project.id,
        }));
        return project;
      },

      switchProject: (id) => {
        const project = get().projects.find((p) => p.id === id);
        if (!project) return;
        set({ activeProjectId: id });
      },

      updateProject: (updates) =>
        set((s) => ({
          projects: updateActive(s.projects, s.activeProjectId, (p) => ({
            ...p,
            ...updates,
            updatedAt: Date.now(),
          })),
        })),

      updateProjectById: (projectId, updater) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId ? { ...updater(p), updatedAt: Date.now() } : p,
          ),
        })),

      updateVisualDirection: (updates) =>
        set((s) => ({
          projects: updateActive(s.projects, s.activeProjectId, (p) => {
            if (!p.visualDirection) return p;
            const nextDirection: VisualDirection = {
              ...p.visualDirection,
              ...updates,
              revision: p.visualDirection.revision + 1,
              status: "stale",
            };
            return {
              ...p,
              visualDirection: nextDirection,
              styleReferenceUrl: undefined,
              styleReferenceError: undefined,
              assetsReviewed: false,
              assets: p.assets.map((asset) =>
                asset.type === "style"
                  ? { ...asset, imageUrl: undefined, prompt: "", derivation: { ...asset.derivation, locked: false, dirty: true } }
                  : { ...asset, imageUrl: undefined },
              ),
              updatedAt: Date.now(),
            };
          }),
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
      },

      duplicateProject: (id) => {
        const source = get().projects.find((p) => p.id === id);
        if (!source) return null;
        const now = Date.now();
        const dupShots = source.shots.map((sh, i) => ({
          ...sh,
          id: newId("shot"),
          index: i,
          status: "idle" as const,
          error: undefined,
          videoProgress: undefined,
        }));
        // 按复制内容推断向导步骤：有分镜 → 3；全部有图 → 4；全部有视频 → 5。
        // 避免复制完成后被重置回步骤 1，需连点多次“下一步”才能回到原进度。
        const allImaged = dupShots.length > 0 && dupShots.every((sh) => !!sh.imageUrl);
        const allVideoed = allImaged && dupShots.every((sh) => !!sh.videoUrl);
        const wizardStep: WizardStep = allVideoed ? 5 : allImaged ? 4 : dupShots.length > 0 ? 3 : 1;
        const dup: Project = {
          ...structuredClone(source),
          id: newId("proj"),
          title: `${source.title} (副本)`,
          status: "idle",
          wizardStep,
          shots: dupShots,
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({
          projects: [...s.projects, dup],
          activeProjectId: dup.id,
        }));
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

      setProjectStatusById: (projectId, status, error) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId ? { ...p, status, error, updatedAt: Date.now() } : p,
          ),
        })),

      /* ── Shot actions ───────────────────────────────────────────────── */

      setShots: (shots) =>
        set((s) => ({
          projects: updateActive(s.projects, s.activeProjectId, (p) => ({
            ...p,
            shots: shots.map((sh, i) => ({ ...sh, index: i })),
            storyboardReviewed: false,
            imagesReviewed: false,
            updatedAt: Date.now(),
          })),
        })),

      setShotsByProjectId: (projectId, shots) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  shots: shots.map((sh, i) => ({ ...sh, index: i })),
                  storyboardReviewed: false,
                  imagesReviewed: false,
                  updatedAt: Date.now(),
                }
              : p,
          ),
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
            storyboardReviewed: false,
            imagesReviewed: false,
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
              sh.id === id ? applyShotUpdates(sh, updates) : sh,
            ),
            storyboardReviewed: hasAnyField(updates, STORYBOARD_SHOT_FIELDS)
              ? false
              : p.storyboardReviewed,
            imagesReviewed: hasAnyField(updates, VISUAL_SHOT_FIELDS) || "imageUrl" in updates
              ? false
              : p.imagesReviewed,
            updatedAt: Date.now(),
          })),
        })),

      updateShotByProjectId: (projectId, id, updates) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  shots: p.shots.map((sh) =>
                    sh.id === id ? applyShotUpdates(sh, updates) : sh,
                  ),
                  storyboardReviewed: hasAnyField(updates, STORYBOARD_SHOT_FIELDS)
                    ? false
                    : p.storyboardReviewed,
                  imagesReviewed: hasAnyField(updates, VISUAL_SHOT_FIELDS) || "imageUrl" in updates
                    ? false
                    : p.imagesReviewed,
                  updatedAt: Date.now(),
                }
              : p,
          ),
        })),

      updateShotByProjectIdIfRevision: (projectId, id, expectedRevision, updates) => {
        let updated = false;
        set((s) => ({
          projects: s.projects.map((p) => {
            if (p.id !== projectId) return p;
            const shot = p.shots.find((item) => item.id === id);
            if (!shot || (shot.renderRevision ?? 0) !== expectedRevision) return p;
            updated = true;
            return {
              ...p,
              shots: p.shots.map((sh) =>
                sh.id === id ? applyShotUpdates(sh, updates) : sh,
              ),
              storyboardReviewed: hasAnyField(updates, STORYBOARD_SHOT_FIELDS)
                ? false
                : p.storyboardReviewed,
              imagesReviewed: hasAnyField(updates, VISUAL_SHOT_FIELDS) || "imageUrl" in updates
                ? false
                : p.imagesReviewed,
              updatedAt: Date.now(),
            };
          }),
        }));
        return updated;
      },

      removeShot: (id) =>
        set((s) => ({
          projects: updateActive(s.projects, s.activeProjectId, (p) => ({
            ...p,
            shots: p.shots
              .filter((sh) => sh.id !== id)
              .map((sh, i) => ({ ...sh, index: i })),
            storyboardReviewed: false,
            imagesReviewed: false,
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
              storyboardReviewed: false,
              imagesReviewed: false,
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

      setShotStatusByProjectId: (projectId, id, status, error) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  shots: p.shots.map((sh) => sh.id === id ? { ...sh, status, error } : sh),
                  updatedAt: Date.now(),
                }
              : p,
          ),
        })),

      setShotStatusByProjectIdIfRevision: (projectId, id, expectedRevision, status, error) => {
        let updated = false;
        set((s) => ({
          projects: s.projects.map((p) => {
            if (p.id !== projectId) return p;
            const shot = p.shots.find((item) => item.id === id);
            if (!shot || (shot.renderRevision ?? 0) !== expectedRevision) return p;
            updated = true;
            return {
              ...p,
              shots: p.shots.map((sh) => sh.id === id ? { ...sh, status, error } : sh),
              updatedAt: Date.now(),
            };
          }),
        }));
        return updated;
      },

      /* ── Asset actions（角色/场景/产品统一资产） ─────────────────────── */

      addAsset: (asset) => {
        // 手动添加的资产标记来源；重新提取（extractCharactersFromIdea）时会保留 manual 资产
        const newAsset: Asset = { source: "manual", ...asset, id: newId("asset") };
        set((s) => ({
          projects: updateActive(s.projects, s.activeProjectId, (p) => ({
            ...p,
            assets: [...p.assets, newAsset],
            assetsReviewed: false,
            updatedAt: Date.now(),
          })),
        }));
        return newAsset;
      },

      updateAsset: (id, updates) =>
        set((s) => ({
          projects: updateActive(s.projects, s.activeProjectId, (p) => ({
            ...applyAssetUpdate(p, id, updates),
            updatedAt: Date.now(),
          })),
        })),

      updateAssetByProjectId: (projectId, id, updates) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? { ...applyAssetUpdate(p, id, updates), updatedAt: Date.now() }
              : p,
          ),
        })),

      updateAssetByProjectIdIfRevision: (projectId, id, expectedRevision, updates) => {
        let updated = false;
        set((s) => ({
          projects: s.projects.map((p) => {
            if (p.id !== projectId) return p;
            const asset = p.assets.find((item) => item.id === id);
            if (!asset || (asset.renderRevision ?? 0) !== expectedRevision) return p;
            updated = true;
            return { ...applyAssetUpdate(p, id, updates), updatedAt: Date.now() };
          }),
        }));
        return updated;
      },

      removeAsset: (id) =>
        set((s) => ({
          projects: updateActive(s.projects, s.activeProjectId, (p) => ({
            ...p,
            assets: p.assets.filter((a) => a.id !== id),
            // 删除资产时清理镜头引用；受影响镜头的图片/视频也必须失效，避免继续使用已删除的参考图。
            assetsReviewed: false,
            storyboardReviewed: false,
            imagesReviewed: false,
            shots: p.shots.map((sh) => {
              const nextShot = {
                ...sh,
                activeCharacterIds: (sh.activeCharacterIds ?? []).filter((cid) => cid !== id),
                activeSceneId: sh.activeSceneId === id ? undefined : sh.activeSceneId,
                activeProductIds: (sh.activeProductIds ?? []).filter((assetId) => assetId !== id),
                activePropIds: (sh.activePropIds ?? []).filter((assetId) => assetId !== id),
                dialogues: (sh.dialogues ?? []).map((d) =>
                  d.characterId === id ? { ...d, characterId: null } : d,
                ),
              };
              return nextShot.activeCharacterIds.length !== (sh.activeCharacterIds ?? []).length ||
                nextShot.activeSceneId !== sh.activeSceneId ||
                nextShot.activeProductIds.length !== (sh.activeProductIds ?? []).length ||
                nextShot.activePropIds.length !== (sh.activePropIds ?? []).length ||
                nextShot.dialogues.some((line, index) => line.characterId !== sh.dialogues?.[index]?.characterId)
                ? invalidateShotForAsset(nextShot)
                : nextShot;
            }),
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

      /* ── Dialogue actions ────────────────────────────────────────────── */

      addDialogueLine: (shotId, line) => {
        const newLine: DialogueLine = { ...line, id: newId("dlg") };
        set((s) => ({
          projects: updateActive(s.projects, s.activeProjectId, (p) => ({
            ...p,
            shots: p.shots.map((sh) =>
              sh.id === shotId
                ? applyShotUpdates(sh, { dialogues: [...(sh.dialogues ?? []), newLine] })
                : sh,
            ),
            storyboardReviewed: false,
            imagesReviewed: false,
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
                ? applyShotUpdates(sh, {
                    dialogues: (sh.dialogues ?? []).map((d) =>
                      d.id === lineId ? { ...d, ...updates } : d,
                    ),
                  })
                : sh,
            ),
            storyboardReviewed: false,
            imagesReviewed: false,
            updatedAt: Date.now(),
          })),
        })),

      removeDialogueLine: (shotId, lineId) =>
        set((s) => ({
          projects: updateActive(s.projects, s.activeProjectId, (p) => ({
            ...p,
            shots: p.shots.map((sh) =>
              sh.id === shotId
                ? applyShotUpdates(sh, { dialogues: (sh.dialogues ?? []).filter((d) => d.id !== lineId) })
                : sh,
            ),
            storyboardReviewed: false,
            imagesReviewed: false,
            updatedAt: Date.now(),
          })),
        })),

      reorderDialogueLines: (shotId, fromIndex, toIndex) =>
        set((s) => ({
          projects: updateActive(s.projects, s.activeProjectId, (p) => {
            let changed = false;
            const shots = p.shots.map((sh) => {
              if (sh.id !== shotId) return sh;
              const lines = [...(sh.dialogues ?? [])];
              const [moved] = lines.splice(fromIndex, 1);
              if (!moved) return sh;
              lines.splice(toIndex, 0, moved);
              changed = true;
              return applyShotUpdates(sh, { dialogues: lines });
            });
            return {
              ...p,
              shots,
              storyboardReviewed: changed ? false : p.storyboardReviewed,
              imagesReviewed: changed ? false : p.imagesReviewed,
              updatedAt: Date.now(),
            };
          }),
        })),

      setActiveCharacters: (shotId, characterIds) =>
        set((s) => ({
          projects: updateActive(s.projects, s.activeProjectId, (p) => ({
            ...p,
            shots: p.shots.map((sh) =>
              sh.id === shotId ? applyShotUpdates(sh, { activeCharacterIds: characterIds }) : sh,
            ),
            storyboardReviewed: false,
            imagesReviewed: false,
            updatedAt: Date.now(),
          })),
        })),

      setActiveScene: (shotId, sceneId) =>
        set((s) => ({
          projects: updateActive(s.projects, s.activeProjectId, (p) => ({
            ...p,
            shots: p.shots.map((sh) =>
              sh.id === shotId ? applyShotUpdates(sh, { activeSceneId: sceneId }) : sh,
            ),
            storyboardReviewed: false,
            imagesReviewed: false,
            updatedAt: Date.now(),
          })),
        })),

      setActiveProducts: (shotId, productIds) =>
        set((s) => ({
          projects: updateActive(s.projects, s.activeProjectId, (p) => ({
            ...p,
            shots: p.shots.map((sh) =>
              sh.id === shotId ? applyShotUpdates(sh, { activeProductIds: productIds }) : sh,
            ),
            storyboardReviewed: false,
            imagesReviewed: false,
            updatedAt: Date.now(),
          })),
        })),

      setActiveProps: (shotId, propIds) =>
        set((s) => ({
          projects: updateActive(s.projects, s.activeProjectId, (p) => ({
            ...p,
            shots: p.shots.map((sh) =>
              sh.id === shotId ? applyShotUpdates(sh, { activePropIds: propIds }) : sh,
            ),
            storyboardReviewed: false,
            imagesReviewed: false,
            updatedAt: Date.now(),
          })),
        })),

      /* ── Generation started flags ──────────────────────────────────── */

      setAssetGenerationStarted: (v) =>
        set((s) => ({
          projects: updateActive(s.projects, s.activeProjectId, (p) => ({
            ...p,
            assetGenerationStarted: v,
            updatedAt: Date.now(),
          })),
        })),

      setImageGenerationStarted: (v) =>
        set((s) => ({
          projects: updateActive(s.projects, s.activeProjectId, (p) => ({
            ...p,
            imageGenerationStarted: v,
            updatedAt: Date.now(),
          })),
        })),

      setAssetGenerationStartedByProjectId: (projectId, v) =>
        set((s) => ({ projects: s.projects.map((p) => p.id === projectId ? { ...p, assetGenerationStarted: v, updatedAt: Date.now() } : p) })),

      setImageGenerationStartedByProjectId: (projectId, v) =>
        set((s) => ({ projects: s.projects.map((p) => p.id === projectId ? { ...p, imageGenerationStarted: v, updatedAt: Date.now() } : p) })),

      setVideoGenerationStarted: (v) =>
        set((s) => ({
          projects: updateActive(s.projects, s.activeProjectId, (p) => ({
            ...p,
            videoGenerationStarted: v,
            updatedAt: Date.now(),
          })),
        })),

      setVideoGenerationStartedByProjectId: (projectId, v) =>
        set((s) => ({ projects: s.projects.map((p) => p.id === projectId ? { ...p, videoGenerationStarted: v, updatedAt: Date.now() } : p) })),
    }),
    {
      name: "wxhb-project",
      version: 16,
      // 迁移主体提取为导出纯函数 migratePersistedState（见文件上方），便于单测
      migrate: (persisted: unknown, version: number) =>
        migratePersistedState(persisted, version),
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
