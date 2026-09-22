// ────────────────────────────────────────────────────────────────────────────
// tests/services/characterFidelity.test.ts
// 角色主体忠实自检单测：
// - applyCharacterFidelityFixes：按名字回填、空字段与陌生名字一律丢弃
// - auditCharacterFidelity：clean=false 才改写；坏 JSON / 请求失败保留原值不抛错；
//   空角色列表不发请求（省一次无谓调用）
// 网络用 vi.mock 伪造 AI 服务，参数决策缓存逐例清空。
// ────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from "vitest";

const { chatMock } = vi.hoisted(() => ({ chatMock: vi.fn() }));

vi.mock("@/services/ai/factory", () => ({
  createAIService: () => ({ chatCompletion: chatMock }),
}));

import { clearGenerationParamCache } from "@/lib/generationParams";
import {
  applyCharacterFidelityFixes,
  auditCharacterFidelity,
  type CharacterFidelityFix,
  type RawCharacter,
} from "@/services/scriptService";

const TEDDY: RawCharacter = {
  name: "泰迪",
  description: "一只经过修剪的棕色泰迪犬\n物种: 贵宾犬\n身份: 主角",
  appearancePrompt: "a small brown poodle with curly fur",
};
const CAT: RawCharacter = {
  name: "小橘猫",
  description: "一只橘白相间的家猫\n物种: 猫",
  appearancePrompt: "an orange and white tabby cat",
};

beforeEach(() => {
  chatMock.mockReset();
  clearGenerationParamCache();
});

describe("applyCharacterFidelityFixes", () => {
  const chars = [TEDDY, CAT];

  it("按角色名回填 description", () => {
    const fixes = new Map<string, CharacterFidelityFix>([
      ["泰迪", { name: "泰迪", description: "一只棕色贵宾犬（泰迪）\n物种: 贵宾犬（泰迪）" }],
    ]);
    const out = applyCharacterFidelityFixes(chars, fixes);
    expect(out[0].description).toContain("贵宾犬（泰迪）");
    // 外观提示词由代码从设定拼装，自检不再改它
    expect(out[0].appearancePrompt).toBe(TEDDY.appearancePrompt);
    // 未列出的角色保持原对象引用
    expect(out[1]).toBe(CAT);
  });

  it("名字大小写与首尾空白不影响匹配", () => {
    const fixes = new Map<string, CharacterFidelityFix>([
      ["poodle", { name: " Poodle ", description: "fixed" }],
    ]);
    const out = applyCharacterFidelityFixes([{ ...TEDDY, name: "  POODLE  " }], fixes);
    expect(out[0].description).toBe("fixed");
  });

  it("空字符串 / 非字符串 / 缺字段的修正被丢弃，保留原值", () => {
    const fixes = new Map<string, CharacterFidelityFix>([
      ["泰迪", { name: "泰迪", description: "   " }],
    ]);
    const out = applyCharacterFidelityFixes(chars, fixes);
    expect(out[0]).toBe(TEDDY);
  });

  it("模型编出的陌生名字不会误伤已有角色", () => {
    const fixes = new Map<string, CharacterFidelityFix>([
      ["金毛", { name: "金毛", description: "golden" }],
    ]);
    const out = applyCharacterFidelityFixes(chars, fixes);
    expect(out[0]).toBe(TEDDY);
    expect(out[1]).toBe(CAT);
  });
});

describe("auditCharacterFidelity", () => {
  const opts = {
    apiKey: "k",
    baseUrl: "https://example.com/v1",
    language: "zh" as const,
    idea: "写实风格60秒短片：小橘猫与泰迪开启客厅奇幻冒险",
    characters: [TEDDY, CAT],
  };

  it("角色列表为空时不发任何请求", async () => {
    const res = await auditCharacterFidelity({ ...opts, characters: [] });
    expect(res.clean).toBe(true);
    expect(chatMock).not.toHaveBeenCalled();
  });

  it("clean=true 时原样返回提取结果", async () => {
    chatMock
      .mockResolvedValueOnce({ content: JSON.stringify({ temperature: 0.2 }) }) // 参数决策
      .mockResolvedValueOnce({ content: JSON.stringify({ clean: true, reason: "", fixes: [] }) });

    const res = await auditCharacterFidelity(opts);
    expect(res.clean).toBe(true);
    expect(res.value).toBe(opts.characters);
  });

  it("clean=false 时按名字改回，且只发一次内容审计请求", async () => {
    chatMock
      .mockResolvedValueOnce({ content: JSON.stringify({ temperature: 0.2 }) })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          clean: false,
          reason: "想法写泰迪，设定却成了金毛",
          fixes: [{ name: "泰迪", description: "一只棕色贵宾犬（泰迪）", appearancePrompt: "toy poodle" }],
        }),
      });

    const res = await auditCharacterFidelity(opts);
    expect(res.clean).toBe(false);
    expect(res.value[0].description).toBe("一只棕色贵宾犬（泰迪）");
    expect(res.value[1]).toBe(CAT);
    expect(chatMock).toHaveBeenCalledTimes(2);
  });

  it("审计请求把想法原文与角色身份字段都送进 user 消息", async () => {
    chatMock
      .mockResolvedValueOnce({ content: JSON.stringify({ temperature: 0.2 }) })
      .mockResolvedValueOnce({ content: JSON.stringify({ clean: true }) });

    await auditCharacterFidelity(opts);
    const auditCall = chatMock.mock.calls[1][0];
    const userMsg = auditCall.messages[1].content as string;
    expect(userMsg).toContain(opts.idea);
    expect(userMsg).toContain("泰迪");
    expect(userMsg).toContain("一只经过修剪的棕色泰迪犬");
    // 外观提示词由代码拼装，不再送进审计
    expect(userMsg).not.toContain("a small brown poodle with curly fur");
    // 审计自身必须关 Thinking（与另两个审计用途同属格式化改写）
    expect(auditCall.enableThinking).toBe(false);
  });

  it("模型返回非 JSON / 缺 fixes 时保留原值，不抛错", async () => {
    chatMock.mockResolvedValueOnce({ content: JSON.stringify({ temperature: 0.2 }) });
    chatMock.mockResolvedValueOnce({ content: "我觉得没问题" });
    await expect(auditCharacterFidelity(opts)).resolves.toMatchObject({ clean: true });

    chatMock.mockReset();
    clearGenerationParamCache();
    chatMock
      .mockResolvedValueOnce({ content: JSON.stringify({ temperature: 0.2 }) })
      .mockResolvedValueOnce({ content: JSON.stringify({ clean: false }) });
    await expect(auditCharacterFidelity(opts)).resolves.toMatchObject({ clean: true });
  });

  it("审计请求失败时保留原值（自检绝不阻塞提取主链路）", async () => {
    chatMock
      .mockResolvedValueOnce({ content: JSON.stringify({ temperature: 0.2 }) })
      .mockRejectedValueOnce(new Error("boom"));

    await expect(auditCharacterFidelity(opts)).resolves.toMatchObject({ clean: true });
  });
});
