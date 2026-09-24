// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/ReviewCheckpoint.tsx
// 审核卡点：semi-auto/manual 模式下图片生成完成后需确认才进入视频阶段
// ────────────────────────────────────────────────────────────────────────────

import type { ReactNode } from "react";
import { useT, type TranslationKey } from "@/i18n";
import type { AutomationMode } from "@/stores/projectStore";
import { getQuotaUsageSnapshot } from "@/services/rateLimit";
import { RefreshCw, Loader2 } from "lucide-react";

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
  /** 三页原本各写一份中文：标题 / 提示 / 确认按钮的文案键 */
  titleKey?: TranslationKey;
  hintKey?: TranslationKey;
  confirmLabelKey?: TranslationKey;
  /** 自定义禁用条件：分镜要的是"脚本与画面提示词齐备"，与图片步的 allSettled 不同 */
  confirmDisabled?: boolean;
  /** 确认动作正在进行（资产页要转圈并换按钮文案，避免重复触发分镜生成） */
  confirmPending?: boolean;
  confirmPendingLabelKey?: TranslationKey;
  /** 卡内按钮之后的附加说明 / 错误行 */
  footer?: ReactNode;
}

export function ReviewCheckpoint({
  mode, onConfirm, failedShots = [], onRetryFailed,
  titleKey, hintKey, confirmLabelKey, confirmDisabled = false,
  confirmPending = false, confirmPendingLabelKey, footer,
}: ReviewCheckpointProps) {
  const t = useT();

  // 全自动模式下自动跳过审核
  if (mode === "auto") {
    return null;
  }

  const quota = getQuotaUsageSnapshot();

  return (
    <div className="rounded-xl border border-line bg-raised/50 p-6">
      <h3 className="text-lg font-semibold text-ink">
        {t(titleKey ?? "review.qualityCheck")}
      </h3>
      <p className="mt-2 text-sm text-ink-3">
        {t(hintKey ?? "review.hint")}
      </p>

      {failedShots.length > 0 && (
        <div className="mt-2 rounded-lg border border-warn bg-warn-deep/30 px-3 py-2 text-xs text-warn">
          <p>{t("review.someFailed", { count: failedShots.length })}</p>
          <p className="mt-1 text-warn/80">
            {t("review.failedShotList", { shots: failedShots.map((s) => `#${s.index + 1}`).join("、") })}
          </p>
          {failedShots.some((s) => s.error) && (
            <ul className="mt-1 space-y-0.5">
              {failedShots.filter((s) => s.error).map((s) => (
                <li key={s.index} className="truncate text-[0.6875rem] text-danger/80" title={s.error}>
                  #{s.index + 1}: {s.error}
                </li>
              ))}
            </ul>
          )}
          {onRetryFailed && (
            <button
              onClick={onRetryFailed}
              className="mt-2 flex items-center gap-1 rounded px-2 py-1 text-[0.6875rem] text-danger hover:bg-danger-deep/40 transition"
            >
              <RefreshCw size={11} />
              {t("review.retryFailedShots")}
            </button>
          )}
        </div>
      )}

      {quota && (
        <p className="mt-2 text-[0.6875rem] text-ink-4">
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
          disabled={failedShots.length > 0 || confirmDisabled}
          className="flex items-center gap-1.5 rounded-lg bg-success-solid px-4 py-2 text-sm font-medium text-white transition hover:bg-success-solid disabled:cursor-not-allowed disabled:opacity-50"
        >
          {confirmPending && <Loader2 size={12} className="animate-spin" />}
          {t(confirmPending && confirmPendingLabelKey ? confirmPendingLabelKey : (confirmLabelKey ?? "review.confirmImages"))}
        </button>
      </div>

      {footer}
    </div>
  );
}
