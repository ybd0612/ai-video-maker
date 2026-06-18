import { useEffect, useRef } from "react";
import { AlertTriangle, Settings } from "lucide-react";
import { useSettingsStore } from "@/stores/settingsStore";
import { useT } from "@/i18n";

export function ApiKeyBanner() {
  const apiKey = useSettingsStore((s) => s.providerConfig.apiKey);
  const setOpen = useSettingsStore((s) => s.setSettingsDialogOpen);
  const autoOpened = useRef(false);
  const t = useT();

  // Auto-open settings dialog on first visit when no API key is configured
  useEffect(() => {
    if (!apiKey && !autoOpened.current) {
      autoOpened.current = true;
      setOpen(true);
    }
  }, [apiKey, setOpen]);

  if (apiKey) return null;

  return (
    <div className="absolute top-0 left-0 right-0 z-40 flex items-center gap-3 bg-amber-950/90 border-b border-amber-800 px-4 py-2.5 backdrop-blur-sm">
      <AlertTriangle size={16} className="text-amber-400 flex-shrink-0" />
      <span className="text-xs text-amber-200">
        {t("pipeline.apiKeyRequired")}
      </span>
      <button
        onClick={() => setOpen(true)}
        className="ml-auto flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-500 transition"
      >
        <Settings size={12} />
        {t("pipeline.openSettings")}
      </button>
    </div>
  );
}
