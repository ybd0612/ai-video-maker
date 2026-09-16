// ────────────────────────────────────────────────────────────────────────────
// tests/services/shotRevision.test.ts
// 分镜指令改写（2026-09-16 新增）：
// - normalizeRawShot：模型返回形态的运行时归一化（本次事故的回归锁定）
// - reviseShotWithInstruction：复用 storyboardShot 字段规格 + 占位符替换 + 请求内容
// 网络依赖用 vi.mock 伪造（fetchWithRetry / rateLimiter）。
// 断言来自 src/services/scriptService.ts 真实实现。
// ────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/fetchWithRetry", () => ({
  fetchWithRetry: vi.fn(),
}));
vi.mock("@/services/rateLimit", () => ({
  rateLimiter: { acquire: vi.fn().mockResolvedValue(undefined) },
  imageSizeToTier: vi.fn().mockReturnValue("1K"),
}));

import { fetchWithRetry } from "@/lib/fetchWithRetry";
import { normalizeRawShot, reviseShotWithInstruction } from "@/services/scriptService";
import type { Asset, Shot } from "@/stores/projectStore";

const mockedFetch = vi.mocked(fetchWithRetry);

/**
 * 同一份响应同时满足「参数决策」与「镜头改写」两种解析，
 * 因此测试不依赖调用次数与先后顺序（参数决策可能命中缓存）。
 */
const MIXED_CONTENT = JSON.stringify({
  temperature: 0.7,
  topP: 1,
  enableThinking: false,
  reason: "structured rewrite",
  scriptText: "改写后的镜头文案",
  visualPrompt: "a revised English visual prompt",
  motionPrompt: "a revised English motion prompt",
  activeSceneId: ["乡间麦田夕阳"],
  dialogues: "not-an-array",
  duration: 8,
});

function chatOk(content: string) {
  return {
    ok: true,
    headers: {
      get: (k: string) =>
        k.toLowerCase() === "content-type" ? "application/json" : null,
    },
    json: async () => ({
      choices: [{ message: { content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }),
  } as unknown as Response;
}

const ASSETS = [
  { id: "char_1", type: "character", name: "小猪" },
  { id: "scene_1", type: "scene", name: "乡间麦田夕阳" },
] as Asset[];

function makeShot(): Shot {
  return {
    id: "shot_1",
    index: 4,
    scriptText: "原始文案",
    visualPrompt: "original visual prompt",
    motionPrompt: "original motion prompt",
    dialogues: [{ id: "dlg_1", characterId: "char_1", text: "你好" }],
    activeCharacterIds: ["char_1"],
    activeSceneId: "scene_1",
    activeProductIds: [],
    activePropIds: [],
    duration: 5,
    status: "scripted",
    sceneDesc: "在夕阳麦田里",
    detailDesc: "",
    lightingDesc: "",
    styleDesc: "",
    actionDesc: "",
    cameraDesc: "",
    envChangeDesc: "",
    motionSpeedDesc: "",
    useDualFrame: false,
  };
}

function lastRequestBody(): Record<string, unknown> {
  const call = mockedFetch.mock.calls.at(-1);
  expect(call).toBeDefined();
  return JSON.parse(call![1].body as string) as Record<string, unknown>;
}

function lastMessages(): Array<{ role: string; content: string }> {
  return lastRequestBody().messages as Array<{ role: string; content: string }>;
}

beforeEach(() => {
  mockedFetch.mockReset();
  mockedFetch.mockResolvedValue(chatOk(MIXED_CONTENT));
});

describe("normalizeRawShot 运行时归一化", () => {
  it("引用字段兼容字符串、数组与对象形态", () => {
    const shot = normalizeRawShot({
      scriptText: "s",
      visualPrompt: "v",
      motionPrompt: "m",
      duration: 5,
      activeSceneId: ["乡间麦田夕阳"],
      activeCharacterIds: [{ id: "char_1" }, "小猪"],
      activeProductIds: "主体",
      activePropIds: { name: "钥匙" },
    });

    expect(shot.activeSceneId).toBe("乡间麦田夕阳");
    expect(shot.activeCharacterIds).toEqual(["char_1", "小猪"]);
    expect(shot.activeProductIds).toEqual(["主体"]);
    expect(shot.activePropIds).toEqual(["钥匙"]);
  });

  it("dialogues 非数组退化为空数组，字段非字符串补空值", () => {
    expect(
      normalizeRawShot({ scriptText: "s", visualPrompt: "v", motionPrompt: "m", duration: 5, dialogues: "oops" })
        .dialogues,
    ).toEqual([]);

    const shot = normalizeRawShot({
      scriptText: "s",
      visualPrompt: "v",
      motionPrompt: "m",
      duration: 5,
      dialogues: [{ characterId: { name: "小猪" }, text: 123 }],
    });
    expect(shot.dialogues?.[0]?.characterId).toBe("小猪");
    expect(shot.dialogues?.[0]?.text).toBe("");
  });

  it("非字符串内容字段补空串，非法 duration 回退 5，空 prompt 用文案兜底", () => {
    const shot = normalizeRawShot({
      scriptText: "镜头文案",
      visualPrompt: [] as never,
      motionPrompt: undefined as never,
      duration: 7,
    });

    expect(shot.duration).toBe(5);
    expect(shot.visualPrompt).toContain("Cinematic shot: 镜头文案");
    expect(shot.motionPrompt).toContain("Slow cinematic camera movement");
  });
});

describe("reviseShotWithInstruction", () => {
  it("复用 storyboardShot 字段规格并替换 {{assets}} 占位符", async () => {
    await reviseShotWithInstruction({
      apiKey: "sk-test",
      baseUrl: "https://api.example.com/v1",
      language: "zh",
      aspectRatio: "9:16",
      assets: ASSETS,
      shot: makeShot(),
      instruction: "改成航拍远景",
    });

    const system = lastMessages()[0]?.content ?? "";
    // 编辑指令段（模型输入为中文，不参与 i18n）
    expect(system).toContain("你正在修改一个已有的分镜镜头");
    // 字段规格来自 storyboardShot 骨架，且动态资产槽已替换
    expect(system).toContain("visualPrompt");
    expect(system).not.toContain("{{assets}}");
    expect(system).toContain("小猪");
  });

  it("把当前镜头（引用用资产名）与用户指令一起交给模型，并归一化返回结果", async () => {
    const shot = await reviseShotWithInstruction({
      apiKey: "sk-test",
      baseUrl: "https://api.example.com/v1",
      language: "zh",
      aspectRatio: "9:16",
      assets: ASSETS,
      shot: makeShot(),
      instruction: "改成航拍远景",
    });

    const user = lastMessages()[1]?.content ?? "";
    expect(user).toContain("改成航拍远景");
    expect(user).toContain("乡间麦田夕阳");
    expect(user).not.toContain("shot_1");

    expect(shot.activeSceneId).toBe("乡间麦田夕阳");
    expect(shot.dialogues).toEqual([]);
    expect(shot.duration).toBe(8);
  });

  it("英文项目使用英文编辑指令", async () => {
    await reviseShotWithInstruction({
      apiKey: "sk-test",
      baseUrl: "https://api.example.com/v1",
      language: "en",
      aspectRatio: "16:9",
      assets: ASSETS,
      shot: makeShot(),
      instruction: "switch to an aerial wide shot",
    });

    expect(lastMessages()[0]?.content ?? "").toContain("You are revising an existing storyboard shot");
  });
});
