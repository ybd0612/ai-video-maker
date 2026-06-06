import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { MessageSquare } from "lucide-react";
import { useCanvasStore } from "@/stores/canvasStore";
import type { PromptNodeData } from "@/canvas/types";
import { NodeShell } from "./NodeShell"
import { useT } from '@/i18n';;
import { sanitizePrompt } from "@/lib/validation";

function PromptNodeInner({ id, data }: NodeProps) {
  const d = data as unknown as PromptNodeData;
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const t = useT();

  return (
    <NodeShell
      nodeId={id}
      label={d.label}
      icon={MessageSquare}
      iconColor="text-emerald-400"
      borderColor="border-emerald-800/60"
      status={d.executionStatus}
      errorMessage={d.errorMessage}
      runnable={false}
    >
      <textarea
        value={d.prompt}
        onChange={(e) =>
          updateNodeData(id, { prompt: e.target.value } as Partial<PromptNodeData>)
        }
        onBlur={(e) => updateNodeData(id, { prompt: sanitizePrompt(e.target.value) } as Partial<PromptNodeData>)}
        placeholder={t("prompt.placeholder")}
        rows={4}
        className="w-full resize-none rounded-md border border-slate-700 bg-slate-800 p-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
      />
      <Handle type="source" position={Position.Right} id="prompt-out" className="!h-3 !w-3 !bg-emerald-500" />
    </NodeShell>
  );
}

export const PromptNode = memo(PromptNodeInner);
