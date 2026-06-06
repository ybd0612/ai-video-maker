// ────────────────────────────────────────────────────────────────────────────
// src/canvas/nodes/NodeShell.tsx
// Shared node chrome: header bar with icon/label/status, action buttons,
// error display, and consistent card styling.
// ────────────────────────────────────────────────────────────────────────────

import type { ReactNode } from "react";
import { Play, Trash2 } from "lucide-react";
import { useCanvasStore } from "@/stores/canvasStore";
import { useWorkflowRunner } from "@/canvas/hooks/useWorkflowRunner";
import { StatusBadge } from "./StatusBadge"
import { useT } from '@/i18n';;
import type { NodeExecutionStatus } from "@/canvas/types";
import type { LucideIcon } from "lucide-react";

interface NodeShellProps {
  nodeId: string;
  label: string;
  icon: LucideIcon;
  iconColor: string;
  borderColor: string;
  status: NodeExecutionStatus;
  errorMessage?: string;
  children: ReactNode;
  /** Show the single-node run button */
  runnable?: boolean;
}

export function NodeShell({
  nodeId,
  label,
  icon: Icon,
  iconColor,
  borderColor,
  status,
  errorMessage,
  children,
  runnable = true,
}: NodeShellProps) {
  const removeNode = useCanvasStore((s) => s.removeNode);
  const t = useT();
  const { run } = useWorkflowRunner();

  return (
    <div className={`w-72 rounded-xl border ${borderColor} bg-slate-900 shadow-2xl`}>
      {/* Header */}
      <div className="flex items-center gap-2 rounded-t-xl bg-slate-800 px-3 py-2">
        <Icon size={14} className={iconColor} />
        <span className="text-xs font-semibold text-slate-200 flex-1 truncate">
          {label || t("node.untitled")}
        </span>
        <StatusBadge status={status} />
        <div className="flex items-center gap-0.5 ml-1">
          {runnable && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                run({ startNodeId: nodeId });
              }}
              title={t("node.runTooltip")}
              className="rounded p-0.5 text-slate-500 transition hover:bg-slate-700 hover:text-emerald-400"
            >
              <Play size={11} />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              removeNode(nodeId);
            }}
            title={t("node.deleteTooltip")}
            className="rounded p-0.5 text-slate-500 transition hover:bg-slate-700 hover:text-red-400"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="space-y-2 p-3">
        {children}
        {errorMessage && (
          <div className="rounded-md border border-red-800/50 bg-red-950/30 p-2">
            <p className="text-xs leading-tight text-red-400">{errorMessage}</p>
          </div>
        )}
      </div>
    </div>
  );
}
