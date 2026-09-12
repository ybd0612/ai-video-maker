// ────────────────────────────────────────────────────────────────────────────
// tests/lib/l10n.test.ts
// translateL10n 三分支：纯字符串原样返回 / L10nText key+params 插值 / 未知 key 原样。
// 用局部假 t 隔离 store，不依赖 settingsStore 初始化。
// ────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { translateL10n, type TranslateFn } from "@/i18n";

/** 局部翻译函数：mini 词典命中则插值，未命中原样返回 key（与 useT/getTranslation 兜底一致） */
const miniDict: Record<string, string> = {
  "history.projectCreated": "创建项目「{title}」",
  "history.scriptGenerated": "生成分镜（{count} 个镜头）",
};
const fakeT: TranslateFn = (key, params) => {
  let result = miniDict[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      result = result.replace(`{${k}}`, String(v));
    }
  }
  return result;
};

describe("translateL10n", () => {
  it("纯字符串（旧数据兜底）原样返回", () => {
    expect(translateL10n("创建项目「demo」", fakeT)).toBe("创建项目「demo」");
    expect(translateL10n("", fakeT)).toBe("");
  });

  it("L10nText：key 命中词典时按 params 插值翻译", () => {
    expect(
      translateL10n(
        { key: "history.projectCreated", params: { title: "demo" } },
        fakeT,
      ),
    ).toBe("创建项目「demo」");
    expect(
      translateL10n(
        { key: "history.scriptGenerated", params: { count: 5 } },
        fakeT,
      ),
    ).toBe("生成分镜（5 个镜头）");
  });

  it("L10nText 无 params 时直接取词典值", () => {
    miniDict["history.projectCleared"] = "清空当前项目";
    expect(translateL10n({ key: "history.projectCleared" }, fakeT)).toBe(
      "清空当前项目",
    );
  });

  it("未知 key 原样返回（持久化数据含已移除 key 的兜底）", () => {
    expect(
      translateL10n(
        { key: "history.goneKey" as never, params: { a: 1 } },
        fakeT,
      ),
    ).toBe("history.goneKey");
  });
});
