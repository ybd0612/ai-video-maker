// ────────────────────────────────────────────────────────────────────────────
// tests/lib/renderRules.test.ts
// 渲染文本与作者规则分离（Task 8）：appendRegistryRules 只负责追加，
// 「作者向元指令不得进请求体」这条断言打在 getActiveRenderRules 上。
// ────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installLocalStorageStub, removeLocalStorageStub } from "../helpers/localStorage";
import { getActiveRenderRules } from "@/lib/promptRules";
import { appendRegistryRules } from "@/lib/promptComposer";

beforeEach(() => {
  installLocalStorageStub();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  removeLocalStorageStub();
  vi.restoreAllMocks();
});

describe("appendRegistryRules 追加行为（只负责追加，不负责过滤）", () => {
  it("给什么渲染文本就追加什么，带「质量要求：」前缀", () => {
    const out = appendRegistryRules("一只橘猫", {
      negativeStrategy: "画面细节清晰，解剖结构正常，无伪影",
    });
    expect(out).toContain("质量要求：画面细节清晰，解剖结构正常，无伪影");
  });

  it("空规则不追加，原样返回", () => {
    expect(appendRegistryRules("一只橘猫", { negativeStrategy: "   " })).toBe("一只橘猫");
  });
});

describe("渲染文本与作者规则分离", () => {
  it("negativeStrategy 的渲染文本只含画质事实，不含元指令与骨架名", () => {
    const rendered = getActiveRenderRules("negativeStrategy", "zh");
    expect(rendered).toContain("解剖结构");
    // 这些是写给提示词作者看的话，绝不能出现在发给模型的文本里
    expect(rendered).not.toContain("拼装");
    expect(rendered).not.toContain("骨架");
    expect(rendered).not.toContain("styleRef");
    expect(rendered).not.toContain("visualDirection");
  });

  it("纯作者向条目不产出渲染文本", () => {
    const rendered = getActiveRenderRules("composeShot", "zh");
    expect(rendered).not.toContain("appearancePrompt");
    expect(rendered).not.toContain("注册表");
  });

  it("zh 与 en 的渲染文本各自非空且不互相串台", () => {
    expect(getActiveRenderRules("negativeStrategy", "en")).toContain("anatomy");
    expect(getActiveRenderRules("negativeStrategy", "zh")).not.toContain("anatomy");
  });
});
