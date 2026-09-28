// ────────────────────────────────────────────────────────────────────────────
// tests/stores/projectStore.crossProject.test.ts
// P1「多项目写回」红线的存储层依据：锁定两个 action 的目标项目语义。
// 成因（docs/execution-flow.md §12-4）：定妆照生成跨 await 后用了 active-project 版
// updateAsset，而复制项目会保留资产 ID —— 等图期间切换项目，URL 就写进另一个项目的
// 同名资产里。角色编辑器 hook 本身在本仓库不可渲染测试（Vitest 为 node 环境、
// 无 jsdom / testing-library），因此这里锁住它必须依赖的那条 action 语义。
// ────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Asset } from "@/stores/projectTypes";
import { installLocalStorageStub, removeLocalStorageStub } from "../helpers/localStorage";

const SHARED_ID = "asset_shared_1";

function sharedAsset(): Asset {
  return {
    id: SHARED_ID,
    type: "character",
    name: "共用 ID 的角色",
    description: "",
    prompt: "",
    source: "manual",
  };
}

async function getStore() {
  const { useProjectStore } = await import("@/stores/projectStore");
  return useProjectStore;
}

function assetOf(projects: Array<{ id: string; assets: Asset[] }>, projectId: string): Asset {
  const found = projects.find((p) => p.id === projectId)?.assets.find((a) => a.id === SHARED_ID);
  if (!found) throw new Error(`项目 ${projectId} 里找不到资产 ${SHARED_ID}`);
  return found;
}

describe("资产写回的项目定位（P1 多项目写回）", () => {
  beforeEach(async () => {
    installLocalStorageStub();
    // 模块级单例：清空跨用例累积的项目，避免断言命中上一条用例留下的数据
    const { useProjectStore } = await import("@/stores/projectStore");
    useProjectStore.setState({ projects: [], activeProjectId: null });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    removeLocalStorageStub();
    vi.restoreAllMocks();
  });

  it("active-project 版 updateAsset 只作用于活动项目：两项目同 ID 时会写错目标", async () => {
    const store = await getStore();
    const a = store.getState().createProject("项目 A");
    const b = store.getState().createProject("项目 B"); // 活动项目现在是 B

    // 复制项目保留资产 ID 的真实形态：A 与 B 各有一个同 ID 资产，都还没有定妆照
    store.setState((s) => ({
      projects: s.projects.map((p) =>
        p.id === a.id || p.id === b.id ? { ...p, assets: [sharedAsset()] } : p,
      ),
    }));

    store.getState().updateAsset(SHARED_ID, { imageUrl: "https://img.test/wrong.png" });

    const projects = store.getState().projects;
    // 结果落在活动项目 B 上 —— 发起写回的 A 什么都没收到，这就是串写
    expect(assetOf(projects, b.id).imageUrl).toBe("https://img.test/wrong.png");
    expect(assetOf(projects, a.id).imageUrl).toBeUndefined();
  });

  it("updateAssetByProjectId 按锁定的目标项目写回，活动项目是别的项目也不串写", async () => {
    const store = await getStore();
    const a = store.getState().createProject("项目 A");
    const b = store.getState().createProject("项目 B"); // 活动项目 = B

    store.setState((s) => ({
      projects: s.projects.map((p) => (p.id === a.id ? { ...p, assets: [sharedAsset()] } : p)),
    }));

    store.getState().updateAssetByProjectId(a.id, SHARED_ID, {
      imageUrl: "https://img.test/right.png",
    });

    const projects = store.getState().projects;
    expect(assetOf(projects, a.id).imageUrl).toBe("https://img.test/right.png");
    // B 里根本没有这个资产：证明写回没有顺带落到活动项目
    expect(projects.find((p) => p.id === b.id)?.assets ?? []).toEqual([]);
  });
});
