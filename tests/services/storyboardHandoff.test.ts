// ────────────────────────────────────────────────────────────────────────────
// tests/services/storyboardHandoff.test.ts
// generateStoryboardShot 的相邻镜头上下文（Task 5）：串行生成时，本镜请求必须
// 携带上一镜的**实际产出**，否则 storyboard.shot-craft 的「承接上一镜」无法执行。
// 网络与参数决策均用 vi.mock 伪造，断言打在真正发给模型的 user 消息上。
// ────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from "vitest";

const { chatMock } = vi.hoisted(() => ({ chatMock: vi.fn() }));

vi.mock("@/services/ai/factory", () => ({
  createAIService: () => ({ chatCompletion: chatMock }),
}));

vi.mock("@/lib/generationParams", () => ({
  resolveGenerationParams: async () => ({ temperature: 0.7 }),
}));

import { generateStoryboardShot } from "@/services/scriptService";

const SHOT_JSON = JSON.stringify({
  scriptText: "橘猫压低身子，右眼紧盯红桶",
  visualPrompt: "暴雨前的旧楼天台，中景",
  motionPrompt: "橘猫缓缓向前迈出一步",
  duration: 5,
  dialogues: [],
  activeCharacterIds: [],
  activeProductIds: [],
  activePropIds: [],
});

const ITEM = {
  title: "对峙",
  summary: "橘猫与水桶对峙",
  characterNames: ["橘猫"],
  sceneName: "天台",
};

/** 取本次 generateStoryboardShot 发给模型的 user 消息 */
function userContent(): string {
  const args = chatMock.mock.calls[0][0] as {
    messages: Array<{ role: string; content: string }>;
  };
  return args.messages.find((m) => m.role === "user")?.content ?? "";
}

beforeEach(() => {
  chatMock.mockReset();
  chatMock.mockResolvedValue({ content: SHOT_JSON });
});

const BASE = {
  apiKey: "sk-test",
  baseUrl: "https://api.test",
  prompt: "x",
  language: "zh" as const,
  aspectRatio: "1:1",
  assets: [],
  outline: "[]",
  item: ITEM,
  total: 11,
};

describe("generateStoryboardShot：相邻镜头上下文", () => {
  it("带 previousShot 时，上一镜实际内容拼进 user 消息", async () => {
    await generateStoryboardShot({
      ...BASE,
      index: 3,
      previousShot: {
        scriptText: "上一镜：橘猫弓背压低，右眼紧盯水桶",
        visualPrompt: "暴雨将至的旧楼天台，全景，橘猫蹲伏在水塔阴影中",
        shotSize: "wide",
      },
    });

    const user = userContent();
    expect(user).toContain("Previous shot (already generated");
    expect(user).toContain("script: 上一镜：橘猫弓背压低");
    expect(user).toContain("visual: 暴雨将至的旧楼天台");
    expect(user).toContain("shotSize: wide");
  });

  it("景别缺失时明写 unknown，不让模型自己猜", async () => {
    await generateStoryboardShot({
      ...BASE,
      index: 2,
      previousShot: { scriptText: "s", visualPrompt: "v" },
    });
    expect(userContent()).toContain("shotSize: unknown");
  });

  it("首镜（index 0）不带上一镜段", async () => {
    await generateStoryboardShot({ ...BASE, index: 0 });
    const user = userContent();
    expect(user).not.toContain("Previous shot");
    expect(user).not.toContain("shotSize:");
  });
});
