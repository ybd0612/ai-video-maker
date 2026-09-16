// ────────────────────────────────────────────────────────────────────────────
// 拆分自 projectStore.ts（2026-09-15 结构治理）：本文件只承载单一职责，
// 兼容入口保持在 projectStore.ts（re-export）。
// ────────────────────────────────────────────────────────────────────────────

// 纯操作函数与工具：newId / 镜头与资产的不可变更新 / 字段分组配置。
// 无 zustand 依赖，可独立单测。

import type { Asset, Project, Shot } from "./projectTypes";

/* ── ID generator ───────────────────────────────────────────────────────── */

let counter = 0;
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now()}_${counter}`;
}

/** 生成唯一 ID（导出供服务层构造实体时使用，保证与 store 内部 ID 格式一致） */

/* ── Helpers ────────────────────────────────────────────────────────────── */

export function updateActive(
  projects: Project[],
  activeProjectId: string | null,
  updater: (p: Project) => Project,
): Project[] {
  if (!activeProjectId) return projects;
  return projects.map((p) => (p.id === activeProjectId ? updater(p) : p));
}

export type ShotUpdates = Partial<Omit<Shot, "id" | "index">>;
export type AssetUpdates = Partial<Omit<Asset, "id">>;

export const VISUAL_SHOT_FIELDS = [
  "scriptText",
  "visualPrompt",
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

export const MOTION_SHOT_FIELDS = [
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

export const STORYBOARD_SHOT_FIELDS = [
  ...VISUAL_SHOT_FIELDS,
  ...MOTION_SHOT_FIELDS,
  "dialogues",
] as const;

export function hasAnyField(updates: object, fields: readonly string[]): boolean {
  return fields.some((field) => field in updates);
}

export function hasShotScript(shot: Pick<Shot, "scriptText">): boolean {
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

export function shotUsesAsset(shot: Shot, asset: Asset): boolean {
  if (asset.type === "style") return true;
  if (asset.type === "character") return (shot.activeCharacterIds ?? []).includes(asset.id);
  if (asset.type === "scene") return shot.activeSceneId === asset.id;
  if (asset.type === "product") return (shot.activeProductIds ?? []).includes(asset.id);
  return (shot.activePropIds ?? []).includes(asset.id);
}

export function assetRenderFieldsChanged(asset: Asset, updates: AssetUpdates): boolean {
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

export function invalidateShotForAsset(shot: Shot): Shot {
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
