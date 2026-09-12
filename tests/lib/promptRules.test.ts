// ────────────────────────────────────────────────────────────────────────────
// tests/lib/promptRules.test.ts
// 提示词规则注册表的单测：
// - BUILTIN_RULES 默认渲染含全部默认条目内容（回归锁）
// - mergeRules：同 id 覆盖（content/enabled 以存储版为准）/ custom 追加 / 顺序保持
// - buildSystemPrompt：enabled=false 剔除、渲染顺序 rules → examples → safety、
//   空 section 连同 header 整块移除
// - zh/en 骨架均含 JSON 格式段
// ────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installLocalStorageStub, removeLocalStorageStub } from "../helpers/localStorage";
import {
  BUILTIN_RULES,
  SKELETONS,
  buildSystemPrompt,
  mergeRules,
  type PromptRule,
} from "@/lib/promptRules";

beforeEach(() => {
  installLocalStorageStub();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  removeLocalStorageStub();
});

/* ── 工厂 ─────────────────────────────────────────────────────────────────── */

function makeRule(overrides: Partial<PromptRule> & Pick<PromptRule, "id" | "task" | "section">): PromptRule {
  return {
    content: { zh: "- 默认中文规则", en: "- default en rule" },
    enabled: true,
    source: "custom",
    ...overrides,
  };
}

/* ── BUILTIN_RULES 回归锁 ──────────────────────────────────────────────────── */

describe("BUILTIN_RULES 默认渲染回归锁", () => {
  it("每个内置条目的内容都出现在其 task+language 的渲染结果中", () => {
    for (const rule of BUILTIN_RULES) {
      for (const lang of ["zh", "en"] as const) {
        const rendered = buildSystemPrompt(rule.task, lang, BUILTIN_RULES);
        const firstLine = rule.content[lang].split("\n")[0].trim();
        expect(rendered, `rule ${rule.id} (${lang})`).toContain(firstLine);
      }
    }
  });

  it("storyboard 渲染含 JSON 模板与规则/安全 header", () => {
    const zh = buildSystemPrompt("storyboard", "zh", BUILTIN_RULES);
    expect(zh).toContain("重要规则：");
    expect(zh).toContain("⚠️ 内容安全要求：");
    expect(zh).toContain('"shots"');
    expect(zh).toContain('"appearancePrompt"');

    const en = buildSystemPrompt("storyboard", "en", BUILTIN_RULES);
    expect(en).toContain("Important rules:");
    expect(en).toContain("Content safety:");
    expect(en).toContain('"shots"');
  });

  it("关键内置条目 id 齐全（architect 清单回归锁）", () => {
    const ids = new Set(BUILTIN_RULES.map((r) => r.id));
    for (const id of [
      "extract.assets-animals",
      "extract.assets-products",
      "extract.assets-scenes",
      "storyboard.shot-count",
      "storyboard.prompt-english",
      "storyboard.character-appearance",
      "storyboard.dialogues",
      "storyboard.duration",
      "safety.age-wording",
      "safety.content",
      "safety.clothing",
      "character.species-lock",
      "character.infer-missing",
      "styleref.no-characters",
      "negative.strategy",
      "compose.multi-reference",
      "polish.script-text",
      "polish.visual-prompt",
      "polish.main-prompt",
      "polish.motion-prompt",
      "polish.description-zh",
      "polish.character-description",
      "polish.negative-prompt",
      "polish.character",
      "polish.dialogue",
    ]) {
      expect(ids.has(id), `missing builtin rule: ${id}`).toBe(true);
    }
  });

  it("polish 条目为单语原文（zh=en），内容与迁移前的 chatService 常量逐字一致", () => {
    const scriptText = BUILTIN_RULES.find((r) => r.id === "polish.script-text")!;
    expect(scriptText.content.zh).toBe(scriptText.content.en);
    expect(scriptText.content.zh).toContain("视频文案优化专家");

    const character = BUILTIN_RULES.find((r) => r.id === "polish.character")!;
    expect(character.content.zh).toBe(character.content.en);
    expect(character.content.zh).toContain("never change the subject's identity");
  });
});

/* ── SKELETONS ────────────────────────────────────────────────────────────── */

