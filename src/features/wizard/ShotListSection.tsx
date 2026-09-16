// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/ShotListSection.tsx
// 分镜列表分区（步骤 3 专用，2026-09-16 列表卡化）：
// 状态徽标 + 序号 + 一句话摘要 + 引用资产数 → 整卡点击进入镜头详情。
// 与资产列表（AssetListSection）同一视觉语言，但分镜阶段没有图片，
// 因此不套用「图片预览 + 名称」的资产卡结构。
// ────────────────────────────────────────────────────────────────────────────

import type { Shot } from "@/stores/projectStore";
import { useT } from "@/i18n";
import { Plus, Trash2 } from "lucide-react";
import { shotStatusInfo } from "./shotStatus";

export interface ShotListSectionProps {
  shots: Shot[];
  emptyHint: string;
  addLabel: string;
  deleteLabel: string;
  /** 整卡点击进入详情 */
  onOpen: (shot: Shot) => void;
  /** 删除（确认逻辑由父级负责；此处已 stopPropagation） */
  onDelete: (shot: Shot) => void;
  onAdd: () => void;
}

export function ShotListSection({
  shots,
  emptyHint,
  addLabel,
  deleteLabel,
  onOpen,
  onDelete,
  onAdd,
}: ShotListSectionProps) {
  const t = useT();

  return (
    <section className="flex flex-col gap-3">
      {shots.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {shots.map((shot) => {
            const summary =
              shot.scriptText.trim().slice(0, 60) ||
              shot.visualPrompt.trim().slice(0, 40) ||
              t("wizard.promptSubject");
            const referenceCount =
              shot.activeCharacterIds.length +
              (shot.activeSceneId ? 1 : 0) +
              shot.activeProductIds.length +
              shot.activePropIds.length;
            const statusInfo = shotStatusInfo(shot.status);
            const StatusIcon = statusInfo.icon;

            return (
              <div
                key={shot.id}
                role="button"
                tabIndex={0}
                onClick={() => onOpen(shot)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpen(shot);
                  }
                }}
                title={t("shotList.openHint")}
                className="group relative cursor-pointer rounded-xl border border-line bg-raised/50 p-2.5 transition hover:border-line-strong focus:border-accent focus:outline-none"
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-raised text-[0.625rem] font-bold text-ink-3">
                    {shot.index + 1}
                  </span>
                  <StatusIcon size={12} className={`shrink-0 ${statusInfo.color}`} />
                  <span className="flex-1 truncate text-[0.6875rem] text-ink-5">
                    {t("pipeline.duration")} {shot.duration}s
                  </span>
                  <span className="shrink-0 text-[0.625rem] text-ink-5">
                    {t("shotList.referenceCount", { count: referenceCount })}
                  </span>
                </div>

                <p className="mt-1.5 line-clamp-2 pr-6 text-sm text-ink">{summary}</p>

                {shot.error && (
                  <p className="mt-0.5 truncate text-[0.625rem] text-danger" title={shot.error}>
                    {shot.error}
                  </p>
                )}

                {/* 删除（阻止冒泡，避免同时触发「进入详情」） */}
                <div
                  className="absolute right-2 top-2 flex shrink-0 gap-1 opacity-0 transition group-hover:opacity-100"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => onDelete(shot)}
                    className="rounded p-1.5 text-ink-4 hover:bg-danger-deep hover:text-danger"
                    title={deleteLabel}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <p className="text-xs text-ink-5">{emptyHint}</p>
        </div>
      )}

      <button
        onClick={onAdd}
        className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong bg-raised/30 px-4 py-2.5 text-xs text-ink-3 transition hover:border-success hover:text-success"
      >
        <Plus size={14} />
        {addLabel}
      </button>
    </section>
  );
}
