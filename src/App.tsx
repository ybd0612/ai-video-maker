import { SettingsDialog } from "@/components/SettingsDialog";
import { ProjectWorkspace } from "@/pages/ProjectWorkspace";
import { ConfirmDialogProvider } from "@/components/ui/ConfirmDialog";

export default function App() {
  return (
    <ConfirmDialogProvider>
      <ProjectWorkspace />
      <SettingsDialog />
    </ConfirmDialogProvider>
  );
}
