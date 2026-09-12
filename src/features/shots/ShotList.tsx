// ────────────────────────────────────────────────────────────────────────────
// src/features/shots/ShotList.tsx
// Left panel: list of shots with status badges and selection.
// ────────────────────────────────────────────────────────────────────────────

import { useProjectStore, selectActiveProject, type ShotStatus } from "@/stores/projectStore";
import { useT } from "@/i18n";
import {
  Image as ImageIcon,
  Film,
  AlertCircle,
  Loader2,
  Hash,
  Trash2,
} from "lucide-react";
import { confirmDialog } from "@/components/ui/ConfirmDialog";

interface ShotListProps {
  selectedShotId: string | null;
  onSelect: (shotId: string) => void;
}

const statusConfig: Record<ShotStatus, { icon: typeof Hash; color: string }> = {
  idle:      { icon: Hash,        color: "text-ink-5" },
  scripting: { icon: Loader2,     color: "text-info animate-spin" },
  scripted:  { icon: Hash,        color: "text-info" },
  imaging:   { icon: Loader2,     color: "text-accent animate-spin" },
  imaged:    { icon: ImageIcon,   color: "text-accent" },
  videoing:  { icon: Loader2,     color: "text-warn animate-spin" },
  videoed:   { icon: Film,        color: "text-warn" },
  failed:    { icon: AlertCircle, color: "text-danger" },
};

export function ShotList({ selectedShotId, onSelect }: ShotListProps) {
  const project = useProjectStore(selectActiveProject);
  const shots = project?.shots ?? [];
  const removeShot = useProjectStore((s) => s.removeShot);
  const t = useT();

  if (shots.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <p className="text-xs text-ink-5 text-center">{t("pipeline.noShots")}</p>
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
                ? "border-success bg-success-deep/30 text-ink"
                : "border-transparent hover:bg-raised/60 text-ink-3 hover:text-ink"
            }`}
          >
            <div className="h-10 w-14 shrink-0 overflow-hidden rounded border border-line bg-raised">
              {shot.imageUrl ? (
                <img src={shot.imageUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <ImageIcon size={12} className="text-ink-5" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <span className="font-medium text-white">
                  {t("pipeline.shot")} {shot.index + 1}
                </span>
                <Icon size={11} className={cfg.color} />
              </div>
              <p className="mt-0.5 truncate text-[0.6875rem] text-ink-4">
                {shot.scriptText || shot.visualPrompt || "\u2014"}
              </p>
            </div>
            <button
              onClick={async (e) => {
                e.stopPropagation();
                const ok = await confirmDialog({
                  title: t("dialog.delete"),
                  message: `${t("pipeline.shot")} ${shot.index + 1}`,
                  confirmLabel: t("dialog.confirm"),
                  variant: "danger",
                });
                if (ok) removeShot(shot.id);
              }}
              className="mt-0.5 shrink-0 opacity-0 group-hover:opacity-100 text-ink-5 hover:text-danger transition"
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
