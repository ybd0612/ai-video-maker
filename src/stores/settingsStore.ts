// ────────────────────────────────────────────────────────────────────────────
// src/stores/settingsStore.ts
// Global app settings (persisted to localStorage — lightweight).
// ────────────────────────────────────────────────────────────────────────────

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Language = 'zh' | 'en';

export interface ProviderConfig {
  apiKey: string;
  baseUrl: string;
}

interface SettingsState {
  showGrid: boolean;
  showMinimap: boolean;
  snapToGrid: boolean;
  darkMode: boolean;
  language: Language;
  settingsDialogOpen: boolean;
  providerConfig: ProviderConfig;

  toggleGrid: () => void;
  toggleMinimap: () => void;
  toggleSnapToGrid: () => void;
  toggleDarkMode: () => void;
  setLanguage: (lang: Language) => void;
  setSettingsDialogOpen: (open: boolean) => void;
  setProviderConfig: (config: Partial<ProviderConfig>) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      showGrid: true,
      showMinimap: true,
      snapToGrid: false,
      darkMode: true,
      language: 'zh',
      settingsDialogOpen: false,
      providerConfig: {
        apiKey: "",
        baseUrl: "https://apihub.agnes-ai.com/v1",
      },

      toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
      toggleMinimap: () => set((s) => ({ showMinimap: !s.showMinimap })),
      toggleSnapToGrid: () => set((s) => ({ snapToGrid: !s.snapToGrid })),
      toggleDarkMode: () => set((s) => ({ darkMode: !s.darkMode })),
      setLanguage: (language) => set({ language }),
      setSettingsDialogOpen: (open) => set({ settingsDialogOpen: open }),
      setProviderConfig: (config) =>
        set((s) => ({ providerConfig: { ...s.providerConfig, ...config } })),
    }),
    { name: "wxhb-settings" },
  ),
);
