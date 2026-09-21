// ────────────────────────────────────────────────────────────────────────────
// src/stores/settingsStore.ts
// Global app settings (persisted to localStorage — lightweight).
// ────────────────────────────────────────────────────────────────────────────

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PlanId } from "@/lib/plans";
import type { PromptRule } from "@/lib/promptRules";

export type Language = 'zh' | 'en';

/** 界面主题：light 为默认（2026-09-12 用户拍板），dark 通过 <html data-theme="dark"> 生效 */
export type Theme = 'light' | 'dark';

export interface ProviderConfig {
  apiKey: string;
  baseUrl: string;
  /**
   * Agnes 访问套餐/计划。默认 "default"（免费）。
   * 决定 RPM 与订阅配额上限；用户升级后在此切换以解除限制。
   */
  plan: PlanId;
}

interface SettingsState {
  theme: Theme;
  language: Language;
  settingsDialogOpen: boolean;
  providerConfig: ProviderConfig;
  /**
   * 提示词规则（仅存用户动过的条目：自定义条目 + 对内置条目的覆盖/开关）。
   * 与 BUILTIN_RULES 经 mergeRules 合并后生效；空数组 = 全部内置默认。
   */
  promptRules: PromptRule[];
  /**
   * 角色编辑器：AI 修改角色描述成功后自动重新生成定妆照（默认开启）。
   * 旧版本地存储缺此字段时由 persist 浅合并回退到默认值 true，无需迁移。
   */
  autoRegeneratePortrait: boolean;
  autoRegenerateAssetImages: boolean;
  /**
   * 运行日志采集开关（默认开启）。
   * 日志仅存内存环形缓冲（最多 1000 条），不上报网络；旧存储缺该字段时
   * 由 persist 浅合并回退到默认值 true，无需迁移。
   * 采集恒开的好处：打开日志面板时，刚刚失败的那次调用已经在里面。
   */
  loggingEnabled: boolean;
  /** 是否在主界面底部展示日志面板（DevTools 风格，默认关闭） */
  showLogPanel: boolean;
  /** 日志面板高度（px，可拖拽调整并持久化） */
  logPanelHeight: number;

  setTheme: (theme: Theme) => void;
  setLanguage: (lang: Language) => void;
  setSettingsDialogOpen: (open: boolean) => void;
  setProviderConfig: (config: Partial<ProviderConfig>) => void;
  /** 整体替换用户存储的规则差异（UI 计算好新数组后写入） */
  setPromptRules: (rules: PromptRule[]) => void;
  setAutoRegeneratePortrait: (value: boolean) => void;
  setAutoRegenerateAssetImages: (value: boolean) => void;
  setLoggingEnabled: (value: boolean) => void;
  setShowLogPanel: (value: boolean) => void;
  setLogPanelHeight: (value: number) => void;
}

/**
 * persist 存储迁移主体（导出纯函数，便于单测）：
 * - v0 → v1：历史遗留国际站地址（apihub.agnes-ai.com）迁移到中国站；
 * - v1 → v2：新增 promptRules（用户动过的提示词规则），缺失/非法一律兜底 []；
 * - v2 → v3：新增 theme（黑白主题切换），缺失兜底 light（默认白色），已存 dark 保留。
 */
export function migratePersistedSettings(
  persisted: unknown,
  version: number,
): Partial<SettingsState> {
  const state = { ...(persisted as Partial<SettingsState>) };

  // v0 → v1：仅迁移已知旧域名，用户自定义地址不受影响。
  // 中国站实测端点/响应与官方文档一致（见 docs/history/2026-08-18-video-generation-investigation.md）。
  const baseUrl = state.providerConfig?.baseUrl ?? "";
  if (
    baseUrl.startsWith("https://apihub.agnes-ai.com") ||
    baseUrl.startsWith("http://apihub.agnes-ai.com")
  ) {
    state.providerConfig = {
      ...state.providerConfig!,
      baseUrl: "https://api.agnes-ai.cn/v1",
    };
  }

  // v1 → v2：promptRules 兜底（缺失 / 非数组 → 空数组 = 全内置默认）
  if (version < 2 && !Array.isArray(state.promptRules)) {
    state.promptRules = [];
  }

  // v2 → v3：theme 兜底（缺失 / 非法 → light；显式 dark 保留）
  if (version < 3 && state.theme !== "dark") {
    state.theme = "light";
  }

  // v3 → v4：persistLog 开关已移除（日志持久化恒开，不再可关）。
  // 删掉旧存储里的残留字段，否则 zustand persist 的浅合并会把它塞回 state。
  if (version < 4) {
    delete (state as Record<string, unknown>).persistLog;
  }

  return state;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: "light",
      language: 'zh',
      settingsDialogOpen: false,
      providerConfig: {
        apiKey: "",
        baseUrl: "https://api.agnes-ai.cn/v1",
        plan: "default",
      },
      promptRules: [],
      autoRegeneratePortrait: true,
      autoRegenerateAssetImages: true,
      loggingEnabled: true,
      showLogPanel: false,
      logPanelHeight: 260,

      setTheme: (theme) => set({ theme }),
      setLanguage: (language) => set({ language }),
      setSettingsDialogOpen: (open) => set({ settingsDialogOpen: open }),
      setProviderConfig: (config) =>
        set((s) => ({ providerConfig: { ...s.providerConfig, ...config } })),
      setPromptRules: (promptRules) => set({ promptRules }),
      setAutoRegeneratePortrait: (autoRegeneratePortrait) => set({ autoRegeneratePortrait }),
      setAutoRegenerateAssetImages: (autoRegenerateAssetImages) => set({ autoRegenerateAssetImages }),
      setLoggingEnabled: (loggingEnabled) => set({ loggingEnabled }),
      setShowLogPanel: (showLogPanel) => set({ showLogPanel }),
      setLogPanelHeight: (logPanelHeight) => set({ logPanelHeight }),
    }),
    {
      name: "wxhb-settings",
      version: 4,
      // 迁移主体提取为导出纯函数 migratePersistedSettings（见上方），便于单测。
      // version 透传 zustand persist 提供的「已持久化数据的版本号」，各分支按 version 门控。
      migrate: (persisted, version) => migratePersistedSettings(persisted, version),
    },
  ),
);
