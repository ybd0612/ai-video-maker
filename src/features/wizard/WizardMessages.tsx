// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/WizardMessages.tsx
// 向导页统一的提示 / 错误块：四个页面此前各写一遍近似 markup，
// 导致同一语义在不同步骤下颜色与内距不一致。纯展示，无副作用。
// ────────────────────────────────────────────────────────────────────────────

import { AlertCircle, Info } from "lucide-react";

interface WizardMessagesProps {
  notice?: string | null;
  error?: string | null;
}

export function WizardMessages({ notice, error }: WizardMessagesProps) {
  if (!notice && !error) return null;
  return (
    <div className="flex flex-col gap-2">
      {notice ? (
        <p className="flex items-start gap-2 rounded-lg border border-info/40 bg-info/10 px-3 py-2 text-xs text-ink-2">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-info" />
          <span>{notice}</span>
        </p>
      ) : null}
      {error ? (
        <p className="flex items-start gap-2 rounded-lg border border-danger/50 bg-danger-deep/30 px-3 py-2 text-xs text-danger">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span className="break-words">{error}</span>
        </p>
      ) : null}
    </div>
  );
}
