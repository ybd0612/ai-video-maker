// ────────────────────────────────────────────────────────────────────────────
// tests/lib/promptRules.edge.test.ts
// promptRules 边界补测（QA 第 1 轮）：
// - mergeRules：stored 含未知 task 条目 / stored 重复 id
// - buildSystemPrompt：某 section 全部 disabled 时整块（含 header）移除；
//   条目 content.en 缺失时的容错（不抛错、该条目被剔除）
// - resolvePolishSystemPrompt：无匹配返回原文 / 有覆盖返回覆盖版 /
//   覆盖被禁用时返回原文
// - buildCharacterAppearancePrompt：恒英文 + 含物种锁定条目
// ────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installLocalStorageStub, removeLocalStorageStub } from "../helpers/localStorage";
import {
  BUILTIN_RULES,
  buildCharacterAppearancePrompt,
  buildSystemPrompt,
  mergeRules,
  resolvePolishSystemPrompt,
  type PromptRule,
  type PromptTask,
} from "@/lib/promptRules";
import { useSettingsStore } from "@/stores/settingsStore";

beforeEach(() => {
  installLocalStorageStub();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  useSettingsStore.setState({ promptRules: [] });
});

afterEach(() => {
  removeLocalStorageStub();
  useSettingsStore.setState({ promptRules: [] });
});

function makeRule(
  overrides: Partial<PromptRule> & Pick<PromptRule, "id" | "task" | "section">,
): PromptRule {
  return {
    content: { zh: "- 默认中文规则", en: "- default en rule" },
    enabled: true,
    source: "custom",
    ...overrides,
  };
}

/* ── mergeRules 边界 ─────────────────────────────────────────────────────── */

describe("mergeRules 边界", () => {
  it("stored 含未知 task 的条目：原样追加保留，不抛错，也不参与其他任务渲染", () => {
    const stored = [
      makeRule({
        id: "custom.typo-task",
        task: "no-such-task" as unknown as PromptTask,
        section: "rules",
        content: { zh: "未知任务条目内容", en: "unknown task content" },
      }),
    ];

    const merged = mergeRules(BUILTIN_RULES, stored);
    expect(merged.some((r) => r.id === "custom.typo-task")).toBe(true);

    // 不抛错，且未知 task 条目内容不会渲染进其他任务的 system prompt
    expect(() => buildSystemPrompt("storyboard", "zh", merged)).not.toThrow();
    expect(buildSystemPrompt("storyboard", "zh", merged)).not.toContain(
      "未知任务条目内容",
    );
  });

  it("stored 重复 id：后一条覆盖前一条（Map 覆盖语义，仅保留一份）", () => {
    const stored = [
      makeRule({
        id: "custom.dup",
        task: "storyboard",
        section: "rules",
        content: { zh: "第一版", en: "v1" },
      }),
      makeRule({
        id: "custom.dup",
        task: "storyboard",
        section: "rules",
        content: { zh: "第二版", en: "v2" },
      }),
    ];

    const merged = mergeRules(BUILTIN_RULES, stored);
    const dups = merged.filter((r) => r.id === "custom.dup");
    expect(dups).toHaveLength(1);
    expect(dups[0].content.zh).toBe("第二版");
    expect(dups[0].content.en).toBe("v2");
  });
});

/* ── buildSystemPrompt 边界 ──────────────────────────────────────────────── */

