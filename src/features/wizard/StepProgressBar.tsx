// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/StepProgressBar.tsx
// 步骤级完成度条。颜色语义固定为 accent：这里表达「本步完成度」，
// 不是「正在跑」—— 镜头级"生成中"的警示色留给卡内的 videoProgress。
// 历史上图片步用 accent、视频步用 warn 表示同一件事，用户读成两件事。
// ────────────────────────────────────────────────────────────────────────────

interface StepProgressBarProps {
  done: number;
  total: number;
}

export function StepProgressBar({ done, total }: StepProgressBarProps) {
  if (total <= 0) return null;
  const pct = Math.min(100, Math.round((done / total) * 100));
  return (
    <div
      className="h-1 w-full overflow-hidden rounded-full bg-raised"
      role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
    >
      <div
        className="h-full rounded-full bg-accent-solid transition-all duration-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
