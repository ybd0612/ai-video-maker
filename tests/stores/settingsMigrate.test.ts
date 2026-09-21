// ────────────────────────────────────────────────────────────────────────────
// tests/stores/settingsMigrate.test.ts
// settingsStore 持久化迁移（migratePersistedSettings 纯函数）的单测：
// - v0 → v1：apihub.agnes-ai.com 旧域名迁移到中国站（旧分支不回归）
// - v1 → v2：promptRules 缺失/非法兜底 []；合法数组原样保留
// - v2 → v3：theme 缺失兜底 light（默认白色）；显式 dark 保留
// - v3 → v4：移除 persistLog 开关（日志持久化恒开），旧存储残留字段被删除
// - 坏结构不抛错
// 用 tests/helpers/localStorage.ts 桩（node 环境，persist 模块加载期读 storage）。
// ────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installLocalStorageStub, removeLocalStorageStub } from "../helpers/localStorage";
import { migratePersistedSettings, useSettingsStore } from "@/stores/settingsStore";

beforeEach(() => {
  installLocalStorageStub();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  removeLocalStorageStub();
  vi.useRealTimers();
});

describe("migratePersistedSettings：v0 → v1（域名迁移不回归）", () => {
  it("apihub.agnes-ai.com（https）迁移到 api.agnes-ai.cn", () => {
    const migrated = migratePersistedSettings(
      { providerConfig: { apiKey: "sk-x", baseUrl: "https://apihub.agnes-ai.com/v1", plan: "default" } },
      0,
    );
    expect(migrated.providerConfig?.baseUrl).toBe("https://api.agnes-ai.cn/v1");
    expect(migrated.providerConfig?.apiKey).toBe("sk-x");
  });

  it("apihub.agnes-ai.com（http）同样迁移", () => {
    const migrated = migratePersistedSettings(
      { providerConfig: { apiKey: "", baseUrl: "http://apihub.agnes-ai.com", plan: "default" } },
      0,
    );
    expect(migrated.providerConfig?.baseUrl).toBe("https://api.agnes-ai.cn/v1");
  });

  it("用户自定义地址不受影响", () => {
    const migrated = migratePersistedSettings(
      { providerConfig: { apiKey: "sk-x", baseUrl: "https://my-proxy.example.com/v1", plan: "pro" } },
      1,
    );
    expect(migrated.providerConfig?.baseUrl).toBe("https://my-proxy.example.com/v1");
  });
});

describe("migratePersistedSettings：v1 → v2（promptRules 兜底）", () => {
  it("缺失 promptRules 兜底为空数组", () => {
    const migrated = migratePersistedSettings({ providerConfig: { apiKey: "k", baseUrl: "u", plan: "default" } }, 1);
    expect(migrated.promptRules).toEqual([]);
  });

  it("promptRules 为非数组（坏结构）兜底为空数组", () => {
    const migrated = migratePersistedSettings({ promptRules: "bad" as unknown, providerConfig: undefined }, 1);
    expect(migrated.promptRules).toEqual([]);
  });

  it("合法 promptRules 数组原样保留", () => {
    const rules = [
      {
        id: "custom.x",
        task: "storyboard",
        section: "rules",
        content: { zh: "- 自定义", en: "- custom" },
        enabled: true,
        source: "custom",
      },
    ];
    const migrated = migratePersistedSettings({ promptRules: rules }, 1);
    expect(migrated.promptRules).toEqual(rules);
  });

  it("version >= 2 时不再兜底（幂等 no-op，已迁移数据不动）", () => {
    const migrated = migratePersistedSettings(
      { promptRules: "bad" as unknown, providerConfig: { apiKey: "k", baseUrl: "u", plan: "default" } },
      2,
    );
    // v2 输入跳过 v1→v2 分支
    expect(migrated.promptRules).toBe("bad");
  });

  it("兜底与域名迁移可同时生效", () => {
    const migrated = migratePersistedSettings(
      { providerConfig: { apiKey: "k", baseUrl: "https://apihub.agnes-ai.com/v1", plan: "default" } },
      0,
    );
    expect(migrated.providerConfig?.baseUrl).toBe("https://api.agnes-ai.cn/v1");
    expect(migrated.promptRules).toEqual([]);
  });
});

describe("migratePersistedSettings：v2 → v3（theme 默认白色）", () => {
  it("缺失 theme 兜底为 light", () => {
    const migrated = migratePersistedSettings(
      { providerConfig: { apiKey: "k", baseUrl: "u", plan: "default" } },
      2,
    );
    expect(migrated.theme).toBe("light");
  });

  it("非法 theme 兜底为 light", () => {
    const migrated = migratePersistedSettings(
      { theme: "blue" as unknown as "light" | "dark" },
      2,
    );
    expect(migrated.theme).toBe("light");
  });

  it("已存显式 dark 保留（用户主动切过黑主题不丢）", () => {
    const migrated = migratePersistedSettings({ theme: "dark" }, 2);
    expect(migrated.theme).toBe("dark");
  });

  it("version >= 3 时不再兜底（幂等 no-op）", () => {
    const migrated = migratePersistedSettings({}, 3);
    expect(migrated.theme).toBeUndefined();
  });
});

describe("migratePersistedSettings：v3 → v4（persistLog 开关移除）", () => {
  it("旧存储残留的 persistLog 字段被删除，其余日志开关不受影响", () => {
    const migrated = migratePersistedSettings(
      { persistLog: false, loggingEnabled: true, showLogPanel: true },
      3,
    );
    // 字段已从 SettingsState 类型中移除；若残留会被 zustand persist 浅合并塞回 state
    expect("persistLog" in migrated).toBe(false);
    expect(migrated.loggingEnabled).toBe(true);
    expect(migrated.showLogPanel).toBe(true);
  });

  it("version >= 4 时该分支为 no-op（不误删其它字段）", () => {
    const migrated = migratePersistedSettings({ theme: "dark", showLogPanel: false }, 4);
    expect(migrated.theme).toBe("dark");
    expect(migrated.showLogPanel).toBe(false);
  });
});

describe("migratePersistedSettings：坏结构不抛错", () => {
  it("空对象 / null providerConfig 均不抛错", () => {
    expect(() => migratePersistedSettings({}, 0)).not.toThrow();
    expect(() => migratePersistedSettings({ providerConfig: undefined }, 1)).not.toThrow();
  });
});

describe("新增持久化字段 videoConsistency（靠默认值兜底，不加迁移分支）", () => {
  it("v4 旧数据迁移后不注入该字段，交由 store 初始值兜底", () => {
    const migrated = migratePersistedSettings({ theme: "light", providerConfig: { apiKey: "k", baseUrl: "https://api.agnes-ai.cn/v1", plan: "default" } }, 4);
    expect("videoConsistency" in (migrated as Record<string, unknown>)).toBe(false);
  });

  it("store 默认策略为 chain（同场景自动衔接）", () => {
    expect(useSettingsStore.getState().videoConsistency).toBe("chain");
  });
});
