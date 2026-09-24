// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/AssetEditorTemplate.tsx
// 资产详情编辑统一模板：角色 / 场景 / 核心主体 / 关键物件 / 视觉方向共用同一套结构。
//
//   左列：名称 → 一句话简介 → 完整设定 → 提示词 → AI 指令行
//   右列：参考图 → 生成按钮 → 「编辑后自动生成」开关
//   底部：取消 / 保存
//
// 模板只渲染结构，不决定任何文案（文案由调用方经 i18n 传入）。
// ────────────────────────────────────────────────────────────────────────────

import type { ReactNode } from "react";
import { ArrowLeft, ImageIcon, Loader2, Sparkles, Undo2 } from "lucide-react";

/* ── 外壳：返回行 + 左列(3) / 右列(2) + 底部 ─────────────────────────────── */

export interface AssetDetailShellProps {
  title: string;
  backLabel: string;
  onBack: () => void;
  backDisabled?: boolean;
  children: ReactNode;
  preview: ReactNode;
  footer: ReactNode;
}

export function AssetDetailShell({
  title,
  backLabel,
  onBack,
  backDisabled = false,
  children,
  preview,
  footer,
}: AssetDetailShellProps) {
  return (
    <div className="@container flex flex-col gap-3 p-3">
      <button
        type="button"
        onClick={onBack}
        disabled={backDisabled}
        title={backLabel}
        className="flex w-fit items-center gap-2 rounded p-1 text-xs font-medium text-ink-2 transition hover:bg-raised disabled:opacity-50"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        <span>{title}</span>
      </button>

      <div className="flex flex-col gap-3 @md:flex-row @md:items-stretch">
        <div className="min-w-0 flex-1 space-y-3 @md:flex-[3_1_0%]">{children}</div>
        <div className="flex flex-col gap-1 @md:flex-[2_1_0%]">{preview}</div>
      </div>

      {footer}
    </div>
  );
}

/** 统一 16:9 预览框 */
export function AssetPreviewFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg border border-line bg-app">
      {children}
    </div>
  );
}

/* ── 左列区块 ───────────────────────────────────────────────────────────── */

function BlockLabel({ children }: { children: ReactNode }) {
  return <label className="text-[0.6875rem] font-medium text-ink-4">{children}</label>;
}

/** 名称（可编辑输入） */
export function AssetNameField({
  label,
  value,
  placeholder,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <BlockLabel>{label}</BlockLabel>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full rounded-md border border-line bg-raised px-2 py-1.5 text-xs text-ink placeholder:text-ink-5 focus:border-accent focus:outline-none disabled:opacity-50"
      />
    </div>
  );
}

/** 一句话简介（只读，AI 维护） */
export function AssetSummaryBlock({
  label,
  summary,
  emptyHint,
}: {
  label: string;
  summary: string;
  emptyHint: string;
}) {
  const text = summary.trim();
  return (
    <div className="space-y-1">
      <BlockLabel>{label}</BlockLabel>
      <div className="w-full rounded-md border border-line bg-raised px-2 py-1.5 text-xs leading-relaxed text-ink select-text">
        {text || <span className="text-ink-5">{emptyHint}</span>}
      </div>
    </div>
  );
}

