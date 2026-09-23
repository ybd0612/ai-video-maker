// ────────────────────────────────────────────────────────────────────────────
// src/lib/tailFrameStore.ts
// 前镜末帧的模块级内存缓存。末帧是从已生成视频里本地抽的帧，没有远端地址，
// 因此刻意不持久化（遵守「blob URL 不写进 store，避免刷新后失效」的既有约定）：
// 刷新后取不到末帧 → planShotVideo 自动降级为仅锁本镜首帧，不报错、不重建任务。
// ────────────────────────────────────────────────────────────────────────────

const tailFrames = new Map<string, string>();

export function setTailFrame(shotId: string, url: string): void {
  const previous = tailFrames.get(shotId);
  if (previous && previous !== url) URL.revokeObjectURL(previous);
  tailFrames.set(shotId, url);
}

export function getTailFrame(shotId: string): string | undefined {
  return tailFrames.get(shotId);
}

/** 供纯函数消费的普通快照（衔接规划不接受 Map） */
export function snapshotTailFrames(): Record<string, string> {
  return Object.fromEntries(tailFrames);
}

/** 释放指定镜头（不传＝全部）；重摇、删除镜头、切项目时调用 */
export function releaseTailFrames(shotIds?: string[]): void {
  const ids = shotIds ?? [...tailFrames.keys()];
  for (const id of ids) {
    const url = tailFrames.get(id);
    if (url) URL.revokeObjectURL(url);
    tailFrames.delete(id);
  }
}
