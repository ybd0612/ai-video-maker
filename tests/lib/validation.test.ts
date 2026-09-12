// ────────────────────────────────────────────────────────────────────────────
// tests/lib/validation.test.ts
// 输入校验与清洗工具的单测。断言全部基于 src/lib/validation.ts 的实际实现。
// ────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import {
  calcNumFrames,
  clampNumber,
  isValidApiKey,
  isValidUrl,
  sanitizeNodeLabel,
  sanitizePrompt,
  sanitizeRichText,
  sanitizeTaskName,
  sanitizeText,
  validateLength,
} from "@/lib/validation";

describe("sanitizeText", () => {
  it("折叠内部连续空白并去掉首尾空白", () => {
    expect(sanitizeText("  a   b  ")).toBe("a b");
  });

  it("把换行与制表符统一折叠成单个空格", () => {
    expect(sanitizeText("a\n\t b")).toBe("a b");
  });

  it("空串返回空串", () => {
    expect(sanitizeText("")).toBe("");
  });
});

describe("sanitizeRichText", () => {
  it("剔除控制字符", () => {
    expect(sanitizeRichText("a\u0000b\u001Fc\u007Fd")).toBe("abcd");
  });

  it("保留换行与制表符（它们不属于被剔除的区间）", () => {
    expect(sanitizeRichText("a\nb\tc")).toBe("a\nb\tc");
  });

  it("去掉首尾空白", () => {
    expect(sanitizeRichText("  x  ")).toBe("x");
  });
});

describe("validateLength", () => {
  it("不传上下限时任何长度都合法", () => {
    expect(validateLength("", {})).toBeNull();
    expect(validateLength("abc", {})).toBeNull();
  });

  it("小于下限时返回中文错误文案", () => {
    expect(validateLength("abc", { min: 5 })).toBe("至少需要 5 个字符");
  });

  it("大于上限时返回中文错误文案", () => {
    expect(validateLength("abcdef", { max: 3 })).toBe("最多允许 3 个字符");
  });

  it("边界值视为合法（含上下限本身）", () => {
    expect(validateLength("abc", { min: 3 })).toBeNull();
    expect(validateLength("abc", { max: 3 })).toBeNull();
  });

  it("按原始长度判断，不做 trim", () => {
    expect(validateLength("  ", { min: 3 })).toBe("至少需要 3 个字符");
  });
});

describe("isValidUrl", () => {
  it("空值是合法的（可选字段）", () => {
    expect(isValidUrl("")).toBe(true);
  });

  it("接受 http / https", () => {
    expect(isValidUrl("https://api.agnes-ai.cn/v1")).toBe(true);
    expect(isValidUrl("http://127.0.0.1:5173")).toBe(true);
  });

  it("拒绝非 http(s) 协议", () => {
    expect(isValidUrl("ftp://example.com")).toBe(false);
    expect(isValidUrl("javascript:alert(1)")).toBe(false);
  });

  it("拒绝无法解析的字符串", () => {
    expect(isValidUrl("not a url")).toBe(false);
    expect(isValidUrl("//example.com")).toBe(false);
  });
});

describe("isValidApiKey", () => {
  it("空值与纯空白不合法", () => {
    expect(isValidApiKey("")).toBe(false);
    expect(isValidApiKey("   ")).toBe(false);
  });

  it("至少 9 个字符（首字符为字母或数字，其余 8 位及以上）", () => {
    // 注意：源码注释写的是「minimum 10 chars」，但正则实际允许 9 位。
    // 此处锁定真实行为，避免注释与实现不一致时无人察觉。
    expect(isValidApiKey("abcdefgh")).toBe(false);
    expect(isValidApiKey("abcdefghi")).toBe(true);
  });

  it("首字符不能是连字符或下划线", () => {
    expect(isValidApiKey("-abcdefghi")).toBe(false);
    expect(isValidApiKey("_abcdefghi")).toBe(false);
  });

  it("允许中间的连字符与下划线", () => {
    expect(isValidApiKey("sk-abcdefg")).toBe(true);
    expect(isValidApiKey("sk_abc-def_123")).toBe(true);
  });

  it("校验前会 trim", () => {
    expect(isValidApiKey("  sk-abcdefg  ")).toBe(true);
  });
});

describe("sanitizeNodeLabel", () => {
  it("折叠空白并截断到 40 字符", () => {
    expect(sanitizeNodeLabel("  a   b  ")).toBe("a b");
    expect(sanitizeNodeLabel("x".repeat(45))).toHaveLength(40);
  });
});

describe("sanitizeTaskName", () => {
  it("折叠空白并截断到 20 字符", () => {
    expect(sanitizeTaskName("y".repeat(30))).toHaveLength(20);
    expect(sanitizeTaskName("  a   b  ")).toBe("a b");
  });

  it("剔除 \u0001 这类非空白控制字符", () => {
    expect(sanitizeTaskName("a\u0001b")).toBe("ab");
  });

  it("换行先被折叠成空格，因此不会被直接删除", () => {
    expect(sanitizeTaskName("a\nb")).toBe("a b");
  });
});

describe("sanitizePrompt", () => {
  it("剔除控制字符但保留换行", () => {
    expect(sanitizePrompt("a\u0007b\nc")).toBe("ab\nc");
  });

  it("截断到 32000 字符上限", () => {
    expect(sanitizePrompt("a".repeat(33_000))).toHaveLength(32_000);
  });
});

describe("calcNumFrames", () => {
  it("按 8n + 1 取最接近的帧数", () => {
    expect(calcNumFrames(5, 24)).toBe(121);
    expect(calcNumFrames(5, 16)).toBe(81);
    expect(calcNumFrames(8, 24)).toBe(193);
  });

  it("结果下限为 9、上限为 441", () => {
    expect(calcNumFrames(0.01, 1)).toBe(9);
    expect(calcNumFrames(100, 30)).toBe(441);
  });

  it("任意合法输入下结果恒满足 8n + 1", () => {
    for (const duration of [0.5, 1, 2, 3, 4, 5, 6, 8, 10, 12, 20]) {
      for (const fps of [8, 15, 16, 24, 25, 30, 60]) {
        expect(calcNumFrames(duration, fps) % 8).toBe(1);
      }
    }
  });
});

describe("clampNumber", () => {
  it("区间内原样返回", () => {
    expect(clampNumber(5, 1, 10)).toBe(5);
  });

  it("低于下限取下限，高于上限取上限", () => {
    expect(clampNumber(-5, 1, 10)).toBe(1);
    expect(clampNumber(50, 1, 10)).toBe(10);
  });
});