/** 完整设定：结构化字段行；无字段时回落整段文本 */
export function AssetDetailsBlock({
  label,
  fields,
  rawText,
  emptyHint,
  // 中文标签最长 8 字（"镜头中的使用方式"）：w-28 在 112.5% 整体缩放下约 126px，8 字不换行；
  // 各编辑器统一走默认宽度，禁止再各自传窄值（此前 w-14/w-16 导致 7 字标签换行）
  labelWidth = "w-28",
}: {
  label: string;
  fields: Array<{ label: string; value: string }>;
  rawText?: string;
  emptyHint: string;
  labelWidth?: string;
}) {
  const hasFields = fields.length > 0;
  const fallback = (rawText ?? "").trim();
  return (
    <div className="space-y-2 rounded-md border border-line-soft bg-surface p-2">
      <BlockLabel>{label}</BlockLabel>
      {hasFields ? (
        <div className="space-y-1.5 rounded-md border border-line bg-raised px-2 py-1.5 text-xs leading-relaxed">
          {fields.map(({ label: fieldLabel, value }) => (
            <div key={fieldLabel} className="flex gap-2">
              <span className={`${labelWidth} shrink-0 font-medium text-ink-3`}>{fieldLabel}</span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap text-ink select-text">
                {value?.trim() || "—"}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="whitespace-pre-wrap rounded-md border border-line bg-raised px-2 py-1.5 text-xs leading-relaxed text-ink select-text">
          {fallback || <span className="text-ink-5">{emptyHint}</span>}
        </div>
      )}
    </div>
  );
}

/** 提示词（只读，AI 派生物）+ 维护说明 */
export function AssetPromptBlock({
  label,
  prompt,
  hint,
  emptyHint,
}: {
  label: string;
  prompt: string;
  hint?: string;
  emptyHint: string;
}) {
  const text = prompt.trim();
  return (
    <div className="space-y-1">
      <BlockLabel>{label}</BlockLabel>
      <div className="whitespace-pre-wrap rounded-md border border-line bg-raised px-2 py-1.5 text-xs leading-relaxed text-ink-2 select-text">
        {text || <span className="text-ink-5">{emptyHint}</span>}
      </div>
      {hint && <p className="text-[0.625rem] text-ink-5">{hint}</p>}
    </div>
  );
}

/** AI 指令行：输入框 + 交给 AI 修改 + 撤销 */
export function AssetInstructionRow({
  instruction,
  onInstructionChange,
  onApply,
  applying,
  canApply,
  applyLabel,
  applyingLabel,
  placeholder,
  onUndo,
  undoLabel,
  disabled,
}: {
  instruction: string;
  onInstructionChange: (value: string) => void;
  onApply: () => void;
  applying: boolean;
  canApply: boolean;
  applyLabel: string;
  applyingLabel: string;
  placeholder: string;
  onUndo?: () => void;
  undoLabel?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="text"
        value={instruction}
        onChange={(e) => onInstructionChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onApply();
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        className="min-w-0 flex-1 rounded-md border border-line bg-raised px-2 py-1.5 text-xs text-ink placeholder:text-ink-5 focus:border-accent focus:outline-none disabled:opacity-50"
      />
      <button
        type="button"
        onClick={onApply}
        disabled={!canApply || disabled}
        title={applyLabel}
        className="flex shrink-0 items-center gap-1 rounded-md bg-accent px-2 py-1.5 text-[0.6875rem] font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {applying ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Sparkles className="h-2.5 w-2.5" />}
        {applying ? applyingLabel : applyLabel}
      </button>
      {onUndo && (
        <button
          type="button"
          onClick={onUndo}
          disabled={disabled}
          title={undoLabel}
          className="shrink-0 rounded-md border border-line px-2 py-1.5 text-[0.6875rem] text-ink-3 transition hover:bg-raised disabled:opacity-50"
        >
          <Undo2 className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

/* ── 右列：预览 + 生成 ──────────────────────────────────────────────────── */

export function AssetPreviewColumn({
  label,
  imageUrl,
  alt,
  generating,
  onGenerate,
  generateLabel,
  generateDisabled,
  generateTitle,
  autoRegenerate,
  generatingHint,
  onOpenLightbox,
}: {
  label: string;
  imageUrl?: string;
  alt: string;
  generating: boolean;
  onGenerate: () => void;
  generateLabel: string;
  generateDisabled?: boolean;
  generateTitle?: string;
  autoRegenerate?: {
    checked: boolean;
    onChange: (checked: boolean) => void;
    label: string;
    disabled?: boolean;
  };
  generatingHint?: string;
  onOpenLightbox?: (src: string, alt: string) => ReactNode;
}) {
  const frame = imageUrl ? (
    <AssetPreviewFrame>
      <img src={imageUrl} alt={alt} className="h-full w-full object-contain" />
    </AssetPreviewFrame>
  ) : (
    <AssetPreviewFrame>
      <ImageIcon className="h-6 w-6 text-ink-5" />
    </AssetPreviewFrame>
  );

  return (
    <>
      <BlockLabel>{label}</BlockLabel>
      {imageUrl && onOpenLightbox ? onOpenLightbox(imageUrl, alt) : frame}
      <button
        type="button"
        onClick={onGenerate}
        disabled={generateDisabled ?? generating}
        title={generateTitle}
        className="flex w-full shrink-0 items-center justify-center gap-1 rounded border border-line px-1.5 py-1 text-[0.625rem] text-accent transition hover:bg-accent-deep/30 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {generating ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <ImageIcon className="h-2.5 w-2.5" />}
        {generateLabel}
      </button>
      {generating && generatingHint && (
        <p className="shrink-0 animate-pulse text-[0.625rem] text-accent">{generatingHint}</p>
      )}
      {autoRegenerate && (
        <label
          className={`flex shrink-0 select-none items-center gap-1.5 text-[0.625rem] text-ink-3 ${
            autoRegenerate.disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
          }`}
        >
          <input
            type="checkbox"
            checked={autoRegenerate.checked}
            disabled={autoRegenerate.disabled}
            onChange={(e) => autoRegenerate.onChange(e.target.checked)}
            className="h-3 w-3 accent-accent"
          />
          {autoRegenerate.label}
        </label>
      )}
    </>
  );
}

/* ── 底部 ───────────────────────────────────────────────────────────────── */

export function AssetEditorFooter({
  cancelLabel,
  onCancel,
  cancelDisabled,
  saveLabel,
  onSave,
  saveDisabled,
  saving,
}: {
  cancelLabel: string;
  onCancel: () => void;
  cancelDisabled?: boolean;
  saveLabel: string;
  onSave: () => void;
  saveDisabled?: boolean;
  saving?: boolean;
}) {
  return (
    <div className="mt-1 flex justify-end gap-2 border-t border-line-soft pt-3">
      <button
        type="button"
        onClick={onCancel}
        disabled={cancelDisabled}
        className="rounded-md border border-line px-3 py-1.5 text-xs text-ink-3 hover:bg-raised disabled:opacity-50"
      >
        {cancelLabel}
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={saveDisabled}
        className="flex items-center gap-1 rounded-md bg-accent-solid px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving && <Loader2 className="h-3 w-3 animate-spin" />}
        {saveLabel}
      </button>
    </div>
  );
}

/** 底部提示/错误区（统一样式） */
export function AssetEditorMessages({
  notice,
  error,
}: {
  notice?: string | null;
  error?: string | null;
}) {
  if (!notice && !error) return null;
  return (
    <div className="space-y-1">
      {notice && (
        <div className="rounded-md border border-warn bg-warn-deep/30 p-2 text-[0.6875rem] text-warn">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-md border border-danger bg-danger-deep/30 p-2 text-[0.6875rem] text-danger">
          {error}
        </div>
      )}
    </div>
  );
}
