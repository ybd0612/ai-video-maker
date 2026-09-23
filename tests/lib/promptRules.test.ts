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
  getActiveRuleText,
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

  it("storyboardOutline 渲染含 shots 模板；storyboardShot 渲染含规则/安全 header", () => {
    const outline = buildSystemPrompt("storyboardOutline", "zh", BUILTIN_RULES);
    expect(outline).toContain('"shots"');
    expect(outline).toContain("{{assets}}");

    const zh = buildSystemPrompt("storyboardShot", "zh", BUILTIN_RULES);
    expect(zh).toContain("重要规则：");
    expect(zh).toContain("⚠️ 内容安全要求：");
    expect(zh).toContain("scriptText");

    const en = buildSystemPrompt("storyboardShot", "en", BUILTIN_RULES);
    expect(en).toContain("Important rules:");
    expect(en).toContain("Content safety:");
    expect(en).toContain("scriptText");
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
  it("zh/en 骨架均含 JSON 格式段（extractAssets / storyboardOutline）", () => {
    expect(SKELETONS.extractAssets.zh).toContain('"characters"');
    expect(SKELETONS.extractAssets.en).toContain('"characters"');
    expect(SKELETONS.storyboardOutline.zh).toContain('"shots"');
    expect(SKELETONS.storyboardOutline.en).toContain('"shots"');
    expect(SKELETONS.extractAssets.zh).toContain("{{assets}}");
    expect(SKELETONS.storyboardOutline.en).toContain("{{assets}}");
  });

  it("storyboard zh/en 骨架含三个 section 占位块", () => {
    for (const lang of ["zh", "en"] as const) {
      const s = SKELETONS.storyboardShot[lang];
      expect(s).toContain("{{#rules}}");
      expect(s).toContain("{{#examples}}");
      expect(s).toContain("{{#safety}}");
    }
  });

  it("characterFidelityAudit 骨架中英齐备，且划清「补全」与「换主体」的边界", () => {
    // 不给"不得判为越界"的豁免，审计会把正常的细节补全误判成换主体 → 每次提取都被重写
    expect(SKELETONS.characterFidelityAudit.zh).toContain("不得判为越界");
    expect(SKELETONS.characterFidelityAudit.zh).toContain("fixes");
    expect(SKELETONS.characterFidelityAudit.en).toContain("Must NOT be flagged");
    expect(SKELETONS.characterFidelityAudit.en).toContain("fixes");
  });

  it("storyboardShot 中英骨架同口径：主体外观都只允许一句短锚点", () => {
    // 上一轮短锚点修复只改了 zh 骨架，en 骨架仍写「reuse the provided asset
    // appearance descriptions verbatim」→ language=en 项目的 visualPrompt 膨胀
    // 缺陷（实测 9 镜 1100-1400 字、多角色镜头画出两只猫）至今仍在。
    expect(SKELETONS.storyboardShot.zh).toContain("只用所给的一句短外观锚点");
    const en = SKELETONS.storyboardShot.en;
    expect(en).not.toContain("descriptions verbatim");
    expect(en).toContain("one-line brief appearance anchor");
    expect(en).not.toMatch(/[一-鿿]/);
  });
});

/* ── mergeRules ───────────────────────────────────────────────────────────── */

