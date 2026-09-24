// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/StepHeader.tsx
// 向导步骤页页头：标题 + 完成计数 + 右侧动作槽。三页此前各写一遍，
// 字号 / 间距 / 按钮排布都不一致，分镜页还误用了「资产」的标题键。
// ────────────────────────────────────────────────────────────────────────────

import type { ReactNode } from "react";
import { useT, type TranslationKey } from "@/i18n";

interface StepHeaderProps {
  titleKey: TranslationKey;
  done?: number;
  total?: number;
  actions?: ReactNode;
}

export function StepHeader({ titleKey, done, total, actions }: StepHeaderProps) {
  const t = useT();
  const showCounter = typeof done === "number" && typeof total === "number" && total > 0;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <h2 className="text-sm font-bold text-ink">
        {t(titleKey)}
        {showCounter ? <span className="ml-1 font-normal text-ink-4">({done}/{total})</span> : null}
      </h2>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
