// ────────────────────────────────────────────────────────────────────────────
// 拆分自 projectStore.ts（2026-09-15 结构治理）：本文件只承载单一职责，
// 兼容入口保持在 projectStore.ts（re-export）。
// ────────────────────────────────────────────────────────────────────────────

// 项目域类型（SSOT）：Asset / Shot / Project / 各类 details / ProjectState。
// 纯类型，无运行时依赖。

import type { ShotSize } from "@/lib/shotSize";

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

/** 风格（视觉方向）六个结构化维度；视觉方向与 style 资产共用同一组字段。 */
export interface StyleDetails {
  kind: "style";
  mediumMaterial: string;
  colorPalette: string;
  lightingMood: string;
  cameraTexture: string;
  composition: string;
  emotion: string;
}

/** 项目级视觉方向：资产与分镜共享的视觉母版。旧项目通过 style 字段兼容。 */
export interface VisualDirection {
  name: string;
  /** 一句话简介（外层卡片展示用） */
  description?: string;
  /** 六个结构化视觉维度（v14 起收敛为 details，旧平铺字段由迁移平移） */
  details: StyleDetails;
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

/**
 * 资产完整设定：不同资产保留自己的语义字段，不再把所有信息压缩进 description。
 * summary 仍保留在 Asset.description 中，便于旧链路和列表摘要兼容。
 */
export interface CharacterDetails {
  kind: "character";
  species: string;
  role: string;
  age: string;
  personality: string;
  appearance: string;
  outfit: string;
  signature: string;
  background: string;
}

export interface SceneDetails {
  kind: "scene";
  settingType: string;
  environment: string;
  time: string;
  weather: string;
  elements: string;
  spatialLayers: string;
  lighting: string;
  paletteMood: string;
  storyUse: string;
}

export interface ProductDetails {
  kind: "product";
  category: string;
  purpose: string;
  silhouette: string;
  dimensions: string;
  color: string;
  material: string;
  structure: string;
  surfaceDetails: string;
  branding: string;
  signature: string;
  usageState: string;
}

export interface PropDetails {
  kind: "prop";
  purpose: string;
  storyRole: string;
  objectType: string;
  shape: string;
  dimensions: string;
  material: string;
  color: string;
  structure: string;
  wear: string;
  signature: string;
  usage: string;
}

export type AssetDetails = CharacterDetails | SceneDetails | ProductDetails | PropDetails | StyleDetails;

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
  /** 结构化完整设定；旧数据缺省时由迁移/读取层按 description 兼容 */
  details?: AssetDetails;
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
  /** 机读景别，由分镜模型产出；衔接与参考图分配的依据。旧数据与模型未给时为 undefined */
  shotSize?: ShotSize;
  status: ShotStatus;
  imageUrl?: string;
  videoUrl?: string;
  videoProgress?: number;
  videoRetryCount?: number;
  /** 服务端任务 ID；创建成功即落盘，刷新后据此继续轮询同一任务而不重建 */
  videoTaskId?: string;
  /** 轮询必须带 model_name，与创建时的模型一起存 */
  videoTaskModel?: string;
  error?: string;
  // Structured visual sub-fields for review and editing; visualPrompt is the API SSOT
  sceneDesc?: string;        // Scene/background: "sitting in a sunlit cafe"
  detailDesc?: string;       // Details/clothing: "wearing a white blouse"
  lightingDesc?: string;     // Lighting/color: "warm golden hour light"
  styleDesc?: string;        // Art style: "photorealistic, 8k"
  // Structured motion sub-fields for review and editing; motionPrompt is the API SSOT
  actionDesc?: string;       // Subject action: "slowly turns her head"
  cameraDesc?: string;       // Camera movement: "camera slowly dollies in"
  envChangeDesc?: string;    // Environment changes: "steam rising from cup"
  motionSpeedDesc?: string;  // Motion speed: "cinematic slow-motion, 24fps"
  /** 止态：本镜动作完成后停住的画面状态（同机位、同景别），由分镜模型产出。
   *  渲染视频提示词时作为结尾句注入（双帧方案 E）；旧数据与模型未给时为 undefined */
  endStateDesc?: string;
  // 首尾帧控制
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  useDualFrame: boolean;
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

/* ── Store shape ────────────────────────────────────────────────────────── */

export interface ProjectState {
  /* Multi-project state */
  projects: Project[];
  activeProjectId: string | null;

  /* Project actions */
  createProject: (title: string) => Project;
  switchProject: (id: string) => void;
  updateProject: (updates: Partial<Pick<Project, "title" | "aspectRatio" | "style" | "visualDirection" | "language" | "ideaPrompt" | "ideaChatHistory" | "assets" | "styleReferenceUrl" | "assetsReviewed" | "storyboardReviewed" | "imagesReviewed" | "assetGenerationStarted" | "imageGenerationStarted" | "videoGenerationStarted">>) => void;
  /** 按 ID 更新指定项目（用于异步操作完成后写回发起项目，而非当前活跃项目，避免跨项目污染） */
  updateProjectById: (projectId: string, updater: (p: Project) => Project) => void;
  updateVisualDirection: (updates: Partial<VisualDirection>) => void;
  deleteProject: (id: string) => void;
  duplicateProject: (id: string) => Project | null;
  setProjectStatus: (status: ProjectStatus, error?: string) => void;
  setProjectStatusById: (projectId: string, status: ProjectStatus, error?: string) => void;

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
}
