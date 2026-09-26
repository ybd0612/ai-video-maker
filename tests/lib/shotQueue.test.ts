// ────────────────────────────────────────────────────────────────────────────
// tests/lib/shotQueue.test.ts
// 「待补做」集合的筛选口径单测 —— 界面计数与批量生成共用这一份定义。
// 断言来自 src/lib/shotQueue.ts 真实实现。
// ────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import {
  hasResumableVideoTask,
  pendingImageShots,
  pendingVideoShots,
  shotsWithoutMotion,
  shotsWithoutVisualPrompt,
} from "@/lib/shotQueue";
import type { Shot } from "@/stores/projectStore";

function shot(over: Partial<Shot> & { id: string }): Shot {
  return {
    index: 0, scriptText: "文案", visualPrompt: "visual", motionPrompt: "motion",
    dialogues: [], activeCharacterIds: [], activeProductIds: [], activePropIds: [],
    duration: 5, useDualFrame: false, status: "scripted",
    imageUrl: undefined, videoUrl: undefined,
    ...over,
  } as unknown as Shot;
}

describe("pendingImageShots", () => {
  it("无图 + 有画面提示词即待补做，含 scripted / idle / failed 三种状态", () => {
    const shots = [
      shot({ id: "a", status: "scripted" }),
      shot({ id: "b", status: "idle" }),
      shot({ id: "c", status: "failed" }),
    ];
    expect(pendingImageShots(shots).map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("已有图片、正在生成中、缺画面提示词的都不进集合", () => {
    const shots = [
      shot({ id: "done", status: "imaged", imageUrl: "https://cdn.test/a.png" }),
      shot({ id: "running", status: "imaging" }),
      shot({ id: "noprompt", visualPrompt: "   " }),
      shot({ id: "pending" }),
    ];
    expect(pendingImageShots(shots).map((s) => s.id)).toEqual(["pending"]);
  });

  it("有图片但视频缺失的镜头仍不算图片待补做", () => {
    const shots = [shot({ id: "imaged", status: "imaged", imageUrl: "https://cdn.test/a.png" })];
    expect(pendingImageShots(shots)).toEqual([]);
  });
});

describe("pendingVideoShots", () => {
  it("有图 + 有动态描述 + 无视频即待补做，含 failed", () => {
    const img = (id: string) => ({ id, imageUrl: `https://cdn.test/${id}.png` });
    const shots = [
      shot({ ...img("a"), status: "imaged" }),
      shot({ ...img("b"), status: "failed" }),
      shot({ ...img("c"), status: "scripted" }),
    ];
    expect(pendingVideoShots(shots).map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("缺图片的镜头不能进视频待补做集合", () => {
    expect(pendingVideoShots([shot({ id: "noimg" })])).toEqual([]);
  });

  it("只有 actionDesc 也算有动态描述（与批量口径一致）", () => {
    const shots = [shot({ id: "a", status: "imaged", imageUrl: "https://cdn.test/a.png",
      motionPrompt: "", actionDesc: "rabbit turns head" })];
    expect(pendingVideoShots(shots).map((s) => s.id)).toEqual(["a"]);
  });

  it("正在生成中、已有视频、两者描述都为空的都不进集合", () => {
    const base = { imageUrl: "https://cdn.test/a.png" };
    const shots = [
      shot({ id: "running", ...base, status: "videoing" }),
      shot({ id: "done", ...base, status: "videoed", videoUrl: "https://cdn.test/a.mp4" }),
      shot({ id: "nomotion", ...base, status: "imaged", motionPrompt: "", actionDesc: "" }),
    ];
    expect(pendingVideoShots(shots)).toEqual([]);
  });
});

describe("不可生成集合（用于单独提示，不能静默跳过）", () => {
  it("shotsWithoutVisualPrompt 找出缺画面提示词的镜头", () => {
    const shots = [shot({ id: "a" }), shot({ id: "b", visualPrompt: "" })];
    expect(shotsWithoutVisualPrompt(shots).map((s) => s.id)).toEqual(["b"]);
  });

  it("shotsWithoutMotion 只看有图但无动态描述的镜头", () => {
    const shots = [
      shot({ id: "noimg", motionPrompt: "", actionDesc: "" }),
      shot({ id: "imaged", imageUrl: "https://cdn.test/a.png", motionPrompt: "  ", actionDesc: "" }),
      shot({ id: "ok", imageUrl: "https://cdn.test/b.png", motionPrompt: "walk" }),
    ];
    expect(shotsWithoutMotion(shots).map((s) => s.id)).toEqual(["imaged"]);
  });
});

describe("hasResumableVideoTask（在飞任务可否续轮询的唯一口径）", () => {
  const task = { videoTaskId: "task_abc", videoTaskModel: "agnes-video-2.5-flash" };

  it("videoing 且 ID 齐全 → 可续轮询（复位重建就是重复扣秒数）", () => {
    expect(hasResumableVideoTask(shot({ id: "a", status: "videoing", ...task }))).toBe(true);
  });

  it("缺 videoTaskId 或缺 videoTaskModel → 不可续轮询，只能复位", () => {
    expect(hasResumableVideoTask(shot({ id: "b", status: "videoing" }))).toBe(false);
    expect(hasResumableVideoTask(shot({ id: "c", status: "videoing", videoTaskId: "task_abc" }))).toBe(false);
    expect(hasResumableVideoTask(shot({ id: "d", status: "videoing", videoTaskModel: "m" }))).toBe(false);
  });

  it("非 videoing 状态一律不可续轮询（已完成的任务 ID 不应让镜头留在在飞集合）", () => {
    expect(hasResumableVideoTask(shot({ id: "e", status: "videoed", videoUrl: "https://cdn.test/e.mp4", ...task }))).toBe(false);
    expect(hasResumableVideoTask(shot({ id: "f", status: "failed", ...task }))).toBe(false);
    expect(hasResumableVideoTask(shot({ id: "g", status: "imaged", imageUrl: "https://cdn.test/g.png", ...task }))).toBe(false);
  });
});
