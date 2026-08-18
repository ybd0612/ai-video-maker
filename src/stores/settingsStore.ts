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
  darkMode: boolean;
  language: Language;
  settingsDialogOpen: boolean;
  providerConfig: ProviderConfig;

  toggleDarkMode: () => void;
  setLanguage: (lang: Language) => void;
  setSettingsDialogOpen: (open: boolean) => void;
  setProviderConfig: (config: Partial<ProviderConfig>) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      darkMode: true,
      language: 'zh',
      settingsDialogOpen: false,
      providerConfig: {
        apiKey: "",
        baseUrl: "https://apihub.agnes-ai.com/v1",
        plan: "default",
      },

      toggleDarkMode: () => set((s) => ({ darkMode: !s.darkMode })),
      setLanguage: (language) => set({ language }),
      setSettingsDialogOpen: (open) => set({ settingsDialogOpen: open }),
      setProviderConfig: (config) =>
        set((s) => ({ providerConfig: { ...s.providerConfig, ...config } })),
    }),
    { name: "wxhb-settings" },
  ),
);
