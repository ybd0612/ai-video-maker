import { SettingsDialog } from "@/components/SettingsDialog";
import { ProjectWorkspace } from "@/pages/ProjectWorkspace";
import { useEffect } from "react";
import { ConfirmDialogProvider } from "@/components/ui/ConfirmDialog";

export default function App() {
  /* Block browser native context menu globally */
  useEffect(() => {
    const handler = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", handler);
    return () => document.removeEventListener("contextmenu", handler);
  }, []);

  return (
    <ConfirmDialogProvider>
      <ProjectWorkspace />
      <SettingsDialog />
    </ConfirmDialogProvider>
  );
}
