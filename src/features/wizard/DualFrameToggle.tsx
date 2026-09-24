// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/DualFrameToggle.tsx
// 首尾帧控制开关：切换双图流模式并输入尾帧 URL。
// ────────────────────────────────────────────────────────────────────────────

import { useProjectStore, selectActiveProject, type Shot } from "@/stores/projectStore";
import { useT } from "@/i18n";
import { Film } from "lucide-react";
import { Lightbox } from "@/components/ui/Lightbox";
import { MEDIA_FRAME, resolveAspect } from "@/lib/mediaLayout";

interface DualFrameToggleProps {
  shot: Shot;
}

export function DualFrameToggle({ shot }: DualFrameToggleProps) {
  const t = useT();
  const updateShot = useProjectStore((s) => s.updateShot);
  const project = useProjectStore(selectActiveProject);
  const aspect = resolveAspect(project?.aspectRatio);

  // 其他已生成图片的分镜，供用户点选作为尾帧
  const candidateFrames = (project?.shots ?? []).filter(
    (s) => s.id !== shot.id && !!s.imageUrl,
  );

  return (
    <div className="space-y-2">
      {/* 双图流开关 */}
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={shot.useDualFrame}
          onChange={(e) =>
            updateShot(shot.id, {
              useDualFrame: e.target.checked,
              // 关闭时清除尾帧，避免脏数据残留
              ...(e.target.checked ? {} : { lastFrameUrl: undefined }),
            })
          }
          className="h-3.5 w-3.5 rounded border-line-strong bg-raised text-warn focus:ring-warn focus:ring-offset-0"
        />
        <span className="flex items-center gap-1 text-[0.6875rem] text-ink-3">
          <Film className="h-3 w-3 text-warn" />
          {t("wizard.useDualFrame")}
        </span>
      </label>

      {/* 尾帧 URL 输入框（仅在双图流开启时显示） */}
      {shot.useDualFrame && (
        <div className="space-y-1">
          {/* 从其他分镜图中点选尾帧 */}
          {candidateFrames.length > 0 && (
            <div className="space-y-1">
              <label className="text-[0.6875rem] font-medium text-ink-4">
                {t("wizard.pickLastFrame")}
              </label>
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {candidateFrames.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => updateShot(shot.id, { lastFrameUrl: s.imageUrl })}
                    className={`shrink-0 overflow-hidden rounded border transition ${
                      MEDIA_FRAME.detailSecondary[aspect].containerClass
                    } ${
                      shot.lastFrameUrl === s.imageUrl
                        ? "border-warn ring-1 ring-warn"
                        : "border-line hover:border-line-strong"
                    }`}
                    title={`Shot ${s.index + 1}`}
                  >
                    <img
                      src={s.imageUrl}
                      alt={`Shot ${s.index + 1}`}
                      className={MEDIA_FRAME.detailSecondary[aspect].mediaClass}
                    />
                  </button>
                ))}
              </div>
            </div>
          )}

          <label className="text-[0.6875rem] font-medium text-ink-4">
            {t("wizard.lastFrameUrl")}
          </label>
          <input
            type="text"
            value={shot.lastFrameUrl ?? ""}
            onChange={(e) =>
              updateShot(shot.id, { lastFrameUrl: e.target.value || undefined })
            }
            placeholder={t("wizard.lastFrameUrlPlaceholder")}
            className="w-full rounded-md border border-line bg-raised p-2 text-xs text-ink placeholder:text-ink-5 focus:border-warn focus:outline-none"
          />
          {/* 尾帧预览（点击放大查看） */}
          {shot.lastFrameUrl && (
            <div className={`mt-1 overflow-hidden rounded border border-line ${MEDIA_FRAME.detailSecondary[aspect].containerClass}`}>
              <Lightbox src={shot.lastFrameUrl} alt={t("wizard.lastFrameUrl")}>
                <img
                  src={shot.lastFrameUrl}
                  alt={t("wizard.lastFrameUrl")}
                  className={MEDIA_FRAME.detailSecondary[aspect].mediaClass}
                />
              </Lightbox>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
