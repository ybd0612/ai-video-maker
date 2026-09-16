// ────────────────────────────────────────────────────────────────────────────
// tests/features/wizard/wizardActionUtils.test.ts
// resetStuckShots 回归用例：分镜两阶段写入在中途被打断（页面刷新 / 热更新重载 /
// 请求异常）会留下 status="scripting" 的占位镜头，必须能复位成 idle，
// 否则卡片永久停在"生成中"、无错误提示、刷新也不恢复（2026-09-16 实测事故）。
//
// 该函数读写真实 store（Zustand + persist），因此先装 localStorage 桩，
// 再用 vi.resetModules() + 动态 import 取一份干净的 store 实例。
// ────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, Shot } from "@/stores/projectStore";
import { installLocalStorageStub, removeLocalStorageStub } from "../../helpers/localStorage";

function makeShot(id: string, status: Shot["status"], overrides: Partial<Shot> = {}): Shot {
  return {
    id,
    index: 0,
    scriptText: "",
    visualPrompt: "",
    motionPrompt: "",
    dialogues: [],
    activeCharacterIds: [],
    activeProductIds: [],
    activePropIds: [],
    duration: 5,
    useDualFrame: false,
    status,
    ...overrides,
  };
}

function makeProject(id: string, shots: Shot[]): Project {
  const now = Date.now();
  return {
    id,
    title: id,
    wizardStep: 3,
    automationMode: "semi-auto",
    assets: [],
    aspectRatio: "9:16",
    style: "",
    language: "zh",
    shots,
    status: "idle",
    assetGenerationStarted: false,
    imageGenerationStarted: false,
    videoGenerationStarted: false,
    assetsReviewed: true,
    storyboardReviewed: false,
    imagesReviewed: false,
    createdAt: now,
    updatedAt: now,
  };
}

/** 重置模块图并取一份全新的 store + 工具函数 */
async function freshUtils() {
  vi.resetModules();
  const store = await import("@/stores/projectStore");
  const utils = await import("@/features/wizard/wizardActionUtils");
  return { useProjectStore: store.useProjectStore, resetStuckShots: utils.resetStuckShots };
}

beforeEach(() => {
  installLocalStorageStub();
  // 并行测试文件的 afterEach 会卸载全局 localStorage 桩，导致 persist 写入失败并打印警告；
  // 用例断言的是 store 内存状态（不依赖落盘结果），这里静音噪声即可。
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  removeLocalStorageStub();
});

describe("resetStuckShots", () => {
  it("把 scripting 占位复位为 idle 并清空 error，其它状态不受影响", async () => {
    const { useProjectStore, resetStuckShots } = await freshUtils();
    useProjectStore.setState({
      projects: [
        makeProject("proj_a", [
          makeShot("s0", "scripting"),
          makeShot("s1", "scripting", { error: "interrupted" }),
          makeShot("s2", "scripted", { scriptText: "done" }),
          makeShot("s3", "idle"),
        ]),
      ],
      activeProjectId: "proj_a",
    });

    resetStuckShots("proj_a");

    const shots = useProjectStore.getState().projects[0].shots;
    expect(shots.map((s) => s.status)).toEqual(["idle", "idle", "scripted", "idle"]);
    expect(shots[1].error).toBeUndefined();
  });

  it("没有 scripting 镜头时不产生任何写入（updatedAt 不变）", async () => {
    const { useProjectStore, resetStuckShots } = await freshUtils();
    const project = makeProject("proj_a", [makeShot("s0", "scripted"), makeShot("s1", "failed")]);
    useProjectStore.setState({ projects: [project], activeProjectId: "proj_a" });

    resetStuckShots("proj_a");

    expect(useProjectStore.getState().projects[0].updatedAt).toBe(project.updatedAt);
  });

  it("只复位目标项目，不波及其它项目的 scripting 镜头", async () => {
    const { useProjectStore, resetStuckShots } = await freshUtils();
    useProjectStore.setState({
      projects: [
        makeProject("proj_a", [makeShot("a0", "scripting")]),
        makeProject("proj_b", [makeShot("b0", "scripting")]),
      ],
      activeProjectId: "proj_a",
    });

    resetStuckShots("proj_a");

    const [a, b] = useProjectStore.getState().projects;
    expect(a.shots[0].status).toBe("idle");
    expect(b.shots[0].status).toBe("scripting");
  });

  it("项目不存在时静默返回，不抛错", async () => {
    const { useProjectStore, resetStuckShots } = await freshUtils();
    useProjectStore.setState({ projects: [], activeProjectId: null });

    expect(() => resetStuckShots("missing")).not.toThrow();
  });
});
