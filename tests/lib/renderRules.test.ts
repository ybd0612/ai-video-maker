// ────────────────────────────────────────────────────────────────────────────
// tests/lib/renderRules.test.ts
// 渲染文本与作者规则分离（Task 8）：appendRegistryRules 只负责追加，
// 「作者向元指令不得进请求体」这条断言打在 getActiveRenderRules 上。
// ────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installLocalStorageStub, removeLocalStorageStub } from "../helpers/localStorage";
import { BUILTIN_RULES, getActiveRenderRules } from "@/lib/promptRules";
import { appendRegistryRules } from "@/lib/promptComposer";
import { useSettingsStore } from "@/stores/settingsStore";

beforeEach(() => {
  installLocalStorageStub();
  // 清掉上一条用例可能残留的用户覆盖，保证从纯内置起步
  useSettingsStore.setState({ promptRules: [] });
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

// 2026-10-03 审计 P1-2：渲染路径必须尊重用户的 enabled 开关与编辑内容
describe("getActiveRenderRules 尊重用户覆盖（P1-2 契约修复）", () => {
  const builtinOf = (id: string) => {
    const rule = BUILTIN_RULES.find((r) => r.id === id);
    if (!rule) throw new Error(`内置条目缺失：${id}`);
    return rule;
  };

  it("enabled=false 的内置条目不再产出渲染文本", () => {
    const base = builtinOf("negative.strategy");
    useSettingsStore.setState({
      promptRules: [{ ...base, enabled: false }],
    });
    const rendered = getActiveRenderRules("negativeStrategy", "zh");
    expect(rendered).not.toContain("解剖结构");
  });

  it("用户编辑过的 renderContent 覆盖内置渲染文本", () => {
    const base = builtinOf("compose.multi-reference");
    useSettingsStore.setState({
      promptRules: [
        {
          ...base,
          content: { zh: "我的锚点要求", en: "my anchor requirement" },
          renderContent: { zh: "我的锚点要求", en: "my anchor requirement" },
        },
      ],
    });
    const rendered = getActiveRenderRules("composeShot", "zh");
    expect(rendered).toContain("我的锚点要求");
    expect(rendered).not.toContain("不要复制参考图的内容与构图");
  });

  it("自定义条目（source=custom，无 renderContent）回落到 content 进入渲染", () => {
    useSettingsStore.setState({
      promptRules: [
        {
          id: "custom.compose-test",
          task: "composeShot",
          section: "rules",
          content: { zh: "自定义画质兜底", en: "custom quality fallback" },
          enabled: true,
          source: "custom",
        },
      ],
    });
    expect(getActiveRenderRules("composeShot", "zh")).toContain("自定义画质兜底");
  });

  it("纯作者向内置条目（无 renderContent）被禁用后不影响其它条目渲染", () => {
    const base = builtinOf("compose.registry-reuse");
    useSettingsStore.setState({
      promptRules: [{ ...base, enabled: false }],
    });
    const rendered = getActiveRenderRules("composeShot", "zh");
    expect(rendered).not.toContain("注册表");
    expect(rendered).toContain("参考图只作为画风");
  });
});