describe("buildSystemPrompt 边界", () => {
  it("某 section 全部 disabled：整块连同 header 移除，其他 section 不受影响", () => {
    const allRulesDisabled = BUILTIN_RULES.map((r) =>
      r.task === "storyboard" && r.section === "rules"
        ? { ...r, enabled: false }
        : r,
    );

    const zh = buildSystemPrompt("storyboard", "zh", allRulesDisabled);
    expect(zh).not.toContain("重要规则：");
    expect(zh).not.toContain("总镜头数 4-8 个");
    // safety section 条目仍启用 → header 与内容保留
    expect(zh).toContain("⚠️ 内容安全要求：");
    expect(zh).toContain("服饰描述得体");

    const en = buildSystemPrompt("storyboard", "en", allRulesDisabled);
    expect(en).not.toContain("Important rules:");
    expect(en).toContain("Content safety:");
  });

  it("条目 content.en 缺失时容错：不抛错，该条目在 en 渲染中被剔除（zh 渲染不受影响）", () => {
    // 现实路径：settingsStore persist 只校验 Array.isArray（migratePersistedSettings），
    // 手改 localStorage / 旧版本写入的坏条目可绕过 SettingsDialog 导入校验直达此处。
    const broken: PromptRule[] = [
      {
        id: "custom.missing-en",
        task: "storyboard",
        section: "rules",
        content: { zh: "- 中文规则仍在" } as PromptRule["content"],
        enabled: true,
        source: "custom",
      },
      ...BUILTIN_RULES,
    ];

    let zhOut = "";
    let enOut = "";
    expect(() => {
      zhOut = buildSystemPrompt("storyboard", "zh", broken);
      enOut = buildSystemPrompt("storyboard", "en", broken);
    }).not.toThrow();

    expect(zhOut).toContain("- 中文规则仍在");
    expect(enOut).not.toContain("- 中文规则仍在");
    // en 渲染其余条目正常
    expect(enOut).toContain("4-8 shots total");
  });
});

/* ── resolvePolishSystemPrompt ───────────────────────────────────────────── */

describe("resolvePolishSystemPrompt", () => {
  const original = BUILTIN_RULES.find((r) => r.id === "polish.script-text")!
    .content.zh;

  it("无匹配（自定义提示词）时原样返回，不查 settingsStore", () => {
    const custom = "你是一个完全自定义的润色专家提示词。";
    expect(resolvePolishSystemPrompt(custom)).toBe(custom);
  });

  it("匹配内置条目且用户已覆盖（enabled）→ 返回覆盖版 content.zh", () => {
    useSettingsStore.setState({
      promptRules: [
        makeRule({
          id: "polish.script-text",
          task: "polish",
          section: "rules",
          content: { zh: "覆盖后的文案专家提示词", en: "overridden" },
          enabled: true,
          source: "builtin",
        }),
      ],
    });
    expect(resolvePolishSystemPrompt(original)).toBe(
      "覆盖后的文案专家提示词",
    );
  });

  it("匹配内置条目但覆盖版 enabled=false → 返回内置原文", () => {
    useSettingsStore.setState({
      promptRules: [
        makeRule({
          id: "polish.script-text",
          task: "polish",
          section: "rules",
          content: { zh: "被禁用的覆盖版", en: "disabled override" },
          enabled: false,
          source: "builtin",
        }),
      ],
    });
    expect(resolvePolishSystemPrompt(original)).toBe(original);
  });

  it("匹配内置条目但 settingsStore 无该 id 的差异 → 返回内置原文", () => {
    useSettingsStore.setState({
      promptRules: [
        makeRule({
          id: "polish.visual-prompt",
          task: "polish",
          section: "rules",
          content: { zh: "别的条目的覆盖", en: "other" },
        }),
      ],
    });
    expect(resolvePolishSystemPrompt(original)).toBe(original);
  });
});

/* ── buildCharacterAppearancePrompt ─────────────────────────────────────── */

describe("buildCharacterAppearancePrompt", () => {
  it("恒英文渲染，含物种锁定条目与输出格式要求", () => {
    const out = buildCharacterAppearancePrompt();
    expect(out).toContain("never change the subject's identity");
    expect(out).toContain("A rabbit stays a rabbit");
    expect(out).toContain("normal anatomy");
    expect(out).toContain("one head, one body");
    expect(out).toContain("Return ONLY the appearance description");
    // 不残留未替换占位符
    expect(out).not.toContain("{{rules}}");
    expect(out).not.toContain("{{#rules}}");
    expect(out).not.toContain("{{assets}}");
  });

  it("用户覆盖 character.species-lock 后渲染覆盖内容", () => {
    useSettingsStore.setState({
      promptRules: [
        makeRule({
          id: "character.species-lock",
          task: "characterAppearance",
          section: "rules",
          content: { zh: "- 自定义物种锁定", en: "- CUSTOM SPECIES LOCK RULE" },
          enabled: true,
          source: "builtin",
        }),
      ],
    });
    const out = buildCharacterAppearancePrompt();
    expect(out).toContain("- CUSTOM SPECIES LOCK RULE");
    expect(out).not.toContain("A rabbit stays a rabbit");
  });
});
