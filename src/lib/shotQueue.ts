// ────────────────────────────────────────────────────────────────────────────
// src/lib/shotQueue.ts
// 「待补做」集合的唯一权威定义。
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

/**
 * 在飞视频镜头能否续轮询的唯一口径：状态 videoing 且服务端任务 ID 齐全。
 *
 * 为什么必须把这条判定单独收口：视频按秒计费，把一个**已建任务**的镜头复位成
 * `imaged`，`pendingVideoShots` 就会把它重新纳进批量集合，于是再发一次
 * `POST /videos` —— 服务端多出一个已计费的重复任务，旧任务从此无人轮询，
 * 界面上表现为「一直生成中、一个都不出片」（2026-09-26 实测：同一镜头七次刷新
 * 七次重建，`debug-dump/runtime.log` 的 CREATE 记录提示词逐字相同）。
 */
export function hasResumableVideoTask(shot: Shot): shot is ResumableVideoShot {
  return shot.status === "videoing" && !!shot.videoTaskId && !!shot.videoTaskModel;
}

/** 已拿到服务端任务 ID、只该续轮询不该重建的镜头 */
export type ResumableVideoShot = Shot & { videoTaskId: string; videoTaskModel: string };

/**
 * 在飞视频镜头集合（与 `pendingVideoShots` 互斥：这些镜头 status 已是 `videoing`）。
 *
 * 批量生成必须把它排在创建任务**之前**执行：上一轮已计费的任务还没回收就再开新任务，
 * 只会让服务端队列越长、每个任务的 progress 越不动
 * （2026-09-26 实测同项目同时挂 6 个任务、全部 progress 0）。
 */
export function inFlightVideoShots(shots: readonly Shot[]): ResumableVideoShot[] {
  return shots.filter((shot): shot is ResumableVideoShot => hasResumableVideoTask(shot));
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
