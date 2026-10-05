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

import { buildHandoffMap, planShotContinuity } from "@/lib/shotContinuity";
import type { Asset, Shot } from "@/stores/projectStore";

/** 视频一致性策略：off 只锁本镜首帧；chain 让后镜首帧取前镜末帧；identity 再让无衔接的镜头改走参考图 */
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
  reason: "manual-tail" | "auto-handoff" | "identity-reference" | "first-frame-only" | "text-only";
}

export interface VideoPlanInput {
  shot: Pick<Shot, "imageUrl" | "useDualFrame" | "lastFrameUrl">;
  /** 由 tailFrameStore 提供的前镜末帧；仅当 planShotContinuity 判定衔接时非空 */
  autoFirstFrameUrl?: string;
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
  const { shot, autoFirstFrameUrl, consistency, identityReferences = [] } = input;
  const manualTail = shot.useDualFrame ? shot.lastFrameUrl : undefined;

  if (shot.imageUrl && manualTail) {
    return {
      mode: "keyframe", firstFrameUrl: shot.imageUrl, lastFrameUrl: manualTail,
      referenceImageUrls: [], reason: "manual-tail",
    };
  }
  if (shot.imageUrl && consistency !== "off" && autoFirstFrameUrl) {
    // 前镜末帧与本镜画面图同时存在时，用前镜末帧作首帧：拼接处连续优先于本镜静帧还原。
    return {
      mode: "keyframe", firstFrameUrl: autoFirstFrameUrl,
      referenceImageUrls: [], reason: "auto-handoff",
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
  /** 前镜末帧地址表（shotId → URL），由调用方从 lib/tailFrameStore 取；缺失即不衔接 */
  tailFrames?: Record<string, string>;
}

/**
 * 一次算出本镜视频该带哪些素材。编排层（批量与单项重摇）只调这一个函数，
 * 避免同一策略在两处各写一遍。
 */
export function planShotVideoMedia(input: ShotVideoMediaInput): {
  plan: VideoPlan;
  media: VideoMediaFields;
} {
  const handoff = buildHandoffMap(planShotContinuity(input.shots)).get(input.shot.id);
  const tailFrameUrl = handoff ? input.tailFrames?.[handoff] : undefined;
  // FFmpeg 提取的末帧是浏览器本地 blob URL，远端视频 API 无法读取；退回本镜公网生图地址。
  const autoFirstFrameUrl = tailFrameUrl?.startsWith("blob:") ? undefined : tailFrameUrl;
  const identityReferences =
    input.consistency === "identity" && !autoFirstFrameUrl
      ? pickIdentityReferences(input.shot, input.assets, input.styleReferenceUrl)
      : [];
  const plan = planShotVideo({
    shot: input.shot,
    autoFirstFrameUrl,
    consistency: input.consistency,
    identityReferences,
  });
  return { plan, media: toVideoMediaFields(plan) };
}
