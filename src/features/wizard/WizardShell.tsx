// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/WizardShell.tsx
// 向导双栏骨架：页头 + 左轨 + 详情（详情底部可挂动作区）。
// 滚动权仍只在 CreationWizard 那一层 overflow-y-auto 之下发生：这里把轨与详情
// 各自切成有界滚动区，页面整体不再产生超长滚动。
// ⚠ 各步骤页必须继续在**步骤组件内部**渲染本组件，不得改成路由级子组件：
// 重挂载会让依赖 [shots.length] 的自动生成 effect 再跑一次（会烧配额）。
// ────────────────────────────────────────────────────────────────────────────

import type { ReactNode } from "react";
import { SHELL_CONTAINER_CLASS } from "@/lib/mediaLayout";

interface WizardShellProps {
  header: ReactNode;
  rail: ReactNode;
  detail: ReactNode;
  detailActions?: ReactNode;
}

export function WizardShell({ header, rail, detail, detailActions }: WizardShellProps) {
  return (
    <div className={`${SHELL_CONTAINER_CLASS} h-full`}>
      {header}
      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <div className="w-full shrink-0 overflow-y-auto pr-1 lg:w-[15.5rem]">{rail}</div>
        <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto pb-2">
          {detail}
          {detailActions ? <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">{detailActions}</div> : null}
        </div>
      </div>
    </div>
  );
}
