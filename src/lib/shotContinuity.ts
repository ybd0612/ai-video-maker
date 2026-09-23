// ────────────────────────────────────────────────────────────────────────────
// src/lib/shotContinuity.ts
// 相邻镜头的首帧衔接规划：把「上一镜的末帧」作为「本镜的首帧」，让拼接处连续。
//
// ⚠️ 方向（2026-09-23 实测纠正）：首尾帧必须属于**同一镜头**——尾帧描述本镜动作的
// 终点状态。旧实现把「下一镜的画面图」当本镜尾帧，等于强制模型在一段视频里凭空
// 造出机位位移与物体增减（实测 v9：末帧凭空长出水桶与水塔、眼罩形态改变），
// 且与该镜 motionPrompt 的「全程无推拉摇移」直接对打。现已反转为业界做法。
//
// 设计约束（必读）：
// - 纯函数，只读镜头数据、**不写 store**，也不触发级联失效。
// - 末帧图本身是本地抽取产物，存在 lib/tailFrameStore（内存，不持久化）；
//   本模块只负责判定"该不该接、从哪一镜取"，不碰素材地址。
// ────────────────────────────────────────────────────────────────────────────

import { isAdjacentSizeCompatible } from "@/lib/shotSize";
import type { Shot } from "@/stores/projectStore";

/** 衔接所需的最小镜头字段 */
export type ShotForContinuity = Pick<
  Shot,
  "id" | "index" | "imageUrl" | "activeSceneId" | "activeCharacterIds" | "shotSize"
>;

/** 未衔接的原因，供 UI 与日志解释「为什么这两镜没接上」 */
export type ContinuitySkipReason =
  | "last-shot"       // 已经是第一镜，前面没有画面可接
  | "no-first-frame"  // 上一镜没有画面图，抽不出末帧
  | "scene-unknown"   // 任一侧没标主场景，无法判断是否同场景
  | "scene-changed"   // 相邻两镜主场景不同，硬接会让模型乱补运动
  | "cast-disjoint"   // 同场景但出场人物完全不相交（换人特写），接上会扭曲
  | "size-unknown"    // 任一侧景别未知，未知不放行
  | "size-gap";       // 景别跨两档以上，模型补不出这段位移

export type ContinuityDecision =
  | { shotId: string; previousShotId: string; linked: true }
  | {
      shotId: string;
      previousShotId?: string;
      linked: false;
      reason: ContinuitySkipReason;
    };

export interface ContinuityOptions {
  /**
   * 同场景但两镜出场人物完全不相交时是否断开衔接。默认 true：
   * 换人特写被强行接在同一运动路径上，最容易出畸形。
   */
  requireSharedCast?: boolean;
}

const DEFAULTS: Required<ContinuityOptions> = { requireSharedCast: true };

function sharesCast(a: ShotForContinuity, b: ShotForContinuity): boolean {
  const castA = a.activeCharacterIds ?? [];
  const castB = b.activeCharacterIds ?? [];
  // 任一侧没标角色时按「未知」处理：不因此断开，避免旧数据大面积失去衔接
  if (castA.length === 0 || castB.length === 0) return true;
  return castA.some((id) => castB.includes(id));
}

/**
 * 按 index 顺序规划相邻镜头的衔接。返回数组与排序后的镜头一一对应。
 * 决策挂在「后一镜」上：本镜是否从上一镜取首帧。
 */
export function planShotContinuity(
  shots: readonly ShotForContinuity[],
  options: ContinuityOptions = {},
): ContinuityDecision[] {
  const opts = { ...DEFAULTS, ...options };
  const ordered = [...shots].sort((a, b) => a.index - b.index);

  return ordered.map((shot, i): ContinuityDecision => {
    const prev = ordered[i - 1];
    if (!prev) return { shotId: shot.id, linked: false, reason: "last-shot" };

    const base = { shotId: shot.id, previousShotId: prev.id } as const;

    if (!prev.imageUrl) return { ...base, linked: false, reason: "no-first-frame" };
    if (!shot.activeSceneId || !prev.activeSceneId) {
      return { ...base, linked: false, reason: "scene-unknown" };
    }
    if (shot.activeSceneId !== prev.activeSceneId) {
      return { ...base, linked: false, reason: "scene-changed" };
    }
    if (opts.requireSharedCast && !sharesCast(prev, shot)) {
      return { ...base, linked: false, reason: "cast-disjoint" };
    }
    if (!isAdjacentSizeCompatible(prev.shotSize, shot.shotSize)) {
      const unknown = !prev.shotSize || !shot.shotSize;
      return { ...base, linked: false, reason: unknown ? "size-unknown" : "size-gap" };
    }

    return { ...base, linked: true };
  });
}

/** 衔接映射：本镜 ID → 应从中取首帧的上一镜 ID */
export function buildHandoffMap(
  decisions: readonly ContinuityDecision[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const d of decisions) {
    if (d.linked) map.set(d.shotId, d.previousShotId);
  }
  return map;
}
