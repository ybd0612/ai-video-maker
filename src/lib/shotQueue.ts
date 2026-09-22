// ────────────────────────────────────────────────────────────────────────────
// src/lib/shotQueue.ts
// 「待补做」镜头集合的唯一权威定义。
//
// 为什么需要它：批量生成按此筛选，界面也必须按同一口径计数与放行按钮。
// 此前界面上只在 status=="failed" 时显示「重试失败」，而改子字段或重生成资产图
// 会把镜头图片清空成 status=="scripted"（见 stores/projectOps.ts 的失效规则），
// 于是这些镜头既不进任何按钮，也不出现在审核卡点里，用户只能整套全部重新生成。
// ────────────────────────────────────────────────────────────────────────────

import type { Shot } from "@/stores/projectStore";

/** 有画面提示词、还没有图片、且不在生成中 —— 图片批量的待补做集合 */
export function pendingImageShots(shots: readonly Shot[]): Shot[] {
  return shots.filter(
    (shot) => !shot.imageUrl && shot.status !== "imaging" && !!shot.visualPrompt.trim(),
  );
}

/** 有图片、有动态描述、还没有视频、且不在生成中 —— 视频批量的待补做集合 */
export function pendingVideoShots(shots: readonly Shot[]): Shot[] {
  return shots.filter(
    (shot) =>
      !shot.videoUrl &&
      !!shot.imageUrl &&
      shot.status !== "videoing" &&
      !!(shot.motionPrompt.trim() || shot.actionDesc?.trim()),
  );
}

/** 有画面提示词但提示词为空 —— 永远不会被生成，需要单独提示用户 */
export function shotsWithoutVisualPrompt(shots: readonly Shot[]): Shot[] {
  return shots.filter((shot) => !shot.visualPrompt.trim());
}

/** 有图片但既无动态提示词也无动作描述 —— 视频阶段会被静默跳过，需要单独提示 */
export function shotsWithoutMotion(shots: readonly Shot[]): Shot[] {
  return shots.filter(
    (shot) => !!shot.imageUrl && !shot.motionPrompt.trim() && !shot.actionDesc?.trim(),
  );
}
