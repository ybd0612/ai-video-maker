// ────────────────────────────────────────────────────────────────────────────
// tests/lib/generationParams.test.ts
// 生成参数决策层单测：
// - clampGenerationParams：合法区间透传，越界/类型错误/缺失一律退回 fallback
// - resolveGenerationParams：模型决策结果被采用、按用途缓存、失败退化中性参数
// 网络依赖用 vi.mock 伪造 AI 服务（不产生真实调用）。
// ────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from "vitest";

const { chatMock } = vi.hoisted(() => ({ chatMock: vi.fn() }));

vi.mock("@/services/ai/factory", () => ({
  createAIService: () => ({ chatCompletion: chatMock }),
}));

import {
  NEUTRAL_GENERATION_PARAMS,
  clampGenerationParams,
  clearGenerationParamCache,
  resolveGenerationParams,
} from "@/lib/generationParams";

beforeEach(() => {
  chatMock.mockReset();
  clearGenerationParamCache();
});

describe("clampGenerationParams", () => {
  it("区间内的合法值原样透传", () => {
    expect(clampGenerationParams({ temperature: 1.35, topP: 0.82, enableThinking: true })).toEqual({
      temperature: 1.35,
      topP: 0.82,
      enableThinking: true,
    });
  });

  it("边界值（0、2、0.01、1）属于合法区间", () => {
    expect(clampGenerationParams({ temperature: 0, topP: 0.01 })).toMatchObject({
      temperature: 0,
      topP: 0.01,
    });
    expect(clampGenerationParams({ temperature: 2, topP: 1 })).toMatchObject({
      temperature: 2,
      topP: 1,
    });
  });

  it("越界值退回 fallback，不夹取也不猜测", () => {
    expect(clampGenerationParams({ temperature: 3, topP: 1.5 }).temperature).toBe(
      NEUTRAL_GENERATION_PARAMS.temperature,
    );
    expect(clampGenerationParams({ temperature: -0.1 }).temperature).toBe(
      NEUTRAL_GENERATION_PARAMS.temperature,
    );
    expect(clampGenerationParams({ topP: 0 }).topP).toBeUndefined();
  });

  it("类型错误 / NaN / 缺失 / 非对象输入一律退回 fallback", () => {
    expect(clampGenerationParams({ temperature: "0.5", topP: "1", enableThinking: "yes" })).toEqual(
      NEUTRAL_GENERATION_PARAMS,
    );
    expect(clampGenerationParams({ temperature: Number.NaN }).temperature).toBe(
      NEUTRAL_GENERATION_PARAMS.temperature,
    );
    expect(clampGenerationParams(undefined)).toEqual(NEUTRAL_GENERATION_PARAMS);
    expect(clampGenerationParams(null)).toEqual(NEUTRAL_GENERATION_PARAMS);
    expect(clampGenerationParams([])).toEqual(NEUTRAL_GENERATION_PARAMS);
    expect(clampGenerationParams("0.1")).toEqual(NEUTRAL_GENERATION_PARAMS);
  });

  it("自定义 fallback 优先于中性默认值", () => {
    const fallback = { temperature: 0.2, topP: 0.9, enableThinking: true };
    expect(clampGenerationParams({ temperature: 99 }, fallback)).toEqual(fallback);
  });
});

describe("resolveGenerationParams", () => {
  it("采用模型给出的参数并解析 JSON", async () => {
    chatMock.mockResolvedValue({
      content: JSON.stringify({ temperature: 1.1, topP: 0.75, enableThinking: true, reason: "creative" }),
    });

    const params = await resolveGenerationParams({
      purpose: "styleRef",
      apiKey: "k",
      baseUrl: "https://example.com/v1",
    });

    expect(params).toEqual({ temperature: 1.1, topP: 0.75, enableThinking: true });
    expect(chatMock).toHaveBeenCalledTimes(1);
  });

  it("同用途同缓存键复用决策（只问一次模型）", async () => {
    chatMock.mockResolvedValue({ content: JSON.stringify({ temperature: 0.9 }) });

    await resolveGenerationParams({ purpose: "storyboard", apiKey: "k", baseUrl: "b", cacheKey: "p1" });
    await resolveGenerationParams({ purpose: "storyboard", apiKey: "k", baseUrl: "b", cacheKey: "p1" });

    expect(chatMock).toHaveBeenCalledTimes(1);
  });

  it("不同用途或不同缓存键各自决策", async () => {
    chatMock.mockResolvedValue({ content: JSON.stringify({ temperature: 0.9 }) });

    await resolveGenerationParams({ purpose: "storyboard", apiKey: "k", baseUrl: "b", cacheKey: "p1" });
    await resolveGenerationParams({ purpose: "styleRef", apiKey: "k", baseUrl: "b", cacheKey: "p1" });
    await resolveGenerationParams({ purpose: "storyboard", apiKey: "k", baseUrl: "b", cacheKey: "p2" });

    expect(chatMock).toHaveBeenCalledTimes(3);
  });

  it("force=true 跳读缓存重新决策", async () => {
    chatMock.mockResolvedValue({ content: JSON.stringify({ temperature: 0.9 }) });

    await resolveGenerationParams({ purpose: "storyboard", apiKey: "k", baseUrl: "b", cacheKey: "p1" });
    await resolveGenerationParams({
      purpose: "storyboard",
      apiKey: "k",
      baseUrl: "b",
      cacheKey: "p1",
      force: true,
    });

    expect(chatMock).toHaveBeenCalledTimes(2);
  });

  it("模型输出非法/越界时退回中性参数，不抛错", async () => {
    chatMock.mockResolvedValueOnce({ content: JSON.stringify({ temperature: 9 }) });
    await expect(
      resolveGenerationParams({ purpose: "storyboard", apiKey: "k", baseUrl: "b" }),
    ).resolves.toEqual(NEUTRAL_GENERATION_PARAMS);

    chatMock.mockResolvedValueOnce({ content: "not json at all" });
    await expect(
      resolveGenerationParams({ purpose: "assetExtraction", apiKey: "k", baseUrl: "b" }),
    ).resolves.toEqual(NEUTRAL_GENERATION_PARAMS);
  });

  it("决策调用失败时退化中性参数且不写缓存（下次会重试）", async () => {
    chatMock.mockRejectedValue(new Error("boom"));

    await expect(
      resolveGenerationParams({ purpose: "visualDirection", apiKey: "k", baseUrl: "b" }),
    ).resolves.toEqual(NEUTRAL_GENERATION_PARAMS);

    chatMock.mockReset();
    chatMock.mockResolvedValue({ content: JSON.stringify({ temperature: 0.5 }) });
    const params = await resolveGenerationParams({
      purpose: "visualDirection",
      apiKey: "k",
      baseUrl: "b",
    });
    expect(params.temperature).toBe(0.5);
  });
});
