// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/ReviewCheckpoint.tsx
// 审核卡点：semi-auto/manual 模式下图片生成完成后需确认才进入视频阶段
// ────────────────────────────────────────────────────────────────────────────

import { useT } from "@/i18n";
import type { AutomationMode } from "@/stores/projectStore";
import { getQuotaUsageSnapshot } from "@/services/rateLimit";
import { RefreshCw } from "lucide-react";

interface FailedShotInfo {
  index: number;
  error?: string;
}

interface ReviewCheckpointProps {
  mode: AutomationMode;
  onConfirm: () => void;
  /** 生成失败的镜头（>0 时显示警告；失败镜头将不会生成视频） */
  failedShots?: FailedShotInfo[];
  /** 重试失败镜头的入口（通常指向批量生成函数） */
  onRetryFailed?: () => void;
}

export function ReviewCheckpoint({ mode, onConfirm, failedShots = [], onRetryFailed }: ReviewCheckpointProps) {
  const t = useT();

  // 全自动模式下自动跳过审核
  if (mode === "auto") {
    return null;
  }

  const quota = getQuotaUsageSnapshot();

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-6">
      <h3 className="text-lg font-semibold text-slate-100">
        {t("review.qualityCheck")}
      </h3>
      <p className="mt-2 text-sm text-slate-400">
        {t("review.hint")}
      </p>

      {failedShots.length > 0 && (
        <div className="mt-2 rounded-lg border border-amber-800 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
          <p>{t("review.someFailed", { count: failedShots.length })}</p>
          <p className="mt-1 text-amber-400/80">
            {t("review.failedShotList", { shots: failedShots.map((s) => `#${s.index + 1}`).join("、") })}
          </p>
          {failedShots.some((s) => s.error) && (
            <ul className="mt-1 space-y-0.5">
              {failedShots.filter((s) => s.error).map((s) => (
                <li key={s.index} className="truncate text-[0.6875rem] text-red-300/80" title={s.error}>
                  #{s.index + 1}: {s.error}
                </li>
              ))}
            </ul>
          )}
          {onRetryFailed && (
            <button
              onClick={onRetryFailed}
              className="mt-2 flex items-center gap-1 rounded px-2 py-1 text-[0.6875rem] text-red-400 hover:bg-red-950/40 transition"
            >
              <RefreshCw size={11} />
              {t("review.retryFailedShots")}
            </button>
          )}
        </div>
      )}

      {quota && (
        <p className="mt-2 text-[0.6875rem] text-slate-500">
          {t("review.quotaUsage", {
            imageUsed: quota.imageUsed,
            imageLimit: quota.imageLimit,
            videoUsed: quota.videoUsed,
            videoLimit: quota.videoLimit,
          })}
        </p>
      )}

      <div className="mt-4">
        <button
          onClick={onConfirm}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500"
        >
          {t("review.confirmImages")}
        </button>
      </div>
    </div>
  );
}
