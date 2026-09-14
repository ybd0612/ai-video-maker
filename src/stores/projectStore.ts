// ────────────────────────────────────────────────────────────────────────────
// src/stores/projectStore.ts
// Central store for the video pipeline project.
// Supports multiple projects, active project switching, and operation history.
// ────────────────────────────────────────────────────────────────────────────

import { create } from "zustand";
import { persist } from "zustand/middleware";
// 仅类型导入（verbatimModuleSyntax 下运行时零依赖，无循环加载风险）
import type { L10nText } from "@/i18n";
import { normalizeCharacterDescription } from "@/lib/promptComposer";

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

export type AutomationMode = 'auto' | 'semi-auto';

/** 项目级视觉方向：资产与分镜共享的视觉母版。旧项目通过 style 字段兼容。 */
export interface VisualDirection {
  name: string;
  mediumMaterial: string;
  colorPalette: string;
  lightingMood: string;
  cameraTexture: string;
  composition: string;
  emotion: string;
  revision: number;
  status: "draft" | "confirmed" | "stale";
}

/* ── Asset model（角色/场景/产品统一为资产） ────────────────────────────── */

/** 资产类型：style 为整体风格锚点（B 方案新增，复用现有字段零新列） */
export type AssetType = "character" | "scene" | "product" | "prop" | "style";

/** 资产派生元数据（懒派生 dirty + 锁定）。缺省视为 { locked: false, dirty: false } */
export interface AssetDerivation {
  /** true = 派生物已被用户确认/历史遗留，自动派生不得覆盖 */
  locked?: boolean;
  /** true = 源字段（description 等）已被修改，派生物（prompt 等）需要重新派生 */
  dirty?: boolean;
}

/** 分镜派生锁定（画面/动态提示词各自独立） */
export interface ShotDerivation {
  visualLocked?: boolean;
  motionLocked?: boolean;
  visualDirty?: boolean;
  motionDirty?: boolean;
}

