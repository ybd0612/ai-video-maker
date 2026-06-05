import { Sidebar } from "@/components/Sidebar";
import { SettingsDialog } from "@/components/SettingsDialog";
import { CanvasWorkspace } from "@/canvas/CanvasWorkspace";
import { ApiKeyBanner } from "@/components/ApiKeyBanner";

export default function App() {
  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar />
      <main className="relative flex-1">
        <ApiKeyBanner />
        <CanvasWorkspace />
      </main>
      <SettingsDialog />
    </div>
  );
}
