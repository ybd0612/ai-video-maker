import { Settings, Trash2 } from "lucide-react";
import { useSettingsStore } from "@/stores/settingsStore";
import { useCanvasStore } from "@/stores/canvasStore";
import { TaskTreeView } from "@/components/TaskTreeView";
import { useT } from '@/i18n';
import { confirmDialog } from "@/components/ui/ConfirmDialog";

export function Sidebar() {
  const openSettings = useSettingsStore((s) => s.setSettingsDialogOpen);
  const t = useT();
  const clearAll = useCanvasStore((s) => s.clearAll);
  const nodeCount = useCanvasStore((s) => s.nodes.length);

  return (
    <div className="flex h-full w-56 flex-col border-r border-slate-800 bg-slate-950">
      {/* Logo */}
      <div className="border-b border-slate-800 px-4 py-3">
        <h1 className="text-sm font-bold text-slate-100">
          {t("sidebar.logoTitle")}
        </h1>
        <p className="text-xs text-slate-500">{t("sidebar.logoSubtitle")}</p>
      </div>

      {/* Tree-view task manager */}
      <div className="flex-1 overflow-y-auto flex flex-col">
        <TaskTreeView />
      </div>

      {/* Footer actions */}
      <div className="border-t border-slate-800 p-3 space-y-1">
        <button
          onClick={() => openSettings(true)}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
        >
          <Settings size={13} /> {t("sidebar.settings")}
        </button>
        <button
          onClick={async () => {
            if (nodeCount === 0) { clearAll(); return; }
            const ok = await confirmDialog({
              title: t("sidebar.clearCanvas"),
              message: t("sidebar.clearConfirm"),
              confirmLabel: t("dialog.confirm"),
              variant: "danger",
            });
            if (ok) clearAll();
          }}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs text-red-400/70 transition hover:bg-red-950/40 hover:text-red-400"
        >
          <Trash2 size={13} /> {t("sidebar.clearCanvas")}
        </button>
      </div>
    </div>
  );
}