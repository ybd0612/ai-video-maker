// ────────────────────────────────────────────────────────────────────────────
// src/lib/shotFields.ts
// 分镜内容字段的纯拷贝函数：rerollShot 写回新分镜时使用。
// 排除集以真实 Shot 类型为准（Omit 强制）：id + 状态/生成产物/运行时字段不拷贝。
// ────────────────────────────────────────────────────────────────────────────

import type { Shot } from "@/stores/projectStore";

/**
 * 分镜的可拷贝内容字段。
 * 用 Omit 以 Shot 类型为准：后续 Shot 新增内容字段会自动纳入；
 * 误拷贝排除字段会被编译期发现。
 */
export type ShotContentFields = Omit<
  Shot,
  | "id"
  | "index"
  | "status"
  | "error"
  | "imageUrl"
  | "videoUrl"
  | "videoProgress"
  | "videoRetryCount"
  | "useDualFrame"
  | "lastFrameUrl"
  | "activeCharacterIds"
  | "dialogues"
>;

/**
 * 从分镜中提取全部内容字段（脚本/画面/动态提示词、结构化子元素、时长、首帧）。
 * 入参为「去掉 id/index/status 的 Shot」：完整 Shot 与 generateScript 返回的
 * 新分镜（Omit<Shot, "id" | "index" | "status">）均可直接传入。
 * 不拷贝：
 * - id / index（身份字段）；
 * - status / error（状态字段）；
 * - imageUrl / videoUrl / videoProgress / videoRetryCount（生成产物与进度）；
 * - useDualFrame / lastFrameUrl（用户生成配置，跨重新生成保留）；
 * - activeCharacterIds / dialogues（需按项目角色 ID 重新映射后单独写回）。
 */
export function pickShotFields(
  shot: Omit<Shot, "id" | "index" | "status">,
): ShotContentFields {
  return {
    scriptText: shot.scriptText,
    visualPrompt: shot.visualPrompt,
    motionPrompt: shot.motionPrompt,
    duration: shot.duration,
    sceneDesc: shot.sceneDesc,
    detailDesc: shot.detailDesc,
    lightingDesc: shot.lightingDesc,
    styleDesc: shot.styleDesc,
    negativePrompt: shot.negativePrompt,
    actionDesc: shot.actionDesc,
    cameraDesc: shot.cameraDesc,
    envChangeDesc: shot.envChangeDesc,
    motionSpeedDesc: shot.motionSpeedDesc,
    negativeMotionPrompt: shot.negativeMotionPrompt,
    firstFrameUrl: shot.firstFrameUrl,
    activeSceneId: shot.activeSceneId,
    activeProductIds: shot.activeProductIds,
    activePropIds: shot.activePropIds,
  };
}
