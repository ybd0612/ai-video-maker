import { Sidebar } from "@/components/Sidebar";
import { SettingsDialog } from "@/components/SettingsDialog";
import { CanvasWorkspace } from "@/canvas/CanvasWorkspace";
import { ApiKeyBanner } from "@/components/ApiKeyBanner";
import { ConfirmDialogProvider } from "@/components/ui/ConfirmDialog";

export default function App() {
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