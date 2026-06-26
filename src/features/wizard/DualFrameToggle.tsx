// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/DualFrameToggle.tsx
// 首尾帧控制开关：切换双图流模式并输入尾帧 URL。
// ────────────────────────────────────────────────────────────────────────────

import { useProjectStore, type Shot } from "@/stores/projectStore";
import { useT } from "@/i18n";
import { Film } from "lucide-react";

interface DualFrameToggleProps {
  shot: Shot;
}

export function DualFrameToggle({ shot }: DualFrameToggleProps) {
  const t = useT();
  const updateShot = useProjectStore((s) => s.updateShot);

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
