// ────────────────────────────────────────────────────────────────────────────
// src/lib/videoPlan.ts
// 镜头视频的一致性策略：纯函数，决定本镜走 keyframe（锁画面起止）还是
// reference（锁身份与画风），以及各自的素材。
//
// 依据 2026-09-21 真实 API 实测（docs/roadmap/competitive-gap-2026-09-21.md §6）：
// - reference 与 first_frame / last_frame **服务端硬互斥**（同时传返回 400
//   「首尾帧素材与参考素材不能同时使用」），所以只能二选一，不能叠加；
// - keyframe 的首帧与输入图几乎像素一致，等于给静帧加动效；
// - reference + images=[定妆照, 风格母版] 能同时带上身份与画风色板；
// - Flash 的 images 上限 5 张。
// ────────────────────────────────────────────────────────────────────────────

import { buildContinuityMap, planShotContinuity } from "@/lib/shotContinuity";
import type { Asset, Shot } from "@/stores/projectStore";

/** 视频一致性策略：off 只锁首帧；chain 追加同场景首尾帧链；identity 再让跨场景镜头改走参考图 */
export type VideoConsistency = "off" | "chain" | "identity";

export const VIDEO_CONSISTENCY_VALUES: readonly VideoConsistency[] = ["off", "chain", "identity"];

/** Flash 的 images 上限，超出会被服务端拒绝 */
export const MAX_VIDEO_REFERENCE_IMAGES = 5;

export interface VideoPlan {
  mode: "keyframe" | "reference" | "text";
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  referenceImageUrls: string[];
  /** 选择该模式的依据，供日志与界面解释 */
  reason: "manual-tail" | "auto-chain" | "identity-reference" | "first-frame-only" | "text-only";
}

export interface VideoPlanInput {
  shot: Pick<Shot, "imageUrl" | "useDualFrame" | "lastFrameUrl">;
  /** 由 planShotContinuity 派生出的同场景下一镜画面图；无则 undefined */
  autoLastFrameUrl?: string;
  consistency: VideoConsistency;
  /** 身份参考素材（定妆照 + 风格母版），仅 identity 分支使用 */
  identityReferences?: string[];
}

/**
 * 决定单镜视频请求的素材组合。
 * 优先级：用户手动尾帧 > 同场景自动衔接 > 身份参考 > 仅首帧 > 纯文本。
 * 任何情况下都不会同时给出首/尾帧与参考图。
 */
export function planShotVideo(input: VideoPlanInput): VideoPlan {
  const { shot, autoLastFrameUrl, consistency, identityReferences = [] } = input;
  const manualTail = shot.useDualFrame ? shot.lastFrameUrl : undefined;

  if (shot.imageUrl && manualTail) {
    return {
      mode: "keyframe", firstFrameUrl: shot.imageUrl, lastFrameUrl: manualTail,
      referenceImageUrls: [], reason: "manual-tail",
    };
  }
  if (shot.imageUrl && consistency !== "off" && autoLastFrameUrl) {
    return {
      mode: "keyframe", firstFrameUrl: shot.imageUrl, lastFrameUrl: autoLastFrameUrl,
      referenceImageUrls: [], reason: "auto-chain",
    };
  }
  if (shot.imageUrl && consistency === "identity" && identityReferences.length > 0) {
    return {
      mode: "reference",
      referenceImageUrls: identityReferences.slice(0, MAX_VIDEO_REFERENCE_IMAGES),
      reason: "identity-reference",
    };
  }
  if (shot.imageUrl) {
    return {
      mode: "keyframe", firstFrameUrl: shot.imageUrl,
      referenceImageUrls: [], reason: "first-frame-only",
    };
  }
  return { mode: "text", referenceImageUrls: [], reason: "text-only" };
}

/**
 * 身份参考素材：本镜出场角色的定妆照（imageUrl 优先，avatarUrl 兜底）+ 风格母版。
 * 刻意只放实测过的这两类；产品/道具图是否该进参考尚未验证，先不加。
 */
export function pickIdentityReferences(
  shot: Pick<Shot, "activeCharacterIds">,
  assets: readonly Asset[],
  styleReferenceUrl?: string,
): string[] {
  const out: string[] = [];
  const push = (url: string | undefined | null) => {
    if (url && !out.includes(url) && out.length < MAX_VIDEO_REFERENCE_IMAGES) out.push(url);
  };
  for (const id of shot.activeCharacterIds ?? []) {
    const character = assets.find((asset) => asset.id === id && asset.type === "character");
    push(character?.imageUrl ?? character?.avatarUrl);
  }
  push(styleReferenceUrl);
  return out;
}

/** 视频请求的素材字段（互斥：reference 时不带 first/last） */
export interface VideoMediaFields {
  imageUrl?: string;
  lastFrameUrl?: string;
  referenceImageUrls?: string[];
}

/** VideoPlan → generateVideo 的素材入参；互斥字段不会同时出现 */
export function toVideoMediaFields(plan: VideoPlan): VideoMediaFields {
  if (plan.mode === "reference") return { referenceImageUrls: plan.referenceImageUrls };
  return {
    ...(plan.firstFrameUrl ? { imageUrl: plan.firstFrameUrl } : {}),
    ...(plan.lastFrameUrl ? { lastFrameUrl: plan.lastFrameUrl } : {}),
  };
}

export interface ShotVideoMediaInput {
  shot: Shot;
  /** 全项目镜头（用于按 index 找同场景下一镜） */
  shots: readonly Shot[];
  assets: readonly Asset[];
  styleReferenceUrl?: string;
  consistency: VideoConsistency;
}

/**
 * 一次算出本镜视频该带哪些素材。编排层（批量与单项重摇）只调这一个函数，
 * 避免同一策略在两处各写一遍。
 */
export function planShotVideoMedia(input: ShotVideoMediaInput): {
  plan: VideoPlan;
  media: VideoMediaFields;
} {
  const autoLastFrameUrl = buildContinuityMap(planShotContinuity(input.shots)).get(input.shot.id);
  const identityReferences =
    input.consistency === "identity" && !autoLastFrameUrl
      ? pickIdentityReferences(input.shot, input.assets, input.styleReferenceUrl)
      : [];
  const plan = planShotVideo({
    shot: input.shot,
    autoLastFrameUrl,
    consistency: input.consistency,
    identityReferences,
  });
  return { plan, media: toVideoMediaFields(plan) };
}
