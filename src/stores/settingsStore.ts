// ────────────────────────────────────────────────────────────────────────────
// src/stores/settingsStore.ts
// Global app settings (persisted to localStorage — lightweight).
// ────────────────────────────────────────────────────────────────────────────

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PlanId } from "@/lib/plans";
import type { PromptRule } from "@/lib/promptRules";

export type Language = 'zh' | 'en';

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
  language: Language;
  settingsDialogOpen: boolean;
  providerConfig: ProviderConfig;
  /**
   * 提示词规则（仅存用户动过的条目：自定义条目 + 对内置条目的覆盖/开关）。
   * 与 BUILTIN_RULES 经 mergeRules 合并后生效；空数组 = 全部内置默认。
   */
  promptRules: PromptRule[];

  setLanguage: (lang: Language) => void;
  setSettingsDialogOpen: (open: boolean) => void;
  setProviderConfig: (config: Partial<ProviderConfig>) => void;
  /** 整体替换用户存储的规则差异（UI 计算好新数组后写入） */
  setPromptRules: (rules: PromptRule[]) => void;
}

/**
 * persist 存储迁移主体（导出纯函数，便于单测）：
 * - v0 → v1：历史遗留国际站地址（apihub.agnes-ai.com）迁移到中国站；
 * - v1 → v2：新增 promptRules（用户动过的提示词规则），缺失/非法一律兜底 []。
 */
export function migratePersistedSettings(
  persisted: unknown,
  version: number,
): Partial<SettingsState> {
  const state = { ...(persisted as Partial<SettingsState>) };

  // v0 → v1：仅迁移已知旧域名，用户自定义地址不受影响。
  // 中国站实测端点/响应与官方文档一致（见 docs/video-generation-investigation-2026-08-18.md）。
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

  return state;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      language: 'zh',
      settingsDialogOpen: false,
      providerConfig: {
        apiKey: "",
        baseUrl: "https://api.agnes-ai.cn/v1",
        plan: "default",
      },
      promptRules: [],

      setLanguage: (language) => set({ language }),
      setSettingsDialogOpen: (open) => set({ settingsDialogOpen: open }),
      setProviderConfig: (config) =>
        set((s) => ({ providerConfig: { ...s.providerConfig, ...config } })),
      setPromptRules: (promptRules) => set({ promptRules }),
    }),
    {
      name: "wxhb-settings",
      version: 2,
      // 迁移主体提取为导出纯函数 migratePersistedSettings（见上方），便于单测
      migrate: (persisted) => migratePersistedSettings(persisted, 0),
    },
  ),
);
