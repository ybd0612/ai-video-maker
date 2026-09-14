import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

interface AssetDetailLayoutProps {
  title: string;
  onBack: () => void;
  backDisabled?: boolean;
  children: ReactNode;
  preview: ReactNode;
  footer: ReactNode;
}

/** Shared two-column shell for asset detail editors. Preview uses a stable 16:9 frame. */
export function AssetDetailLayout({
  title,
  onBack,
  backDisabled = false,
  children,
  preview,
  footer,
}: AssetDetailLayoutProps) {
  return (
    <div className="@container flex flex-col gap-3 p-3">
      <button
        type="button"
        onClick={onBack}
        disabled={backDisabled}
        className="flex w-fit items-center gap-2 rounded p-1 text-xs font-medium text-ink-2 transition hover:bg-raised disabled:opacity-50"
        title="返回"
      >
        <ArrowLeft size={14} />
        <span>{title}</span>
      </button>

      <div className="flex flex-col gap-4 @md:flex-row @md:items-stretch">
        <div className="min-w-0 flex-1 @md:w-3/5">{children}</div>
        <div className="flex min-w-0 flex-1 flex-col gap-2 @md:w-2/5">{preview}</div>
      </div>

      {footer}
    </div>
  );
}

export function AssetPreviewFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg border border-line bg-raised">
      {children}
    </div>
  );
}
