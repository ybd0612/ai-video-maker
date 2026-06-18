// ────────────────────────────────────────────────────────────────────────────
// src/features/shots/ShotList.tsx
// Left panel: list of shots with status badges and selection.
// ────────────────────────────────────────────────────────────────────────────

import { useProjectStore, type ShotStatus } from "@/stores/projectStore";
import { useT } from "@/i18n";
import {
  Image as ImageIcon,
  Film,
  AlertCircle,
  Loader2,
  Hash,
  GripVertical,
  Trash2,
} from "lucide-react";

interface ShotListProps {
  selectedShotId: string | null;
  onSelect: (shotId: string) => void;
}

const statusConfig: Record<ShotStatus, { icon: typeof Hash; color: string }> = {
  idle:      { icon: Hash,        color: "text-slate-600" },
  scripting: { icon: Loader2,     color: "text-sky-400 animate-spin" },
  scripted:  { icon: Hash,        color: "text-sky-400" },
  imaging:   { icon: Loader2,     color: "text-violet-400 animate-spin" },
  imaged:    { icon: ImageIcon,   color: "text-violet-400" },
  videoing:  { icon: Loader2,     color: "text-amber-400 animate-spin" },
  videoed:   { icon: Film,        color: "text-amber-400" },
  failed:    { icon: AlertCircle, color: "text-red-400" },
};

export function ShotList({ selectedShotId, onSelect }: ShotListProps) {
  const project = useProjectStore((s) => s.getActiveProject());
  const shots = project?.shots ?? [];
  const removeShot = useProjectStore((s) => s.removeShot);
  const t = useT();

  if (shots.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <p className="text-xs text-slate-600 text-center">{t("pipeline.noShots")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 overflow-y-auto p-2">
      {shots.map((shot) => {
        const isSelected = shot.id === selectedShotId;
        const cfg = statusConfig[shot.status];
        const Icon = cfg.icon;

        return (
          <div
            key={shot.id}
            onClick={() => onSelect(shot.id)}
            className={`group flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 text-xs transition ${
              isSelected
                ? "border-emerald-600 bg-emerald-950/30 text-slate-100"
                : "border-transparent hover:bg-slate-800/60 text-slate-400 hover:text-slate-200"
            }`}
          >
            <GripVertical size={12} className="mt-0.5 shrink-0 text-slate-700" />
            <div className="h-10 w-14 shrink-0 overflow-hidden rounded border border-slate-700 bg-slate-800">
              {shot.imageUrl ? (
                <img src={shot.imageUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <ImageIcon size={12} className="text-slate-700" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <span className="font-medium text-slate-300">
                  {t("pipeline.shot")} {shot.index + 1}
                </span>
                <Icon size={11} className={cfg.color} />
              </div>
              <p className="mt-0.5 truncate text-[11px] text-slate-500">
                {shot.scriptText || shot.visualPrompt || "\u2014"}
              </p>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); removeShot(shot.id); }}
              className="mt-0.5 shrink-0 opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition"
              title={t("dialog.delete")}
            >
              <Trash2 size={11} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
