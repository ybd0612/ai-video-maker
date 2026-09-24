// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/WizardRail.tsx
// 镜头轨：唯一职责是"在镜头之间选一个来看"。
// 不渲染详情内容；不自己算待办（pendingIds 由页面用 lib/shotQueue 传入，
// 保证轨上徽标与批量按钮是同一口径）。
// ⚠ 本组件及其祖先不得加 transform / filter —— Lightbox 依赖 body 级 fixed 基准。
// ⚠ 状态色串（shotStatusInfo().color）本身已含 animate-spin，不得再补一次。
// ────────────────────────────────────────────────────────────────────────────

import type { ReactNode } from "react";
import { useT } from "@/i18n";
import { MEDIA_FRAME, resolveAspect } from "@/lib/mediaLayout";
import { moveSelection } from "@/lib/railSelection";
import { shotSizeLabelKey } from "@/lib/shotDisplay";
import { shotStatusInfo } from "./shotStatus";
import type { AspectRatio } from "@/stores/projectTypes";
import type { Shot } from "@/stores/projectStore";

interface WizardRailProps {
  shots: Shot[];
  currentId?: string;
  onSelect(id: string): void;
  aspect?: AspectRatio;
  /** storyboard 模式常无出图：用序号占位，不留空白格 */
  mode: "storyboard" | "image" | "video";
  pendingIds?: readonly string[];
  compact: boolean;
  onToggleCompact(): void;
  /** 轨底部挂的页面级入口（如分镜页「手动添加镜头」），轨本身不解释其语义 */
  footer?: ReactNode;
}

export function WizardRail({
  shots, currentId, onSelect, aspect = "16:9", mode, pendingIds = [], compact, onToggleCompact, footer,
}: WizardRailProps) {
  const t = useT();
  const frame = MEDIA_FRAME.railThumb[resolveAspect(aspect)];
  const ids = shots.map((s) => s.id);

  return (
    <div
      className="flex flex-col gap-2"
      role="listbox"
      aria-label={t("rail.ariaLabel")}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        e.preventDefault();
        const next = moveSelection(ids, currentId, e.key === "ArrowDown" ? 1 : -1);
        if (next) onSelect(next);
      }}
    >
      <button
        type="button"
        onClick={onToggleCompact}
        className="self-start rounded-md border border-line-soft px-2 py-1 text-[0.625rem] text-ink-4 hover:bg-hover"
      >
        {compact ? t("rail.expand") : t("rail.compact")}
      </button>

      <div className={compact ? "flex flex-col gap-1" : "grid grid-cols-2 gap-2"}>
        {shots.map((shot) => {
          const selected = shot.id === currentId;
          const status = shotStatusInfo(shot.status);
          const pending = pendingIds.includes(shot.id);
          const StatusIcon = status.icon;
          return (
            <button
              key={shot.id}
              type="button"
              role="option"
              aria-selected={selected}
              title={shot.scriptText || t("pipeline.shot")}
              onClick={() => onSelect(shot.id)}
              className={[
                "flex flex-col gap-1 rounded-lg border p-1 text-left transition",
                selected
                  ? "border-accent bg-accent-deep/30 ring-1 ring-accent"
                  : "border-line-soft bg-surface hover:border-line-strong",
              ].join(" ")}
            >
              <span className="flex items-center justify-between px-0.5 text-[0.625rem] text-ink-4">
                <span>{String(shot.index + 1).padStart(2, "0")}</span>
                <span className={status.color}>
                  <StatusIcon size={11} />
                </span>
              </span>

              {compact ? null : (
                <span className={`block overflow-hidden rounded-md border border-line-soft ${frame.containerClass}`}>
                  {shot.imageUrl ? (
                    <img src={shot.imageUrl} alt="" loading="lazy" className={frame.mediaClass} />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center bg-raised/40 px-1 text-center text-[0.625rem] text-ink-4">
                      {mode === "storyboard" ? t("rail.noImageYet") : t("rail.noImage")}
                    </span>
                  )}
                </span>
              )}

              <span className="flex items-center justify-between gap-1 px-0.5 text-[0.625rem] text-ink-3">
                <span>{t(shotSizeLabelKey(shot.shotSize))}</span>
                {pending ? <span className="h-1.5 w-1.5 rounded-full bg-warn" title={t("rail.pending")} /> : null}
              </span>
            </button>
          );
        })}
      </div>

      {footer}
    </div>
  );
}
