// ────────────────────────────────────────────────────────────────────────────
// src/features/preview/ShotPreview.tsx
// Center panel: preview image and video for the selected shot.
// ────────────────────────────────────────────────────────────────────────────

import { useProjectStore, selectActiveProject } from "@/stores/projectStore";
import { useT } from "@/i18n";
import { Lightbox } from "@/components/ui/Lightbox";
import { Image as ImageIcon, Film, Loader2, AlertCircle } from "lucide-react";

interface ShotPreviewProps {
  shotId: string | null;
}

export function ShotPreview({ shotId }: ShotPreviewProps) {
  const project = useProjectStore(selectActiveProject);
  const shot = project?.shots.find((sh) => sh.id === shotId) ?? null;
  const t = useT();

  if (!shot) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-2">
          <ImageIcon size={32} className="mx-auto text-ink-5" />
          <p className="text-xs text-ink-5">{t("pipeline.noShotSelected")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-6">
      {/* Shot header */}
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-ink">
          {t("pipeline.shot")} {shot.index + 1}
        </h2>
        <p className="text-sm text-ink-3">{shot.scriptText}</p>
      </div>

      {/* Image preview */}
      <div className="space-y-2">
        <h3 className="flex items-center gap-1.5 text-xs font-medium text-ink-4">
          <ImageIcon size={12} className="text-accent" />
          {t("pipeline.referenceImage")}
        </h3>
        {shot.status === "imaging" ? (
          <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-accent bg-accent-deep/20">
            <div className="text-center space-y-2">
              <Loader2 size={20} className="mx-auto animate-spin text-accent" />
              <p className="text-xs text-accent">{t("pipeline.generatingImage")}</p>
            </div>
          </div>
        ) : shot.imageUrl ? (
          <Lightbox src={shot.imageUrl} alt={`Shot ${shot.index + 1}`}>
            <img
              src={shot.imageUrl}
              alt={`Shot ${shot.index + 1}`}
              className="max-h-64 w-full rounded-lg border border-line object-contain"
            />
          </Lightbox>
        ) : (
          <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-line bg-raised/30">
            <p className="text-xs text-ink-5">{t("pipeline.noImageYet")}</p>
          </div>
        )}
      </div>

      {/* Video preview */}
      <div className="space-y-2">
        <h3 className="flex items-center gap-1.5 text-xs font-medium text-ink-4">
          <Film size={12} className="text-warn" />
          {t("pipeline.video")}
        </h3>
        {shot.status === "videoing" ? (
          <div className="space-y-2 rounded-lg border border-dashed border-warn bg-warn-deep/20 p-4">
            <div className="flex items-center gap-2">
              <Loader2 size={14} className="animate-spin text-warn" />
              <span className="text-xs text-warn">
                {(shot.videoRetryCount ?? 0) > 0
                  ? t("pipeline.retryVideo", { count: String(shot.videoRetryCount), max: "3" })
                  : (shot.videoProgress ?? 0) > 0
                    ? `${shot.videoProgress}%`
                    : t("pipeline.generatingVideo")}
              </span>
            </div>
            {(shot.videoProgress ?? 0) > 0 && (
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-raised">
                <div
                  className="h-full rounded-full bg-warn-solid transition-all duration-500"
                  style={{ width: `${shot.videoProgress}%` }}
                />
              </div>
            )}
          </div>
        ) : shot.videoUrl ? (
          <video
            src={shot.videoUrl}
            controls
            loop
            className="max-h-64 w-full rounded-lg border border-line"
          />
        ) : shot.status === "failed" ? (
          <div className="flex h-32 items-center justify-center rounded-lg border border-danger bg-danger-deep/20">
            <div className="text-center space-y-1">
              <AlertCircle size={18} className="mx-auto text-danger" />
              <p className="text-xs text-danger">{shot.error || t("pipeline.failed")}</p>
            </div>
          </div>
        ) : (
          <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-line bg-raised/30">
            <p className="text-xs text-ink-5">{t("pipeline.noVideoYet")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
