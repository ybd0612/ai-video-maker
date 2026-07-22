// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/ReviewCheckpoint.tsx
// 审核卡点：semi-auto/manual 模式下图片生成完成后需确认才进入视频阶段
// ────────────────────────────────────────────────────────────────────────────

import { useT } from "@/i18n";
import type { AutomationMode } from "@/stores/projectStore";

interface ReviewCheckpointProps {
  mode: AutomationMode;
  onConfirm: () => void;
  onSkip: () => void;
  /** 生成失败的图片数量（>0 时显示警告，失败项将在视频阶段被跳过） */
  failedCount?: number;
}

export function ReviewCheckpoint({ mode, onConfirm, onSkip, failedCount = 0 }: ReviewCheckpointProps) {
  const t = useT();

  // 全自动模式下自动跳过审核
  if (mode === "auto") {
    return null;
  }

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-6">
      <h3 className="text-lg font-semibold text-slate-100">
        {t("review.qualityCheck")}
      </h3>
      <p className="mt-2 text-sm text-slate-400">
        {t("review.hint")}
      </p>

      {failedCount > 0 && (
        <p className="mt-2 rounded-lg border border-amber-800 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
          {t("review.someFailed", { count: failedCount })}
        </p>
      )}

      <div className="mt-4 flex gap-3">
        <button
          onClick={onConfirm}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500"
        >
          {t("review.confirmImages")}
        </button>

        {mode === "manual" && (
          <button
            onClick={onSkip}
            className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-600"
          >
            {t("review.skipReview")}
          </button>
        )}
      </div>
    </div>
  );
}
