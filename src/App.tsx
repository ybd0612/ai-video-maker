import { useEffect } from "react";
import { SettingsDialog } from "@/components/SettingsDialog";
import { ProjectWorkspace } from "@/pages/ProjectWorkspace";
import { ConfirmDialogProvider } from "@/components/ui/ConfirmDialog";
import { useSettingsStore } from "@/stores/settingsStore";

export default function App() {
  // 主题单一来源是 settingsStore；index.html 内联脚本只负责首帧前的预置，
  // 这里负责把 store 里的 theme 持续同步到 <html data-theme>（切换即时生效）。
  const theme = useSettingsStore((s) => s.theme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <ConfirmDialogProvider>
      <ProjectWorkspace />
      <SettingsDialog />
    </ConfirmDialogProvider>
  );
}
