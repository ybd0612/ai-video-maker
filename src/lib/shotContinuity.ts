// ────────────────────────────────────────────────────────────────────────────
// src/lib/shotContinuity.ts
// 同场景首尾帧自动衔接：把相邻且同场景的「下一镜画面图」当作「本镜尾帧」，
// 让前一镜正好结束在下一镜的开始画面上。
//
// 设计约束（必读）：
// - 纯函数，只读镜头数据、**不写 store**。useDualFrame 与 lastFrameUrl 都属于
//   MOTION_SHOT_FIELDS，写回会清空已生成的视频并递增 renderRevision
//   （见 stores/projectOps.ts），所以衔接方案必须在发请求时派生，不能持久化。
// - 用户手动设置的尾帧永远优先，本模块不覆盖手动值。
// ────────────────────────────────────────────────────────────────────────────

import type { Shot } from "@/stores/projectStore";

/** 派生衔接所需的最小镜头字段 */
export type ShotForContinuity = Pick<
  Shot,
  "id" | "index" | "imageUrl" | "activeSceneId" | "activeCharacterIds" | "useDualFrame" | "lastFrameUrl"
>;

/** 未衔接的原因，供 UI 与日志解释「为什么这两镜没接上」 */
export type ContinuitySkipReason =
  | "last-shot"        // 已经是最后一镜，后面没有画面可接
  | "manual-tail"      // 用户已手动设了尾帧
  | "no-first-frame"   // 本镜还没有画面图，视频本来也不会生成
  | "no-next-frame"    // 下一镜没有画面图，拿不到尾帧
  | "scene-unknown"     // 任一侧没标主场景，无法判断是否同场景
  | "scene-changed"    // 相邻两镜主场景不同，硬接会让模型乱补运动
  | "cast-disjoint";   // 同场景但出场人物完全不相交（换人特写），接上会扭曲

export type ContinuityDecision =
  | {
      shotId: string;
      nextShotId: string;
      linked: true;
      lastFrameUrl: string;
    }
  | {
      shotId: string;
      nextShotId?: string;
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
 * 按 index 顺序规划相邻镜头的衔接。
 * 返回的数组与排序后的镜头一一对应（长度相同），便于按下标直接展示。
 */
export function planShotContinuity(
  shots: readonly ShotForContinuity[],
  options: ContinuityOptions = {},
): ContinuityDecision[] {
  const opts = { ...DEFAULTS, ...options };
  const ordered = [...shots].sort((a, b) => a.index - b.index);

  return ordered.map((shot, i): ContinuityDecision => {
    const next = ordered[i + 1];
    if (!next) return { shotId: shot.id, linked: false, reason: "last-shot" };

    const base = { shotId: shot.id, nextShotId: next.id } as const;

    if (shot.useDualFrame && shot.lastFrameUrl) {
      return { ...base, linked: false, reason: "manual-tail" };
    }
    if (!shot.imageUrl) return { ...base, linked: false, reason: "no-first-frame" };
    if (!next.imageUrl) return { ...base, linked: false, reason: "no-next-frame" };
    if (!shot.activeSceneId || !next.activeSceneId) {
      return { ...base, linked: false, reason: "scene-unknown" };
    }
    if (shot.activeSceneId !== next.activeSceneId) {
      return { ...base, linked: false, reason: "scene-changed" };
    }
    if (opts.requireSharedCast && !sharesCast(shot, next)) {
      return { ...base, linked: false, reason: "cast-disjoint" };
    }

    return { ...base, linked: true, lastFrameUrl: next.imageUrl! };
  });
}

/** 衔接映射：本镜 ID → 应作为尾帧的下一镜画面图 */
export function buildContinuityMap(
  decisions: readonly ContinuityDecision[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const d of decisions) {
    if (d.linked) map.set(d.shotId, d.lastFrameUrl);
  }
  return map;
}

/**
 * 发给视频接口的尾帧取值：手动值优先，其次自动衔接。
 * 注意与现行代码的差别 —— 现行实现要求 `useDualFrame` 为真才带 last_frame，
 * 自动衔接不依赖该开关。
 */
export function resolveRequestLastFrame(
  shot: Pick<Shot, "id" | "useDualFrame" | "lastFrameUrl">,
  links: ReadonlyMap<string, string>,
): string | undefined {
  if (shot.useDualFrame && shot.lastFrameUrl) return shot.lastFrameUrl;
  return links.get(shot.id);
}
