// ────────────────────────────────────────────────────────────────────────────
// src/stores/settingsStore.ts
// Global app settings (persisted to localStorage — lightweight).
// ────────────────────────────────────────────────────────────────────────────

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PlanId } from "@/lib/plans";

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

  setLanguage: (lang: Language) => void;
  setSettingsDialogOpen: (open: boolean) => void;
  setProviderConfig: (config: Partial<ProviderConfig>) => void;
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

      setLanguage: (language) => set({ language }),
      setSettingsDialogOpen: (open) => set({ settingsDialogOpen: open }),
      setProviderConfig: (config) =>
        set((s) => ({ providerConfig: { ...s.providerConfig, ...config } })),
    }),
    {
      name: "wxhb-settings",
      version: 1,
      migrate: (persisted) => {
        // v0 → v1：把历史遗留的国际站地址（apihub.agnes-ai.com）自动迁移到中国站，
        // 中国站实测端点/响应与官方文档一致（见 docs/video-generation-investigation-2026-08-18.md）。
        // 仅迁移已知旧域名，用户自定义地址不受影响。
        const state = persisted as Partial<SettingsState>;
        const baseUrl = state.providerConfig?.baseUrl ?? "";
        if (
          baseUrl.startsWith("https://apihub.agnes-ai.com") ||
          baseUrl.startsWith("http://apihub.agnes-ai.com")
        ) {
          return {
            ...state,
            providerConfig: {
              ...state.providerConfig!,
              baseUrl: "https://api.agnes-ai.cn/v1",
            },
          };
        }
        return state;
      },
    },
  ),
);
