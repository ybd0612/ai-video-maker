// ────────────────────────────────────────────���───────────────────────────────
// tests/services/storyBrief.test.ts
// 故事骨架（2026-10-07 新增）的解析与下游注入：
//   1. parseStoryBrief —— 逐字段取非空字符串，全空视为失败交调用方保留旧值；
//   2. extractStoryBriefFromIdea —— 真的发请求、真的按 purpose 取参数；
//   3. 骨架是否被注入大纲与逐镜头两个环节（缺省时行为与改造前一致）。
// 网络与参数决策用 vi.mock 伪造，断言打在真正发给模型的 user 消息上。
// ────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from "vitest";

const { chatMock, paramsMock } = vi.hoisted(() => ({
  chatMock: vi.fn(),
  paramsMock: vi.fn(),
}));

vi.mock("@/services/ai/factory", () => ({
  createAIService: () => ({ chatCompletion: chatMock }),
}));

vi.mock("@/lib/generationParams", () => ({
  resolveGenerationParams: (opts: { purpose: string }) => paramsMock(opts),
}));

import {
  extractStoryBriefFromIdea,
  parseStoryBrief,
  generateStoryboardOutline,
  generateStoryboardShot,
} from "@/services/scriptService";
import type { StoryBrief } from "@/stores/projectStore";

const BASE = {
  apiKey: "k",
  baseUrl: "b",
  prompt: "一只失明橘猫与边牧幼犬在暴雨前的老楼天台争水桶，最后相依。",
  language: "zh" as const,
  aspectRatio: "16:9",
};

const FULL_BRIEF: StoryBrief = {
  logline: "失明橘猫与边牧幼犬为争水桶对峙，最终在暴雨中相依",
  theme: "冲突中的和解",
  emotionArc: "孤寂→紧张→释然",
  audience: "城市青年",
  durationPlan: "90 秒三幕",
  beats: "起：争水 · 承：僵持 · 转：暴雨 · 合：相依",
  consistencyNotes: "同一只橘猫与同一只边牧，全片不变",
  revision: 1,
};

describe("parseStoryBrief", () => {
  it("逐字段取非空字符串并 trim", () => {
    const brief = parseStoryBrief(
      JSON.stringify({
        logline: "  一句话梗概  ",
        theme: "主题",
        emotionArc: "曲线",
        audience: "受众",
        durationPlan: "时长",
        beats: "节拍",
        consistencyNotes: "约束",
      }),
    );
    expect(brief).toEqual({
      logline: "一句话梗概",
      theme: "主题",
      emotionArc: "曲线",
      audience: "受众",
      durationPlan: "时长",
      beats: "节拍",
      consistencyNotes: "约束",
    });
  });

  it("缺字段以空串补齐，形状仍完整", () => {
    const brief = parseStoryBrief('{"logline":"只有梗概","theme":"主题"}');
    expect(brief).not.toBeNull();
    expect(brief!.logline).toBe("只有梗概");
    expect(brief!.beats).toBe("");
  });

  it("全字段为空 → 返回 null（让调用方保留既有值，不写半截骨架）", () => {
    expect(parseStoryBrief(JSON.stringify({ logline: "  ", theme: "" }))).toBeNull();
  });

  it("非字符串字段按空串处理，不把对象/数字塞进字段", () => {
    const brief = parseStoryBrief('{"logline":{"a":1},"theme":42,"beats":"节拍"}');
    expect(brief).toEqual({
      logline: "",
      theme: "",
      emotionArc: "",
      audience: "",
      durationPlan: "",
      beats: "节拍",
      consistencyNotes: "",
    });
  });

  it("非 JSON → null", () => {
    expect(parseStoryBrief("模型拒绝回答")).toBeNull();
  });
});

describe("extractStoryBriefFromIdea", () => {
  beforeEach(() => {
    chatMock.mockReset();
    paramsMock.mockReset();
    paramsMock.mockResolvedValue({ temperature: 0.7 });
  });

  it("发出 storyBrief 用途的参数决策，并把想法原文作为 user 消息", async () => {
    chatMock.mockResolvedValue({ content: JSON.stringify({ logline: "梗概", theme: "主题" }) });
    await extractStoryBriefFromIdea(BASE);

    expect(paramsMock).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "storyBrief" }),
    );
    const messages = chatMock.mock.calls[0][0].messages;
    expect(messages[1].content).toBe(BASE.prompt);
  });

  it("解析失败时抛可翻译错误", async () => {
    chatMock.mockResolvedValue({ content: "抱歉，我不能完成" });
    await expect(extractStoryBriefFromIdea(BASE)).rejects.toThrow();
  });
});

describe("故事骨架注入下游", () => {
  beforeEach(() => {
    chatMock.mockReset();
    paramsMock.mockReset();
    paramsMock.mockResolvedValue({ temperature: 0.7 });
  });

  it("大纲请求携带骨架的七个字段", async () => {
    chatMock.mockResolvedValue({
      content: JSON.stringify({ shots: [{ title: "T", summary: "S", characterNames: [] }] }),
    });
    await generateStoryboardOutline({ ...BASE, storyBrief: FULL_BRIEF });

    const user = chatMock.mock.calls[0][0].messages[1].content as string;
    expect(user).toContain("一句话梗概");
    expect(user).toContain("孤寂→紧张→释然");
    expect(user).toContain("90 秒三幕");
    expect(user).toContain("同一只橘猫与同一只边牧");
  });

  it("逐镜头请求同样携带骨架", async () => {
    chatMock.mockResolvedValue({
      content: JSON.stringify({
        scriptText: "脚本",
        visualPrompt: "画面",
        motionPrompt: "动态",
        duration: 5,
      }),
    });
    await generateStoryboardShot({
      ...BASE,
      storyBrief: FULL_BRIEF,
      outline: "[]",
      item: { title: "T", summary: "S", characterNames: [] },
      index: 0,
      total: 1,
    });

    const user = chatMock.mock.calls[0][0].messages[1].content as string;
    expect(user).toContain("已确认的故事骨架");
    expect(user).toContain("冲突中的和解");
  });

  it("骨架缺省（旧项目 / 未提取）→ 不注入任何故事层文本，行为与改造前一致", async () => {
    chatMock.mockResolvedValue({
      content: JSON.stringify({ shots: [{ title: "T", summary: "S", characterNames: [] }] }),
    });
    await generateStoryboardOutline(BASE);

    const user = chatMock.mock.calls[0][0].messages[1].content as string;
    expect(user).not.toContain("故事骨架");
    expect(user).toBe(BASE.prompt);
  });

  it("骨架全为空串（模型返回空对象后由解析层放行）→ 同样不注入", async () => {
    chatMock.mockResolvedValue({
      content: JSON.stringify({ shots: [{ title: "T", summary: "S", characterNames: [] }] }),
    });
    const emptyBrief: StoryBrief = {
      ...FULL_BRIEF,
      logline: "",
      theme: "",
      beats: "",
      emotionArc: "",
      durationPlan: "",
    };
    await generateStoryboardOutline({ ...BASE, storyBrief: emptyBrief });

    const user = chatMock.mock.calls[0][0].messages[1].content as string;
    expect(user).toBe(BASE.prompt);
  });
});