export interface Asset {
  id: string;
  type: AssetType;
  name: string;
  description: string;
  /** 英文参考图生成提示词（scene/product 直接使用；character 与 appearancePrompt 一致；
   *  style 资产专有语义：英文风格提示词 stylePrompt，L2 派生自 ideaPrompt+中文风格描述，
   *  硬性禁止出现角色/生物/人物） */
  prompt: string;
  /** 生成的参考图（角色=定妆照、场景=场景参考图、产品=产品参考图、风格=风格参考图） */
  imageUrl?: string;
  /** 参考图生成失败原因（便于 UI 展示重试入口） */
  error?: string;
  /** 以下仅 character 类型使用 */
  appearancePrompt?: string;
  /** 资产一致性优化 - 用于标识角色在提示词中的命名空间 */
  assetNamespace?: string;
  /** 自动生成的完整提示词 */
  fullPrompt?: string;
  /** 手动上传/指定的头像 URL */
  avatarUrl?: string;
  /** 多视角矩阵图 */
  multiViewUrl?: string;
  /**
   * 资产来源：extracted = AI 自动提取（重新提取时会被替换）；manual = 手动添加（重新提取时保留）。
   * 缺省视为 extracted（兼容历史数据）。
   */
  source?: "extracted" | "manual";
  /** L2 派生元数据（懒派生 dirty + 锁定）。缺省视为 { locked: false, dirty: false } */
  derivation?: AssetDerivation;
  /** 资产渲染输入版本；用于丢弃修改发生后返回的过期异步生成结果 */
  renderRevision?: number;
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
  /** 镜头显式引用的场景（一个镜头通常只有一个主场景） */
  activeSceneId?: string;
  /** 镜头显式引用的产品主体 */
  activeProductIds: string[];
  /** 镜头显式引用的道具 / 关键物件 */
  activePropIds: string[];
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
  /** 提示词派生锁定（画面/动态各自独立，B 方案新增） */
  derivation?: ShotDerivation;
  /** 画面/动态输入版本；用于丢弃修改发生后返回的过期异步生成结果 */
  renderRevision?: number;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface Project {
  id: string;
  title: string;
  wizardStep: WizardStep;
  automationMode: AutomationMode;
  assets: Asset[];
  aspectRatio: AspectRatio;
  style: string;
  /** 结构化视觉方向；style 与 style 资产仅作为历史兼容字段。 */
  visualDirection?: VisualDirection;
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
  /** Step 2: overall style reference image URL */
  styleReferenceUrl?: string;
  /** semi-auto 模式下用户是否已审核资产；缺省视为未审核 */
  assetsReviewed?: boolean;
  /** semi-auto 模式下用户是否已审核分镜；缺省视为未审核 */
  storyboardReviewed?: boolean;
  /** semi-auto 模式下用户是否已审核图片；缺省视为未审核 */
  imagesReviewed?: boolean;
  /** 风格参考图生成失败原因 */
  styleReferenceError?: string;
  /** 步骤级生成标记：防止导航切换后重复触发 */
  assetGenerationStarted?: boolean;
  imageGenerationStarted?: boolean;
  videoGenerationStarted?: boolean;
}

export type HistoryAction =
  | "project_created"
  | "project_deleted"
  | "project_switched"
  | "script_generated"
  | "style_generated"
  | "pipeline_started"
  | "pipeline_completed"
  | "pipeline_failed"
  | "shot_regenerated"
  | "settings_changed";

export interface HistoryEntry {
  id: string;
  projectId: string;
  action: HistoryAction;
  /**
   * 描述文案：旧持久化数据为纯字符串（渲染时原样返回）；
   * 新数据为 L10nText（key+params），渲染时经 translateL10n 按当前语言翻译。
   * 不做 persist 迁移，纯字符串天然兼容 union。
   */
  description: string | L10nText;
  timestamp: number;
}

/* ── ID generator ───────────────────────────────────────────────────────── */

let counter = 0;
function newId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now()}_${counter}`;
}

/** 生成唯一 ID（导出供服务层构造实体时使用，保证与 store 内部 ID 格式一致） */
export { newId };

/* ── Store shape ────────────────────────────────────────────────────────── */

interface ProjectState {
  /* Multi-project state */
  projects: Project[];
  activeProjectId: string | null;
  history: HistoryEntry[];

  /* Project actions */
  createProject: (title: string) => Project;
  switchProject: (id: string) => void;
  updateProject: (updates: Partial<Pick<Project, "title" | "aspectRatio" | "style" | "visualDirection" | "language" | "ideaPrompt" | "ideaChatHistory" | "assets" | "styleReferenceUrl" | "assetsReviewed" | "storyboardReviewed" | "imagesReviewed" | "assetGenerationStarted" | "imageGenerationStarted" | "videoGenerationStarted">>) => void;
  /** 按 ID 更新指定项目（用于异步操作完成后写回发起项目，而非当前活跃项目，避免跨项目污染） */
  updateProjectById: (projectId: string, updater: (p: Project) => Project) => void;
  deleteProject: (id: string) => void;
  duplicateProject: (id: string) => Project | null;
  setProjectStatus: (status: ProjectStatus, error?: string) => void;
  setProjectStatusById: (projectId: string, status: ProjectStatus, error?: string) => void;
  clearProject: () => void;

  /* Shot actions */
  setShots: (shots: Shot[]) => void;
  setShotsByProjectId: (projectId: string, shots: Shot[]) => void;
  addShot: (shot: Omit<Shot, "id" | "index" | "status">) => Shot;
  updateShot: (id: string, updates: Partial<Omit<Shot, "id" | "index">>) => void;
  updateShotByProjectId: (projectId: string, id: string, updates: Partial<Omit<Shot, "id" | "index">>) => void;
  /** 仅当镜头输入版本未变化时写回异步结果；返回是否成功写入。 */
  updateShotByProjectIdIfRevision: (
    projectId: string,
    id: string,
    expectedRevision: number,
    updates: Partial<Omit<Shot, "id" | "index">>,
  ) => boolean;
  removeShot: (id: string) => void;
  reorderShots: (fromIndex: number, toIndex: number) => void;
  setShotStatus: (id: string, status: ShotStatus, error?: string) => void;
  setShotStatusByProjectId: (projectId: string, id: string, status: ShotStatus, error?: string) => void;
  /** 仅当镜头输入版本未变化时写回异步状态。 */
  setShotStatusByProjectIdIfRevision: (
    projectId: string,
    id: string,
    expectedRevision: number,
    status: ShotStatus,
    error?: string,
  ) => boolean;

  /* Asset actions（角色/场景/产品统一资产） */
  addAsset: (asset: Omit<Asset, "id">) => Asset;
  updateAsset: (id: string, updates: Partial<Omit<Asset, "id">>) => void;
  updateAssetByProjectId: (projectId: string, id: string, updates: Partial<Omit<Asset, "id">>) => void;
  /** 仅当资产输入版本未变化时写回异步结果；返回是否成功写入。 */
  updateAssetByProjectIdIfRevision: (
    projectId: string,
    id: string,
    expectedRevision: number,
    updates: Partial<Omit<Asset, "id">>,
  ) => boolean;
  removeAsset: (id: string) => void;

  /* Wizard step */
  setWizardStep: (step: WizardStep) => void;

  /* Automation mode */
  setAutomationMode: (mode: AutomationMode) => void;

  /* Dialogue actions */
  addDialogueLine: (shotId: string, line: Omit<DialogueLine, "id">) => void;
  updateDialogueLine: (shotId: string, lineId: string, updates: Partial<Omit<DialogueLine, "id">>) => void;
  removeDialogueLine: (shotId: string, lineId: string) => void;
  reorderDialogueLines: (shotId: string, fromIndex: number, toIndex: number) => void;
  setActiveCharacters: (shotId: string, characterIds: string[]) => void;
  setActiveScene: (shotId: string, sceneId: string | undefined) => void;
  setActiveProducts: (shotId: string, productIds: string[]) => void;
  setActiveProps: (shotId: string, propIds: string[]) => void;

  /* Generation started flags */
  setAssetGenerationStarted: (v: boolean) => void;
  setAssetGenerationStartedByProjectId: (projectId: string, v: boolean) => void;
  setImageGenerationStarted: (v: boolean) => void;
  setImageGenerationStartedByProjectId: (projectId: string, v: boolean) => void;
  setVideoGenerationStarted: (v: boolean) => void;
  setVideoGenerationStartedByProjectId: (projectId: string, v: boolean) => void;

  /* History actions */
  addHistory: (action: HistoryAction, description: string | L10nText, projectId?: string) => void;
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

type ShotUpdates = Partial<Omit<Shot, "id" | "index">>;
type AssetUpdates = Partial<Omit<Asset, "id">>;

const VISUAL_SHOT_FIELDS = [
  "scriptText",
  "visualPrompt",
  "subjectDesc",
  "sceneDesc",
  "detailDesc",
  "lightingDesc",
  "styleDesc",
  "negativePrompt",
  "activeCharacterIds",
  "activeSceneId",
  "activeProductIds",
  "activePropIds",
] as const;

const MOTION_SHOT_FIELDS = [
  "motionPrompt",
  "actionDesc",
  "cameraDesc",
  "envChangeDesc",
  "motionSpeedDesc",
  "negativeMotionPrompt",
  "duration",
  "useDualFrame",
  "firstFrameUrl",
  "lastFrameUrl",
] as const;

const STORYBOARD_SHOT_FIELDS = [
  ...VISUAL_SHOT_FIELDS,
  ...MOTION_SHOT_FIELDS,
  "dialogues",
] as const;

function hasAnyField(updates: object, fields: readonly string[]): boolean {
  return fields.some((field) => field in updates);
}

function hasShotScript(shot: Pick<Shot, "scriptText">): boolean {
  return typeof shot.scriptText === "string" && shot.scriptText.trim().length > 0;
}

/**
 * 用户修改分镜内容后，只使受影响的下游产物失效：
 * - 画面字段变化：图片和视频都必须重做；
 * - 动态字段变化：保留图片，只使视频失效。
 * 生成器只写 imageUrl/videoUrl/status 等产物字段时不会触发这里的失效逻辑。
 */
export function applyShotUpdates(shot: Shot, updates: ShotUpdates): Shot {
  const visualChanged = hasAnyField(updates, VISUAL_SHOT_FIELDS);
  const motionChanged = hasAnyField(updates, MOTION_SHOT_FIELDS);
  const outputChanged =
    ("imageUrl" in updates && updates.imageUrl !== shot.imageUrl) ||
    ("videoUrl" in updates && updates.videoUrl !== shot.videoUrl);
  const renderChanged = visualChanged || motionChanged || outputChanged;
  const next = {
    ...shot,
    ...updates,
    ...(renderChanged
      ? { renderRevision: (shot.renderRevision ?? 0) + 1 }
      : {}),
  };

  // 写入新图片后，旧视频已经不再对应当前画面；生成器通常只传
  // imageUrl + status，因此这里统一清理旧视频产物和旧错误状态。
  if ("imageUrl" in updates && !("videoUrl" in updates)) {
    return {
      ...next,
      videoUrl: undefined,
      videoProgress: undefined,
      videoRetryCount: undefined,
      error: "error" in updates ? next.error : undefined,
    };
  }

  // 写入新视频后，进度/重试次数属于运行时字段，不应残留到完成结果。
  if ("videoUrl" in updates) {
    return {
      ...next,
      videoProgress: undefined,
      videoRetryCount: undefined,
      error: "error" in updates ? next.error : undefined,
    };
  }

  if (visualChanged) {
    return {
      ...next,
      imageUrl: undefined,
      videoUrl: undefined,
      videoProgress: undefined,
      videoRetryCount: undefined,
      status: hasShotScript(next) ? "scripted" : "idle",
      error: undefined,
    };
  }

  if (motionChanged) {
    return {
      ...next,
      videoUrl: undefined,
      videoProgress: undefined,
      videoRetryCount: undefined,
      status: next.imageUrl
        ? "imaged"
        : hasShotScript(next)
          ? "scripted"
          : "idle",
      error: undefined,
    };
  }

  return next;
}

function shotUsesAsset(shot: Shot, asset: Asset): boolean {
  if (asset.type === "style") return true;
  if (asset.type === "character") return (shot.activeCharacterIds ?? []).includes(asset.id);
  if (asset.type === "scene") return shot.activeSceneId === asset.id;
  if (asset.type === "product") return (shot.activeProductIds ?? []).includes(asset.id);
  return (shot.activePropIds ?? []).includes(asset.id);
}

function assetRenderFieldsChanged(asset: Asset, updates: AssetUpdates): boolean {
  const fields: Array<keyof Omit<Asset, "id">> = [
    "type",
    "name",
    "description",
    "prompt",
    "appearancePrompt",
    "imageUrl",
    "avatarUrl",
    "multiViewUrl",
  ];
  return fields.some((field) => field in updates && updates[field] !== asset[field]);
}

function invalidateShotForAsset(shot: Shot): Shot {
  return {
    ...shot,
    renderRevision: (shot.renderRevision ?? 0) + 1,
    imageUrl: undefined,
    videoUrl: undefined,
    videoProgress: undefined,
    videoRetryCount: undefined,
    status: hasShotScript(shot) ? "scripted" : "idle",
    error: undefined,
  };
}

export function applyAssetUpdate(project: Project, id: string, updates: AssetUpdates): Project {
  const currentAsset = project.assets.find((asset) => asset.id === id);
  if (!currentAsset) return project;

  const shouldInvalidate = assetRenderFieldsChanged(currentAsset, updates);
  const nextAsset = {
    ...currentAsset,
    ...updates,
    ...(shouldInvalidate
      ? { renderRevision: (currentAsset.renderRevision ?? 0) + 1 }
      : {}),
  };
  const nextType = nextAsset.type;
  const nextProject = {
    ...project,
    assets: project.assets.map((asset) => (asset.id === id ? nextAsset : asset)),
    assetsReviewed: shouldInvalidate ? false : project.assetsReviewed,
    imagesReviewed: shouldInvalidate ? false : project.imagesReviewed,
    storyboardReviewed: shouldInvalidate ? false : project.storyboardReviewed,
  };

  if (!shouldInvalidate) return nextProject;

  return {
    ...nextProject,
    shots: project.shots.map((shot) =>
      shotUsesAsset(shot, currentAsset) ||
      (nextType !== currentAsset.type && shotUsesAsset(shot, nextAsset))
        ? invalidateShotForAsset(shot)
        : shot,
    ),
  };
}

/* ── Persisted-state migration（导出纯函数，便于单测） ───────────────────── */

/**
 * persist 存储迁移主体（纯函数）：v1→v11 全链路迁移。
 * 与 store 实例解耦，tests/stores/projectMigrate.test.ts 可直接调用；
 * 对缺字段/坏结构不抛错，重复执行幂等。
 */
export function migratePersistedState(
  persisted: unknown,
  version: number,
): Record<string, unknown> {
  if (!persisted || typeof persisted !== "object" || Array.isArray(persisted)) {
    return {};
  }
  const state = persisted as Record<string, unknown>;

  // Migrate from v1 (single project) to v2 (multi-project)
  if (version < 2) {
    const old = persisted as Record<string, unknown>;
    const project = old.project as Project | null;
    if (project) {
      state.projects = [project];
      state.activeProjectId = project.id;
      state.history = [];
    }
  }

  // Migrate from v2 to v3: add character system + dialogue system
  if (version < 3) {
    const projects = state.projects as Array<Record<string, unknown>> | undefined;
    if (projects) {
      state.projects = projects.map((p) => ({
        ...p,
        mode: "simple",
        characters: [],
        shots: ((p.shots as Array<Record<string, unknown>>) ?? []).map(
          (s) => ({
            ...s,
            dialogues: [],
            activeCharacterIds: [],
            activeProductIds: [],
            activePropIds: [],
          }),
        ),
      }));
    }
  }

  // Migrate from v3 to v4: add wizardStep + structured prompt sub-elements
  if (version < 4) {
    const projects = state.projects as Array<Record<string, unknown>> | undefined;
    if (projects) {
      state.projects = projects.map((p) => ({
        ...p,
        wizardStep: 1,
      }));
    }
  }

  // Migrate from v4 to v5: unified flow, remove mode, 6-step wizard
  if (version < 5) {
    const projects = state.projects as Array<Record<string, unknown>> | undefined;
    if (projects) {
      state.projects = projects.map((p) => {
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
        return { ...rest, wizardStep: newStep, automationMode: 'semi-auto' as const };
      });
    }
  }

  // Migrate from v5 to v6: add sceneReferences and styleReferenceUrl
  if (version < 6) {
    const projects = state.projects as Array<Record<string, unknown>> | undefined;
    if (projects) {
      state.projects = projects.map((p) => ({
        ...p,
        sceneReferences: (p.sceneReferences as unknown[]) ?? [],
        styleReferenceUrl: (p.styleReferenceUrl as string) ?? undefined,
      }));
    }
  }

  // Migrate from v6 to v7: add generation started flags
  if (version < 7) {
    const projects = state.projects as Array<Record<string, unknown>> | undefined;
    if (projects) {
      state.projects = projects.map((p) => ({
        ...p,
        assetGenerationStarted: false,
        imageGenerationStarted: false,
        videoGenerationStarted: false,
      }));
    }
  }

  // Migrate from v7 to v8: 角色/场景/产品统一为 assets 数组。
  // 旧 characters[] / sceneReferences[] 合并进 assets（保持原 ID，
  // 否则对白引用与 activeCharacterIds 会断裂）；风格参考图保留为项目字段。
  if (version < 8) {
    const projects = state.projects as Array<Record<string, unknown>> | undefined;
    if (projects) {
      state.projects = projects.map((p) => {
        const { characters, sceneReferences, ...rest } = p;
        const merged: Asset[] = [
          ...((characters as Array<Record<string, unknown>> | undefined) ?? []).map((c) => ({
            id: c.id as string,
            type: "character" as const,
            name: c.name as string,
            description: (c.description as string) ?? "",
            prompt: (c.appearancePrompt as string) ?? "",
            imageUrl: c.generatedPortraitUrl as string | undefined,
            error: c.error as string | undefined,
            appearancePrompt: c.appearancePrompt as string | undefined,
            assetNamespace: c.assetNamespace as string | undefined,
            fullPrompt: c.fullPrompt as string | undefined,
            avatarUrl: c.avatarUrl as string | undefined,
            multiViewUrl: c.multiViewUrl as string | undefined,
          })),
          ...((sceneReferences as Array<Record<string, unknown>> | undefined) ?? []).map((s) => ({
            id: s.id as string,
            type: "scene" as const,
            name: s.name as string,
            description: (s.description as string) ?? "",
            prompt: (s.prompt as string) ?? "",
            imageUrl: s.imageUrl as string | undefined,
            error: s.error as string | undefined,
          })),
        ];
        return { ...rest, assets: merged };
      });
    }
  }

  // Migrate from v8 to v9: 资产派生元数据（derivation）+ style 资产类型。
  // 不凭空创建 style 资产（无 style 资产的项目维持现状，运行期由
  // useWizardActions 的 ensureStyleAsset 懒派生补齐）；仅做结构合法化：
  // 已有资产的非空英文派生物（prompt/appearancePrompt）补 derivation.locked=true，
  // 防止后续自动派生覆盖历史内容。重复执行幂等。
  if (version < 9) {
    const projects = state.projects;
    if (Array.isArray(projects)) {
      state.projects = (projects as unknown[]).map((p) => {
        if (!p || typeof p !== "object") return p;
        const proj = p as Record<string, unknown>;
        if (!Array.isArray(proj.assets)) return p;
        return {
          ...proj,
          assets: (proj.assets as unknown[]).map((a) => {
            if (!a || typeof a !== "object") return a;
            const asset = a as Record<string, unknown>;
            const prompt =
              typeof asset.prompt === "string" ? asset.prompt.trim() : "";
            const appearance =
              typeof asset.appearancePrompt === "string"
                ? asset.appearancePrompt.trim()
                : "";
            // 无任何非空派生物：不置锁（空派生不该被锁定）
            if (!prompt && !appearance) return a;
            const derivation =
              asset.derivation && typeof asset.derivation === "object"
                ? (asset.derivation as Record<string, unknown>)
                : {};
            // 幂等：已锁定则原样返回
            if (derivation.locked === true) return a;
            return { ...asset, derivation: { ...derivation, locked: true } };
          }),
        };
      });
    }
  }

  // Migrate from v9 to v10: restore the canonical character description layout.
  // Some model responses were persisted as one line with `。`/`;` separators;
  // normalize those descriptions so existing projects regain summary + 8 rows.
  if (version < 10) {
    const projects = state.projects;
    if (Array.isArray(projects)) {
      state.projects = (projects as unknown[]).map((p) => {
        if (!p || typeof p !== "object") return p;
        const project = p as Record<string, unknown>;
        if (!Array.isArray(project.assets)) return p;
        return {
          ...project,
          assets: (project.assets as unknown[]).map((a) => {
            if (!a || typeof a !== "object") return a;
            const asset = a as Record<string, unknown>;
            if (asset.type !== "character" || typeof asset.description !== "string") return a;
            const description = normalizeCharacterDescription(asset.description);
            return description === asset.description ? a : { ...asset, description };
          }),
        };
      });
    }
  }

  // Migrate from v11 to v12: preserve the new optional visualDirection field.
  // No value is synthesized here; legacy projects continue using style/style asset.
  if (version < 12) {
    const projects = state.projects;
    if (Array.isArray(projects)) {
      state.projects = (projects as unknown[]).map((p) => {
        if (!p || typeof p !== "object") return p;
        const project = p as Record<string, unknown>;
        const direction = project.visualDirection;
        if (!direction || typeof direction !== "object" || Array.isArray(direction)) {
          return { ...project, visualDirection: undefined };
        }
        return project;
      });
    }
  }

  // Migrate from v10 to v11: normalize shot reference arrays introduced by
  // the explicit scene/product/prop reference contract. Persisted v10 data
  // may have been written before those optional arrays existed.
  if (version < 11) {
    const projects = state.projects;
    if (Array.isArray(projects)) {
      state.projects = (projects as unknown[]).map((p) => {
        if (!p || typeof p !== "object") return p;
        const project = p as Record<string, unknown>;
        if (!Array.isArray(project.shots)) return p;
        return {
          ...project,
          shots: (project.shots as unknown[]).map((s) => {
            if (!s || typeof s !== "object") return s;
            const shot = s as Record<string, unknown>;
            return {
              ...shot,
              dialogues: Array.isArray(shot.dialogues) ? shot.dialogues : [],
              activeCharacterIds: Array.isArray(shot.activeCharacterIds)
                ? shot.activeCharacterIds
                : [],
              activeProductIds: Array.isArray(shot.activeProductIds)
                ? shot.activeProductIds
                : [],
              activePropIds: Array.isArray(shot.activePropIds)
                ? shot.activePropIds
                : [],
            };
          }),
        };
      });
    }
  }

  return state;
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
        get().addHistory("project_created", { key: "history.projectCreated", params: { title } });
        return project;
      },

      switchProject: (id) => {
        const project = get().projects.find((p) => p.id === id);
        if (!project) return;
        set({ activeProjectId: id });
        get().addHistory("project_switched", { key: "history.projectSwitched", params: { title: project.title } });
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
        get().addHistory("project_deleted", { key: "history.projectDeleted", params: { title: project.title } });
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
        get().addHistory("project_created", { key: "history.projectDuplicated", params: { title: source.title } });
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
        get().addHistory("project_deleted", { key: "history.projectCleared" });
      },

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

      /* ── History actions ────────────────────────────────────────────── */

      addHistory: (action, description, projectId) => {
        const { activeProjectId } = get();
        // 异步任务完成后写历史时显式传入发起项目 ID，避免记录到已切换的活动项目
        const entry: HistoryEntry = {
          id: newId("hist"),
          projectId: projectId ?? activeProjectId ?? "",
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
      version: 12,
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
