import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Type } from "lucide-react";
import { useCanvasStore } from "@/stores/canvasStore";
import type { TextNodeData } from "@/canvas/types";
import { NodeShell } from "./NodeShell";
import { useT } from "@/i18n";
import { NumberInput } from "@/components/ui/NumberInput";
import { sanitizePrompt } from "@/lib/validation";
import { HelpTooltip } from "@/components/ui/HelpTooltip";

function TextNodeInner({ id, data }: NodeProps) {
  const d = data as unknown as TextNodeData;
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const t = useT();

  return (
    <NodeShell
      nodeId={id}
      label={d.label}
      icon={Type}
      iconColor="text-sky-400"
      borderColor="border-sky-800/60"
      status={d.executionStatus}
      errorMessage={d.errorMessage}
      errorKey={d.errorKey}
      errorParams={d.errorParams}
    >
      {/* Fixed model label */}
      <div className="rounded border border-slate-700/50 bg-slate-800/50 px-2 py-1 text-xs text-slate-500">
        {t("text.model")}: agnes-2.0-flash
      </div>
      <textarea
        value={d.prompt}
        onChange={(e) =>
          updateNodeData(id, { prompt: e.target.value } as Partial<TextNodeData>)
        }
        onBlur={(e) => updateNodeData(id, { prompt: sanitizePrompt(e.target.value) } as Partial<TextNodeData>)}
        placeholder={t("text.placeholder")}
        rows={3}
        className="w-full resize-none rounded-md border border-slate-700 bg-slate-800 p-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
      />
      {/* Parameters row */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-slate-500">{t("text.temp")} <HelpTooltip>{t("hint.temperature")}</HelpTooltip></label>
        <NumberInput
          min={0}
          max={2}
          step={0.1}
          value={d.temperature}
          onChange={(v) => updateNodeData(id, { temperature: v } as Partial<TextNodeData>)}
          className="w-14 rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-xs text-slate-300 focus:border-sky-500 focus:outline-none"
        />
        <label className="text-xs text-slate-500">{t("text.maxTokens")} <HelpTooltip>{t("hint.maxTokens")}</HelpTooltip></label>
        <NumberInput
          min={1}
          max={8192}
          value={d.maxTokens}
          onChange={(v) => updateNodeData(id, { maxTokens: v } as Partial<TextNodeData>)}
          className="w-16 rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-xs text-slate-300 focus:border-sky-500 focus:outline-none"
        />
      </div>
      {/* Output */}
      {d.output && (
        <div className="max-h-32 overflow-y-auto rounded-md border border-slate-700 bg-slate-800/50 p-2">
          <p className="whitespace-pre-wrap text-xs text-slate-300">{d.output}</p>
        </div>
      )}
      <Handle type="target" position={Position.Left} id="text-in" className="!h-3 !w-3 !bg-sky-500" />
      <Handle type="source" position={Position.Right} id="text-out" className="!h-3 !w-3 !bg-sky-500" />
    </NodeShell>
  );
}

export const TextNode = memo(TextNodeInner);
