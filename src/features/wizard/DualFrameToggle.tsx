// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/DualFrameToggle.tsx
// 首尾帧控制开关：切换双图流模式并输入尾帧 URL。
// ────────────────────────────────────────────────────────────────────────────

import { useProjectStore, selectActiveProject, type Shot } from "@/stores/projectStore";
import { useT } from "@/i18n";
import { Film } from "lucide-react";

interface DualFrameToggleProps {
  shot: Shot;
}

export function DualFrameToggle({ shot }: DualFrameToggleProps) {
  const t = useT();
  const updateShot = useProjectStore((s) => s.updateShot);
  const project = useProjectStore(selectActiveProject);

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
          className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-800 text-amber-500 focus:ring-amber-500 focus:ring-offset-0"
        />
        <span className="flex items-center gap-1 text-[11px] text-slate-400">
          <Film size={11} className="text-amber-400" />
          {t("wizard.useDualFrame")}
        </span>
      </label>

      {/* 尾帧 URL 输入框（仅在双图流开启时显示） */}
      {shot.useDualFrame && (
        <div className="space-y-1">
          {/* 从其他分镜图中点选尾帧 */}
          {candidateFrames.length > 0 && (
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-slate-500">
                {t("wizard.pickLastFrame")}
              </label>
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {candidateFrames.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => updateShot(shot.id, { lastFrameUrl: s.imageUrl })}
                    className={`shrink-0 overflow-hidden rounded border transition ${
                      shot.lastFrameUrl === s.imageUrl
                        ? "border-amber-500 ring-1 ring-amber-500"
                        : "border-slate-700 hover:border-slate-500"
                    }`}
                    title={`Shot ${s.index + 1}`}
                  >
                    <img
                      src={s.imageUrl}
                      alt={`Shot ${s.index + 1}`}
                      className="h-12 w-20 object-cover"
                    />
                  </button>
                ))}
              </div>
            </div>
          )}

          <label className="text-[11px] font-medium text-slate-500">
            {t("wizard.lastFrameUrl")}
          </label>
          <input
            type="text"
            value={shot.lastFrameUrl ?? ""}
            onChange={(e) =>
              updateShot(shot.id, { lastFrameUrl: e.target.value || undefined })
            }
            placeholder={t("wizard.lastFrameUrlPlaceholder")}
            className="w-full rounded-md border border-slate-700 bg-slate-800 p-2 text-xs text-slate-100 placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
          />
          {/* 尾帧预览 */}
          {shot.lastFrameUrl && (
            <div className="mt-1 overflow-hidden rounded border border-slate-700 w-20 h-14">
              <img
                src={shot.lastFrameUrl}
                alt="Last frame preview"
                className="h-full w-full object-cover"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
