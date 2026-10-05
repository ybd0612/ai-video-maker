import { AlertTriangle, Settings } from "lucide-react";
import { useSettingsStore } from "@/stores/settingsStore";
import { useT } from "@/i18n";

export function ApiKeyBanner() {
  const apiKey = useSettingsStore((s) => s.providerConfig.apiKey);
  const setOpen = useSettingsStore((s) => s.setSettingsDialogOpen);
  const t = useT();

  if (apiKey) return null;

  return (
    <div className="absolute top-0 left-0 right-0 z-40 flex items-center gap-3 bg-warn-deep/90 border-b border-warn px-4 py-2.5 backdrop-blur-sm">
      <AlertTriangle className="h-4 w-4 text-warn flex-shrink-0" />
      <span className="text-xs text-warn">
        {t("pipeline.apiKeyRequired")}
      </span>
      <button
        onClick={() => setOpen(true)}
        className="ml-auto flex items-center gap-1.5 rounded-md bg-warn-solid px-3 py-1 text-xs font-medium text-white hover:bg-warn-solid transition"
      >
        <Settings className="h-3.5 w-3.5" />
        {t("pipeline.openSettings")}
      </button>
    </div>
  );
}
