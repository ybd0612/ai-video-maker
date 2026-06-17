// ────────────────────────────────────────────────────────────────────────────
// src/features/preview/ShotPreview.tsx
// Center panel: preview image and video for the selected shot.
// ────────────────────────────────────────────────────────────────────────────

import { useProjectStore } from "@/stores/projectStore";
import { useT } from "@/i18n";
import { Lightbox } from "@/components/ui/Lightbox";
import { Image as ImageIcon, Film, Loader2 } from "lucide-react";

interface ShotPreviewProps {
  shotId: string | null;
}

export function ShotPreview({ shotId }: ShotPreviewProps) {
  const shot = useProjectStore((s) =>
    s.project?.shots.find((sh) => sh.id === shotId) ?? null,
  );
  const t = useT();

  if (!shot) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-2">
          <ImageIcon size={32} className="mx-auto text-slate-700" />
          <p className="text-xs text-slate-600">{t("pipeline.noShotSelected")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-6">
      {/* Shot header */}
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-slate-100">
          {t("pipeline.shot")} {shot.index + 1}
        </h2>
        <p className="text-sm text-slate-400">{shot.scriptText}</p>
      </div>

      {/* Image preview */}
      <div className="space-y-2">
        <h3 className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
          <ImageIcon size={12} className="text-violet-400" />
          {t("pipeline.referenceImage")}
        </h3>
        {shot.status === "imaging" ? (
          <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-violet-700 bg-violet-950/20">
            <div className="text-center space-y-2">
              <Loader2 size={20} className="mx-auto animate-spin text-violet-400" />
              <p className="text-xs text-violet-400">{t("pipeline.generatingImage")}</p>
            </div>
          </div>
        ) : shot.imageUrl ? (
          <Lightbox src={shot.imageUrl} alt={`Shot ${shot.index + 1}`}>
            <img
              src={shot.imageUrl}
              alt={`Shot ${shot.index + 1}`}
              className="max-h-64 w-full rounded-lg border border-slate-700 object-contain"
            />
          </Lightbox>
        ) : (
          <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-slate-700 bg-slate-800/30">
            <p className="text-xs text-slate-600">{t("pipeline.noImageYet")}</p>
          </div>
        )}
      </div>

      {/* Video preview */}
      <div className="space-y-2">
        <h3 className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
          <Film size={12} className="text-amber-400" />
          {t("pipeline.video")}
        </h3>
        {shot.status === "videoing" ? (
          <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-amber-700 bg-amber-950/20">
            <div className="text-center space-y-2">
              <Loader2 size={20} className="mx-auto animate-spin text-amber-400" />
              <p className="text-xs text-amber-400">{t("pipeline.generatingVideo")}</p>
            </div>
          </div>
        ) : shot.videoUrl ? (
          <video
            src={shot.videoUrl}
            controls
            loop
            className="max-h-64 w-full rounded-lg border border-slate-700"
          />
        ) : (
          <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-slate-700 bg-slate-800/30">
            <p className="text-xs text-slate-600">{t("pipeline.noVideoYet")}</p>
          </div>
        )}
      </div>
    </div>
  );
}

