// ────────────────────────────────────────────────────────────────────────────
// 浅色主题层级 token 的绊线：断言「辅助文字 / 弱化文字」与「常规边框 / 弱边框」
// 不再是同一个值。改回同值会让全站的视觉层级失效（2026-09-23 实测根因），
// 因此这条测试是防回归，不是描述偏好。
// 直接读源码文本解析：本仓库不渲染 CSS，也不引入 postcss。
// ────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(
  fileURLToPath(new URL("../../src/styles/globals.css", import.meta.url)),
  "utf8",
);

/** 取 :root { ... } 段（第一个块）内的变量表 */
function rootVars(): Record<string, string> {
  const body = CSS.slice(CSS.indexOf(":root"), CSS.indexOf("html[data-theme"));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--c-[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))/g)) {
    out[m[1]] = m[2].toLowerCase();
  }
  return out;
}

/** WCAG 相对亮度 */
function relLum(hex: string): number {
  const raw = hex.replace("#", "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw.slice(0, 6);
  const ch = [0, 2, 4].map((i) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("浅色主题层级 token", () => {
  const v = rootVars();

  it("解析到 :root 的全部层级变量（解析器若失效必须红，不允许静默通过）", () => {
    for (const key of ["--c-app", "--c-raised", "--c-line", "--c-line-soft",
      "--c-ink", "--c-ink-2", "--c-ink-3", "--c-ink-4", "--c-ink-5"]) {
      expect(v[key], `${key} 未解析到`).toMatch(/^#/);
    }
  });

  it("文字四档两档不同值：弱化文字不再等于辅助文字", () => {
    expect(v["--c-ink-4"]).not.toBe(v["--c-ink-3"]);
  });

  it("五档文字严格递减（ink 最深 → ink-5 最弱）", () => {
    const ramp = ["--c-ink", "--c-ink-2", "--c-ink-3", "--c-ink-4", "--c-ink-5"].map((k) => relLum(v[k]));
    for (let i = 1; i < ramp.length; i++) {
      expect(ramp[i], `第 ${i} 档未比前一档更浅`).toBeGreaterThan(ramp[i - 1]);
    }
  });

  it("边框两档不再同值：弱边框专管内部分隔", () => {
    expect(v["--c-line-soft"]).not.toBe(v["--c-line"]);
    // 且必须仍然可见（比页面底更深一点才算「分割线」）
    expect(relLum(v["--c-line"])).toBeLessThan(relLum(v["--c-app"]));
  });

  it("弱化文字仍要读得清：ink-4 在三种底色上均不低于 3:1", () => {
    for (const bg of ["--c-app", "--c-surface", "--c-raised"]) {
      expect(contrast(v["--c-ink-4"], v[bg]), `${bg} 上对比度不足`).toBeGreaterThanOrEqual(3);
    }
  });

  it("深色主题不被误改（已分得开，本任务不动它）", () => {
    const dark = CSS.slice(CSS.indexOf("html[data-theme=\"dark\"]"));
    expect(dark).toContain("--c-ink-3: #94a3b8");
    expect(dark).toContain("--c-ink-4: #64748b");
  });
});
