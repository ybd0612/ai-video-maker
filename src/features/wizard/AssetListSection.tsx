// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/AssetListSection.tsx
// 资产列表通用分区（角色/场景/产品/道具共用一套模板，2026-09-15 列表区模板化）：
// 标题（+可选副标题）→ 双列卡片网格（图片预览 + 名称/摘要/错误 + 悬停删除）→ 添加按钮。
// 差异通过 props 注入（图片来源/摘要/未命名文案/图标），不再各自复制结构。
// ────────────────────────────────────────────────────────────────────────────

import type { Asset } from "@/stores/projectStore";
import { useT } from "@/i18n";
import { ImageIcon, Plus, Trash2, UserPlus } from "lucide-react";
import { Lightbox } from "@/components/ui/Lightbox";

export interface AssetListSectionProps {
  /** 已含数量的标题 */
  title: string;
  /** 可选副标题（hint） */
  hint?: string;
  assets: Asset[];
  emptyHint: string;
  addLabel: string;
  /** 添加按钮图标与语义（角色用 UserPlus，其余用 Plus） */
  addIcon?: "plus" | "userPlus";
  onAdd: () => void;
  /** 整卡点击进入详情 */
  onOpen: (asset: Asset) => void;
  /** 删除（确认逻辑由父级处理；组件内部已 stopPropagation） */
  onDelete: (asset: Asset) => void;
  deleteLabel: string;
  /** 图片来源（角色有 avatarUrl 兜底，其余取 imageUrl） */
  imageOf: (asset: Asset) => string | undefined;
  /** 显示名兜底（如 "未命名场景"） */
  unnamedLabel: string;
  /** 一句话摘要（首行） */
  summaryOf: (asset: Asset) => string;
  /** 生成错误（存在时在卡片内显示） */
  errorOf?: (asset: Asset) => string | undefined;
}

export function AssetListSection({
  title,
  hint,
  assets,
  emptyHint,
  addLabel,
  addIcon = "plus",
  onAdd,
  onOpen,
  onDelete,
  deleteLabel,
  imageOf,
  unnamedLabel,
  summaryOf,
  errorOf,
}: AssetListSectionProps) {
  const t = useT();
  const AddIcon = addIcon === "userPlus" ? UserPlus : Plus;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-ink-2">
            {title} ({assets.length})
          </h3>
          {hint && <p className="text-[0.6875rem] text-ink-5 mt-0.5">{hint}</p>}
        </div>
      </div>

      {assets.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {assets.map((asset) => {
            const img = imageOf(asset);
            const error = errorOf?.(asset);
            return (
              <div
                key={asset.id}
                role="button"
                tabIndex={0}
                onClick={() => onOpen(asset)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpen(asset);
                  }
                }}
                title={t("characters.edit")}
                className="group relative flex cursor-pointer items-center gap-3 overflow-hidden rounded-xl border border-line bg-raised/50 p-2.5 transition hover:border-line-strong focus:border-accent focus:outline-none"
              >
                {/* 图片预览（点击放大查看，不触发卡片进入详情） */}
                <div
                  className="relative flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-app"
                  onClick={(e) => e.stopPropagation()}
                >
                  {img ? (
                    <Lightbox src={img} alt={asset.name}>
                      <img src={img} alt={asset.name} className="h-full w-full object-contain" />
                    </Lightbox>
                  ) : addIcon === "userPlus" ? (
                    <div className="flex h-full w-full items-center justify-center text-sm text-ink-4">
                      {asset.name.charAt(0).toUpperCase()}
                    </div>
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-ink-5">
                      <ImageIcon size={16} />
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1 py-1 pr-1">
                  <p className="text-sm font-medium text-ink">{asset.name || unnamedLabel}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-ink-4">{summaryOf(asset)}</p>
                  {error && (
                    <p className="mt-0.5 truncate text-[0.625rem] text-danger" title={error}>
                      {t("assetEditor.generateFailedWith", { message: error })}
                    </p>
                  )}
                </div>

                {/* 删除（阻止冒泡，避免同时触发「进入详情」） */}
                <div
                  className="absolute right-2 top-2 flex shrink-0 gap-1 opacity-0 transition group-hover:opacity-100"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => onDelete(asset)}
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
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <ImageIcon size={24} className="text-ink-5" />
          <p className="text-xs text-ink-5">{emptyHint}</p>
        </div>
      )}

      <button
        onClick={onAdd}
        className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong bg-raised/30 px-4 py-2.5 text-xs text-ink-3 transition hover:border-success hover:text-success"
      >
        <AddIcon size={14} />
        {addLabel}
      </button>
    </section>
  );
}
