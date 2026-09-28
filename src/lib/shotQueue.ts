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

/**
 * 某个镜头当前是否已被一个在飞任务拥有（图片或视频）。
 * 状态即唯一所有者信号：单项重摇与批量 worker 都在发起前把状态置为 imaging / videoing，
 * 因此 `pendingImageShots` / `pendingVideoShots` 天然排除它们。
 */
export function isShotInFlight(shot: Pick<Shot, "status">): boolean {
  return shot.status === "imaging" || shot.status === "videoing";
}

/**
 * 单项重摇能否发起（图片与视频共用同一判据）。
 *
 * 为什么必须在这里挡住：批量的任务列表在**启动时快照**，之后再对同一镜头发起的单项请求
 * 不会被它看见，于是两条链路会各自为该镜头建一次任务 —— 图片多扣一档配额、视频多扣按秒
 * 计费的任务（docs/execution-flow.md §12-3）。有已计费任务在飞时不新建，与视频域
 * 「在飞任务单一所有权」（2026-09-26）是同一条取舍。
 */
export function canStartSingleReroll(input: {
  batchActive: boolean;
  shot: Pick<Shot, "status">;
}): boolean {
  return !input.batchActive && !isShotInFlight(input.shot);
}

/**
 * 视频批量能否开工：在飞任务数达到上限才停。
 *
 * 旧口径是「项目只要有在飞视频任务，整批任务列表返回空」，本意是「已计费任务偿清前
 * 不开新任务」。2026-09-28 实测暴露它没有边界：服务端受理任务后可以既不吐片也不给
 * 终态（GET 200 + `status:"in_progress"` + `internal_progress:0` + `expires_at:null`
 * 挂了 2 小时 14 分），同项目其余 11 个镜头两小时无法开工，界面上「补做缺失」又被
 * `generatingCount > 0` 禁掉 —— 文档承诺的出路实际不存在。
 * 改为上限后仍守住「不无上限地把饱和队列越挤越死」，数值见 `plans.ts:videoInFlightCapFor`。
 */
export function canStartVideoBatch(input: { inFlightCount: number; cap: number }): boolean {
  return input.inFlightCount < input.cap;
}

/**
 * 「放弃这条已计费任务」能否发起：本镜确有服务端任务在飞，且批量没在跑。
 *
 * 为什么需要它：解锁此前只能靠服务端给终态（404 / failed / cancelled）。服务端不给时，
 * 代码不该猜时长判死（那会白扔已计费额度，并让同一镜头二次扣秒数），判死权交回用户，
 * 这里只做准入守卫。批量正在跑时拒绝：worker 正持有该镜头，此时清 `videoTaskId`
 * 会与它的写回抢所有权。
 */
export function canGiveUpVideoTask(input: { batchActive: boolean; shot: Shot }): boolean {
  return !input.batchActive && hasResumableVideoTask(input.shot);
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
