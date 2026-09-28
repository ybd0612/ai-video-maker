// ────────────────────────────────────────────────────────────────────────────
// tests/lib/shotQueue.test.ts
// 「待补做」集合的筛选口径单测 —— 界面计数与批量生成共用这一份定义。
// 断言来自 src/lib/shotQueue.ts 真实实现。
// ────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import {
  canAutoRetryVanishedTask,
  canGiveUpVideoTask,
  canStartSingleReroll,
  canStartVideoBatch,
  hasResumableVideoTask,
  MAX_AUTO_RETRY_ON_VANISHED_TASK,
  inFlightVideoShots,
  isShotInFlight,
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

/* ── 在飞上限：一条卡住的任务不得让整批陪绑（2026-09-28 实测） ────────────────
   旧口径是「项目只要有在飞视频任务，buildTasks 就整批返回 []」。服务端对某个任务
   既不出片也不给终态（实测 GET 返回 200 + in_progress + internal_progress 0 +
   expires_at null，挂 2 小时 14 分），于是其余镜头两小时无法开工，界面上
   「补做缺失」又被 generatingCount>0 禁掉 —— 承诺的出路实际不存在。 */
describe("canStartVideoBatch（按在飞上限放行，不再整批陪绑）", () => {
  it("在飞数低于上限就允许开工——有在飞任务不再等于批量停摆", () => {
    expect(canStartVideoBatch({ inFlightCount: 0, cap: 2 })).toBe(true);
    expect(canStartVideoBatch({ inFlightCount: 1, cap: 2 })).toBe(true);
  });

  it("在飞数达到或超过上限才拒绝（防止把饱和队列越挤越死）", () => {
    expect(canStartVideoBatch({ inFlightCount: 2, cap: 2 })).toBe(false);
    expect(canStartVideoBatch({ inFlightCount: 5, cap: 2 })).toBe(false);
  });

  it("上限恒大于并发：并发 1 的免费档也允许 1 条旧任务挂着再开 1 条", () => {
    expect(canStartVideoBatch({ inFlightCount: 1, cap: 1 })).toBe(false);
  });
});

/* ── 显式放弃已计费任务的入口 ────────────────────────────────────────────────
   判死权交回用户：服务端不给终态时（expires_at null），代码不猜时长，
   由用户按下「放弃这条任务」才清 videoTaskId 让镜头回到待补做集合。 */
describe("canGiveUpVideoTask（放弃已计费任务的准入判据）", () => {
  const task = { videoTaskId: "task_abc", videoTaskModel: "agnes-video-2.5-flash" };

  it("本镜确有服务端在飞任务且批量没在跑 → 允许放弃", () => {
    expect(canGiveUpVideoTask({ batchActive: false, shot: shot({ id: "a", status: "videoing", ...task }) })).toBe(true);
  });

  it("批量正在跑 → 拒绝（worker 正持有该镜头，放弃会与写回抢所有权）", () => {
    expect(canGiveUpVideoTask({ batchActive: true, shot: shot({ id: "b", status: "videoing", ...task }) })).toBe(false);
  });

  it("没有在飞任务就没有东西可放弃：缺 ID 或非 videoing 一律拒绝", () => {
    expect(canGiveUpVideoTask({ batchActive: false, shot: shot({ id: "c", status: "videoing" }) })).toBe(false);
    expect(canGiveUpVideoTask({ batchActive: false, shot: shot({ id: "d", status: "videoing", videoTaskId: "task_abc" }) })).toBe(false);
    expect(canGiveUpVideoTask({ batchActive: false, shot: shot({ id: "e", status: "imaged", imageUrl: "https://cdn.test/e.png", ...task }) })).toBe(false);
  });
});

/* ── 任务确认不存在时的自动重建额度 ──────────────────────────────────────────
   服务端返回 404「任务不存在」= 该任务的产出已不可回收，重建不会产生并发的重复任务，
   与「超时/5xx 时服务端可能已建任务、重发就是重复扣秒数」是两回事。
   但额度必须钉死：9 月 26 日实测过同一镜头被 POST 七次的事故，所以每个镜头只给一次，
   额度记在持久字段 Shot.videoRetryCount 上（跨刷新、跨批量与续轮询通道都只扣一次）。 */
