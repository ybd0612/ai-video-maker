// tests/lib/dumpSanitize.test.ts
// Unit tests for the dev debug-dump sanitization (pure, no browser globals).

import { describe, expect, it } from "vitest";
import {
  MASKED_API_KEY,
  sanitizeForDump,
} from "@/lib/dumpSanitize";

describe("sanitizeForDump", () => {
  it("masks providerConfig.apiKey while keeping other settings fields", () => {
    const settings = {
      language: "zh",
      settingsDialogOpen: false,
      providerConfig: {
        apiKey: "sk-real-secret-value",
        baseUrl: "https://api.agnes-ai.cn/v1",
        plan: "default",
      },
      version: 1,
    };

    const result = sanitizeForDump({ project: null, settings });

    const safeSettings = result.settings as typeof settings;
    expect(safeSettings.providerConfig.apiKey).toBe(MASKED_API_KEY);
    // Sensitive value must not leak anywhere in the payload
    expect(JSON.stringify(result)).not.toContain("sk-real-secret-value");
    expect(safeSettings.providerConfig.baseUrl).toBe(
      "https://api.agnes-ai.cn/v1",
    );
    expect(safeSettings.providerConfig.plan).toBe("default");
    expect(safeSettings.language).toBe("zh");
    expect(safeSettings.version).toBe(1);
  });

  it("handles a missing apiKey field gracefully (no crash, no injected key)", () => {
    const settings = {
      providerConfig: { baseUrl: "https://api.agnes-ai.cn/v1", plan: "default" },
    };

    const result = sanitizeForDump({ project: null, settings });
    const safeSettings = result.settings as typeof settings;
    expect(safeSettings.providerConfig.apiKey).toBe(MASKED_API_KEY);
    expect(safeSettings.providerConfig.baseUrl).toBe(
      "https://api.agnes-ai.cn/v1",
    );
  });

  it("keeps settings without providerConfig untouched", () => {
    const settings = { language: "en" };
    const result = sanitizeForDump({ project: null, settings });
    expect(result.settings).toEqual({ language: "en" });
  });

  it("passes through null/undefined settings without throwing", () => {
    expect(sanitizeForDump({ project: null, settings: null }).settings).toBe(
      null,
    );
    expect(
      sanitizeForDump({ project: null, settings: undefined }).settings,
    ).toBeUndefined();
  });

  it("preserves the project payload as-is and stamps _dumpedAt", () => {
    const project = {
      projects: [{ id: "p1", name: "测试项目", shots: [] }],
      activeProjectId: "p1",
    };

    const result = sanitizeForDump({ project, settings: {} });

    expect(result.project).toEqual(project);
    expect(typeof result._dumpedAt).toBe("string");
    expect(Number.isNaN(Date.parse(result._dumpedAt as string))).toBe(false);
  });
});
