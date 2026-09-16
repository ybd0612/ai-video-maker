import { useProjectStore, type Project } from "@/stores/projectStore";

/**
 * 单镜头重试成功后，若项目此前因部分失败置为 failed、且现在所有镜头满足就绪条件，
 * 则复位项目状态为 idle，避免侧边栏状态永久停留在 failed。
 */
export function restoreProjectStatusIfReady(
  projectId: string,
  ready: (project: Project) => boolean,
): void {
  const project = useProjectStore.getState().projects.find((p) => p.id === projectId);
  if (project && project.status === "failed" && ready(project)) {
    useProjectStore.getState().setProjectStatusById(projectId, "idle");
  }
}

/**
 * 中断恢复：把残留的 "scripting" 占位镜头复位为 "idle"。
 *
 * 分镜是两阶段写入——大纲返回后先落一批 scripting 占位，再并发逐镜头填充。
 * 若流程在两者之间被打断（页面刷新 / 热更新重载 / 请求异常），占位会永久停在
 * scripting：卡片永远转圈、没有错误提示、刷新也不会恢复，用户只能重建项目。
 * 因此在新一轮生成开始前、以及本轮异常退出时都要复位。
 */
export function resetStuckShots(projectId: string): void {
  const project = useProjectStore.getState().projects.find((p) => p.id === projectId);
  const stuck = (project?.shots ?? []).filter((shot) => shot.status === "scripting");
  if (stuck.length === 0) return;
  for (const shot of stuck) {
    useProjectStore.getState().updateShotByProjectId(projectId, shot.id, {
      status: "idle",
      error: undefined,
    });
  }
}
