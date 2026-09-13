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