describe("mergeRules", () => {
  it("同 id custom 存储版整体覆盖 builtin（content/enabled 均以存储版为准）", () => {
    const stored: PromptRule[] = [
      makeRule({
        id: "storyboard.shot-count",
        task: "storyboardShot",
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
      makeRule({ id: "custom.my-rule", task: "storyboardShot", section: "examples" }),
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
    const rendered = buildSystemPrompt("storyboardShot", "zh", disabled);
    expect(rendered).not.toContain("每镜头 duration 为 4、5 或 8 秒");
    // 其他条目仍在
    expect(rendered).toContain("必须用中文");
  });

  it("渲染顺序：rules → examples → safety", () => {
    const rules: PromptRule[] = [
      makeRule({ id: "c1", task: "storyboardShot", section: "safety", content: { zh: "SAFETY_ITEM", en: "SAFETY_ITEM" } }),
      makeRule({ id: "c2", task: "storyboardShot", section: "examples", content: { zh: "EXAMPLE_ITEM", en: "EXAMPLE_ITEM" } }),
      makeRule({ id: "c3", task: "storyboardShot", section: "rules", content: { zh: "RULES_ITEM", en: "RULES_ITEM" } }),
    ];
    const rendered = buildSystemPrompt("storyboardShot", "zh", rules);
    const iRules = rendered.indexOf("RULES_ITEM");
    const iExamples = rendered.indexOf("EXAMPLE_ITEM");
    const iSafety = rendered.indexOf("SAFETY_ITEM");
    expect(iRules).toBeGreaterThan(-1);
    expect(iExamples).toBeGreaterThan(iRules);
    expect(iSafety).toBeGreaterThan(iExamples);
  });

  it("空 section 连同 header 整块移除（不残留悬空标题）", () => {
    // 只保留 rules 与 safety，examples 全空 → 「参考示例：」 header 不残留
    const rendered = buildSystemPrompt("storyboardShot", "zh", BUILTIN_RULES);
    expect(rendered).not.toContain("参考示例：");
    const en = buildSystemPrompt("storyboardShot", "en", BUILTIN_RULES);
    expect(en).not.toContain("Examples:");
  });

  it("条目不串任务：polish 条目不会出现在 storyboard 渲染中", () => {
    const rendered = buildSystemPrompt("storyboardShot", "zh", BUILTIN_RULES);
    expect(rendered).not.toContain("视频文案优化专家");
  });

  it("extractAssets 生效提示词含主体忠实条目，且排在其它提取规则之前", () => {
    // 历史缺陷：提取阶段无任何主体约束 → 同一份想法两次提取分别得到
    // 「贵宾犬 Poodle」与「金毛犬 Labrador」，模型擅自换品种不算违规。
    const zh = buildSystemPrompt("extractAssets", "zh", BUILTIN_RULES);
    expect(zh).toContain("主体忠实（最高优先）");
    expect(zh).toContain("物种 + 品种");
    expect(zh.indexOf("主体忠实（最高优先）")).toBeLessThan(zh.indexOf("- characters："));

    const en = buildSystemPrompt("extractAssets", "en", BUILTIN_RULES);
    expect(en).toContain("Subject fidelity (highest priority)");
    expect(en.indexOf("Subject fidelity (highest priority)")).toBeLessThan(
      en.indexOf("- characters:"),
    );
    // 英文条目不得夹带未翻译的中文词（en 版会喂给 language=en 的项目）
    expect(en).not.toMatch(/[一-鿿]/);
  });

  it("extractAssets 生效提示词含「状态词转可画部件」条目，且排在主体忠实之后", () => {
    // 实测依据：给主体新增有形状的部件（双头、黑色眼罩）一次命中；改变已有部位的
    // 状态/材质（失明、闭眼、三条腿、刀疤、缝合线、流血）六组全失败，
    // 与内容审查无关（过滤器是显式 400）。判据只能是「部件 vs 状态」。
    const zh = buildSystemPrompt("extractAssets", "zh", BUILTIN_RULES);
    expect(zh).toContain("外观字段只写可画的部件");
    expect(zh).toContain("左眼失明 → 左眼戴黑色布质眼罩");
    // 状态事实一条不许丢：主体忠实高于可画性
    expect(zh).toContain("主体忠实高于可画性");
    // 例子只作说明，不构成清单（禁止品种词表 / 状态词黑名单 / 枚举白名单）
    expect(zh).toContain("不是清单也不穷尽");
    expect(zh.indexOf("主体忠实（最高优先）")).toBeLessThan(zh.indexOf("外观字段只写可画的部件"));

    const en = buildSystemPrompt("extractAssets", "en", BUILTIN_RULES);
    expect(en).toContain("Visual fields carry only paintable parts");
    expect(en).toContain("a blind left eye becomes a black cloth eye patch");
    expect(en).toContain("subject fidelity outranks paintability");
    expect(en).toContain("not a checklist and not exhaustive");
    expect(en.indexOf("Subject fidelity (highest priority)")).toBeLessThan(
      en.indexOf("Visual fields carry only paintable parts"),
    );
    expect(en).not.toMatch(/[一-鿿]/);
  });

  it("主体忠实审计不把「状态转写为部件」判为越界（与提取条目同口径，两档一起改）", () => {
    // 只改提取条目不改审计：转写结果会在写回前被审计按想法原文改回状态词 → 等于没改
    expect(SKELETONS.characterFidelityAudit.zh).toContain("等效部件");
    expect(SKELETONS.characterFidelityAudit.zh).toContain("不是换主体");
    expect(SKELETONS.characterFidelityAudit.en).toContain("equivalent part-shaped marker");
    expect(SKELETONS.characterFidelityAudit.en).toContain("not a subject swap");
    // 审计骨架 en 同样不得夹带中文
    expect(SKELETONS.characterFidelityAudit.en).not.toMatch(/[一-鿿]/);
  });

  it("摘要行作用域与示例全链路一致（两档只改一档等于没改的回归锁）", () => {
    const entry = BUILTIN_RULES.find((r) => r.id === "extract.paintable-features")!;
    // 摘要行由生图直接取用，必须一并纳入「不写状态词」的作用域
    expect(entry.content.zh).toContain("含 `description` 第 1 行摘要");
    expect(entry.content.en).toContain("including the first line of `description`");

    // 同一份渲染里不得残留教模型往摘要行写状态词的示例，否则新条目被就地抵消
    const animals = BUILTIN_RULES.find((r) => r.id === "extract.assets-animals")!.content.zh;
    expect(animals).toContain("一只左眼戴黑色布质眼罩的年长橘猫");
    expect(animals).not.toContain("一只左眼失明的年长橘猫");
    const zh = buildSystemPrompt("extractAssets", "zh", BUILTIN_RULES);
    expect(zh).not.toContain("写「一只左眼失明的年长橘猫」");
  });
});

/* ── getActiveRuleText（供提示词拼装链注入正向约束） ──────────────────────── */

describe("getActiveRuleText", () => {
  it("默认（无显式 rules）从内置条目提取某 task 的生效规则文本，按语言拼接", () => {
    const compose = getActiveRuleText("composeShot", "en");
    expect(compose).toContain("In multi-reference composition, declare each reference image's role");
    expect(compose).toContain("reuse the asset's appearancePrompt (Chinese) from the registry");
    const negative = getActiveRuleText("negativeStrategy", "en");
    expect(negative).toContain("Keep negative prompts to generic quality defects");
  });

  it("剥离前导 bullet（- / • / *），避免注入提示词出现孤立列表符", () => {
    const compose = getActiveRuleText("composeShot", "en");
    expect(compose.startsWith("-")).toBe(false);
    expect(compose.startsWith("•")).toBe(false);
  });

  it("zh 与 en 文本互不串语言", () => {
    const zh = getActiveRuleText("composeShot", "zh");
    const en = getActiveRuleText("composeShot", "en");
    expect(zh).toContain("多图合成时逐张声明参考图用途");
    expect(en).not.toContain("多图合成时逐张声明参考图用途");
    expect(zh).not.toContain("In multi-reference composition");
  });

  it("enabled=false 的条目被剔除", () => {
    const disabled = BUILTIN_RULES.map((r) =>
      r.id === "compose.registry-reuse" ? { ...r, enabled: false } : r,
    );
    const text = getActiveRuleText("composeShot", "en", disabled);
    expect(text).not.toContain("reuse the asset's appearancePrompt from the registry");
    // 另一条仍生效
    expect(text).toContain("In multi-reference composition, declare each reference image's role");
  });

  it("仅取目标 task：negativeStrategy 文本不含 composeShot 内容", () => {
    const negative = getActiveRuleText("negativeStrategy", "en");
    expect(negative).not.toContain("declare each reference image's role");
    expect(negative).toContain("Keep negative prompts to generic quality defects");
  });

  it("无任何生效条目时返回空串", () => {
    expect(getActiveRuleText("composeShot", "en", [])).toBe("");
  });
});