describe("SKELETONS", () => {
  it("zh/en 骨架均含 JSON 格式段（extractAssets / storyboard）", () => {
    for (const task of ["extractAssets", "storyboard"] as const) {
      expect(SKELETONS[task].zh).toContain('"characters"');
      expect(SKELETONS[task].en).toContain('"characters"');
      expect(SKELETONS[task].zh).toContain("{{assets}}");
      expect(SKELETONS[task].en).toContain("{{assets}}");
    }
  });

  it("storyboard zh/en 骨架含三个 section 占位块", () => {
    for (const lang of ["zh", "en"] as const) {
      const s = SKELETONS.storyboard[lang];
      expect(s).toContain("{{#rules}}");
      expect(s).toContain("{{#examples}}");
      expect(s).toContain("{{#safety}}");
    }
  });
});

/* ── mergeRules ───────────────────────────────────────────────────────────── */

describe("mergeRules", () => {
  it("同 id custom 存储版整体覆盖 builtin（content/enabled 均以存储版为准）", () => {
    const stored: PromptRule[] = [
      makeRule({
        id: "storyboard.shot-count",
        task: "storyboard",
        section: "rules",
        content: { zh: "- 总镜头数改为 6 个", en: "- exactly 6 shots" },
        enabled: false,
        source: "builtin",
      }),
    ];

    const merged = mergeRules(BUILTIN_RULES, stored);
    const target = merged.find((r) => r.id === "storyboard.shot-count")!;
    expect(target.content.zh).toBe("- 总镜头数改为 6 个");
    expect(target.content.en).toBe("- exactly 6 shots");
    expect(target.enabled).toBe(false);
    // 其他内置条目不受影响
    const other = merged.find((r) => r.id === "storyboard.duration")!;
    expect(other.enabled).toBe(true);
  });

  it("仅存在于 stored 的自定义条目追加在 builtin 之后", () => {
    const stored: PromptRule[] = [
      makeRule({ id: "custom.my-rule", task: "storyboard", section: "examples" }),
    ];
    const merged = mergeRules(BUILTIN_RULES, stored);
    expect(merged.length).toBe(BUILTIN_RULES.length + 1);
    expect(merged[merged.length - 1].id).toBe("custom.my-rule");
    // builtin 顺序保持
    expect(merged.slice(0, BUILTIN_RULES.length).map((r) => r.id)).toEqual(
      BUILTIN_RULES.map((r) => r.id),
    );
  });

  it("stored 为空时结果与 builtin 等价", () => {
    expect(mergeRules(BUILTIN_RULES, [])).toEqual(BUILTIN_RULES);
  });
});

/* ── buildSystemPrompt ────────────────────────────────────────────────────── */

describe("buildSystemPrompt", () => {
  it("enabled=false 的条目被剔除", () => {
    const disabled: PromptRule[] = BUILTIN_RULES.map((r) =>
      r.id === "storyboard.duration" ? { ...r, enabled: false } : r,
    );
    const rendered = buildSystemPrompt("storyboard", "zh", disabled);
    expect(rendered).not.toContain("每镜头 duration 为 4、5 或 8 秒");
    // 其他条目仍在
    expect(rendered).toContain("总镜头数 4-8 个");
  });

  it("渲染顺序：rules → examples → safety", () => {
    const rules: PromptRule[] = [
      makeRule({ id: "c1", task: "storyboard", section: "safety", content: { zh: "SAFETY_ITEM", en: "SAFETY_ITEM" } }),
      makeRule({ id: "c2", task: "storyboard", section: "examples", content: { zh: "EXAMPLE_ITEM", en: "EXAMPLE_ITEM" } }),
      makeRule({ id: "c3", task: "storyboard", section: "rules", content: { zh: "RULES_ITEM", en: "RULES_ITEM" } }),
    ];
    const rendered = buildSystemPrompt("storyboard", "zh", rules);
    const iRules = rendered.indexOf("RULES_ITEM");
    const iExamples = rendered.indexOf("EXAMPLE_ITEM");
    const iSafety = rendered.indexOf("SAFETY_ITEM");
    expect(iRules).toBeGreaterThan(-1);
    expect(iExamples).toBeGreaterThan(iRules);
    expect(iSafety).toBeGreaterThan(iExamples);
  });

  it("空 section 连同 header 整块移除（不残留悬空标题）", () => {
    // 只保留 rules 与 safety，examples 全空 → 「参考示例：」 header 不残留
    const rendered = buildSystemPrompt("storyboard", "zh", BUILTIN_RULES);
    expect(rendered).not.toContain("参考示例：");
    const en = buildSystemPrompt("storyboard", "en", BUILTIN_RULES);
    expect(en).not.toContain("Examples:");
  });

  it("条目不串任务：polish 条目不会出现在 storyboard 渲染中", () => {
    const rendered = buildSystemPrompt("storyboard", "zh", BUILTIN_RULES);
    expect(rendered).not.toContain("视频文案优化专家");
  });
});
