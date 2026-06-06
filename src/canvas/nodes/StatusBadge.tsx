import { Loader2, CheckCircle2, XCircle, Circle } from "lucide-react";
import type { NodeExecutionStatus } from "@/canvas/types";
import { useT, type TranslationKey } from "@/i18n";

const config: Record<
  NodeExecutionStatus,
  { icon: typeof Circle; color: string; labelKey: TranslationKey; bg: string }
> = {
  idle: { icon: Circle, color: "text-slate-500", labelKey: "node.idle", bg: "bg-slate-800" },
  pending: { icon: Loader2, color: "text-amber-400", labelKey: "node.running", bg: "bg-amber-950/50" },
  success: { icon: CheckCircle2, color: "text-emerald-400", labelKey: "node.done", bg: "bg-emerald-950/50" },
  failed: { icon: XCircle, color: "text-red-400", labelKey: "node.failed", bg: "bg-red-950/50" },
};

export function StatusBadge({ status }: { status: NodeExecutionStatus }) {
  const t = useT();
  const { icon: Icon, color, labelKey, bg } = config[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 ${bg} ${color}`}>
      <Icon size={10} className={status === "pending" ? "animate-spin" : ""} />
      <span className="text-[11px] font-medium">{t(labelKey)}</span>
    </span>
  );
}