describe("canAutoRetryVanishedTask（服务端确认任务不存在后的自动重建额度）", () => {
  it("额度上限是 1", () => {
    expect(MAX_AUTO_RETRY_ON_VANISHED_TASK).toBe(1);
  });

  it("没用过额度（缺省或 0）时允许自动重建一次", () => {
    expect(canAutoRetryVanishedTask(shot({ id: "a" }))).toBe(true);
    expect(canAutoRetryVanishedTask(shot({ id: "b", videoRetryCount: 0 }))).toBe(true);
  });

  it("已用过额度后不再自动重建，交回人工（防止无限循环扣额度）", () => {
    expect(canAutoRetryVanishedTask(shot({ id: "c", videoRetryCount: 1 }))).toBe(false);
    expect(canAutoRetryVanishedTask(shot({ id: "d", videoRetryCount: 3 }))).toBe(false);
  });
});

describe("inFlightVideoShots（批量续轮询集合，与待补做集合互斥）", () => {
  const img = { imageUrl: "https://cdn.test/a.png" };
  const task = { videoTaskId: "task_abc", videoTaskModel: "agnes-video-2.5-flash" };

  it("只收 videoing 且 ID 齐备的镜头，并保持镜头顺序", () => {
    const shots = [
      shot({ id: "s0", ...img, status: "imaged" }),
      shot({ id: "s1", ...img, status: "videoing", ...task }),
      shot({ id: "s2", ...img, status: "videoing", videoTaskId: "task_def" }),
      shot({ id: "s3", ...img, status: "videoed", videoUrl: "https://cdn.test/s3.mp4", ...task }),
    ];
    expect(inFlightVideoShots(shots).map((s) => s.id)).toEqual(["s1"]);
  });

  it("不变量：进了在飞集合的镜头绝不进待补做集合（进了就会被重建、重复扣秒数）", () => {
    const inFlight = shot({ id: "run", ...img, status: "videoing", ...task });
    expect(pendingVideoShots([inFlight])).toEqual([]);
  });

  it("videoing 但缺 ID 的镜头两个集合都不进 —— 必须先复位成 imaged 才可补做", () => {
    const lost = shot({ id: "lost", ...img, status: "videoing" });
    expect(inFlightVideoShots([lost])).toEqual([]);
    expect(pendingVideoShots([lost])).toEqual([]);
  });
});

describe("canStartSingleReroll / isShotInFlight（单项与批量的互斥口径，§12-3）", () => {
  it("空闲镜头且无批量在跑 → 允许发起单项重摇", () => {
    expect(canStartSingleReroll({ batchActive: false, shot: shot({ id: "a", status: "imaged" }) })).toBe(true);
    expect(canStartSingleReroll({ batchActive: false, shot: shot({ id: "b", status: "failed" }) })).toBe(true);
  });

  it("批量在跑 → 拒绝（批量列表是启动时快照，同镜再建一次就是重复扣费）", () => {
    expect(canStartSingleReroll({ batchActive: true, shot: shot({ id: "a", status: "imaged" }) })).toBe(false);
  });

  it("本镜已被别的任务拥有 → 拒绝（imaging 与 videoing 两类所有者都算）", () => {
    expect(canStartSingleReroll({ batchActive: false, shot: shot({ id: "a", status: "imaging" }) })).toBe(false);
    expect(canStartSingleReroll({ batchActive: false, shot: shot({ id: "b", status: "videoing" }) })).toBe(false);
  });

  it("isShotInFlight 只在两种在飞状态为真，其余一律为假", () => {
    expect(isShotInFlight(shot({ id: "a", status: "imaging" }))).toBe(true);
    expect(isShotInFlight(shot({ id: "b", status: "videoing" }))).toBe(true);
    for (const status of ["idle", "scripted", "imaged", "videoed", "failed"] as const) {
      expect(isShotInFlight(shot({ id: `s-${status}`, status }))).toBe(false);
    }
  });
});
