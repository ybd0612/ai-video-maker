import { Sidebar } from "@/components/Sidebar";
import { SettingsDialog } from "@/components/SettingsDialog";
import { CanvasWorkspace } from "@/canvas/CanvasWorkspace";
import { ApiKeyBanner } from "@/components/ApiKeyBanner";
import { useEffect } from "react";
import { ConfirmDialogProvider } from "@/components/ui/ConfirmDialog";

export default function App() {
  /* ── Block browser native context menu globally ──────────────────────── */
  useEffect(() => {
    const handler = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", handler);
    return () => document.removeEventListener("contextmenu", handler);
  }, []);

  return (
    <ConfirmDialogProvider>
      <div className="flex h-screen w-screen overflow-hidden">
        <Sidebar />
        <main className="relative flex-1">
          <ApiKeyBanner />
          <CanvasWorkspace />
        </main>
        <SettingsDialog />
      </div>
    </ConfirmDialogProvider>
  );
}