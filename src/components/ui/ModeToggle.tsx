// ────────────────────────────────────────────────────────────────────────────
// src/components/ui/ModeToggle.tsx
// Toggle between simple and drama mode for the active project.
// ────────────────────────────────────────────────────────────────────────────

import { useProjectStore, selectActiveProject } from "@/stores/projectStore";
import { useT } from "@/i18n";
import { Clapperboard } from "lucide-react";

export function ModeToggle() {
  const t = useT();
  const project = useProjectStore(selectActiveProject);
  const setProjectMode = useProjectStore((s) => s.setProjectMode);

  if (!project) return null;

  const isDrama = project.mode === "drama";

  return (
    <button
      onClick={() => setProjectMode(isDrama ? "simple" : "drama")}
      className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition ${
        isDrama
          ? "bg-amber-950/40 text-amber-400 border border-amber-700/50"
          : "bg-slate-800 text-slate-400 border border-slate-700 hover:border-slate-600"
      }`}
      title={isDrama ? t("mode.switchToSimple") : t("mode.switchToDrama")}
    >
      <Clapperboard size={11} />
      {isDrama ? t("mode.drama") : t("mode.simple")}
    </button>
  );
}
