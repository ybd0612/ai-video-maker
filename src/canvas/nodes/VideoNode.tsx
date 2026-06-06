import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Film, Loader2 } from "lucide-react";
import { useCanvasStore } from "@/stores/canvasStore";
import type { VideoNodeData } from "@/canvas/types";
import { NodeShell } from "./NodeShell";
import { useT } from "@/i18n";
import { NumberInput } from "@/components/ui/NumberInput";
import { sanitizePrompt } from "@/lib/validation";
import { HelpTooltip } from "@/components/ui/HelpTooltip";

function VideoNodeInner({ id, data }: NodeProps) {
  const d = data as unknown as VideoNodeData;
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const t = useT();

  return (
    <NodeShell
      nodeId={id}
      label={d.label}
      icon={Film}
      iconColor="text-amber-400"
      borderColor="border-amber-800/60"
      status={d.executionStatus}
      errorMessage={d.errorMessage}
      errorKey={d.errorKey}
      errorParams={d.errorParams}
    >
      {/* Fixed model label */}
      <div className="rounded border border-slate-700/50 bg-slate-800/50 px-2 py-1 text-xs text-slate-500">
        {t("video.model")}: agnes-video-v2.0
      </div>
      <textarea
        value={d.prompt}
        onChange={(e) =>
          updateNodeData(id, { prompt: e.target.value } as Partial<VideoNodeData>)
        }
        onBlur={(e) => updateNodeData(id, { prompt: sanitizePrompt(e.target.value) } as Partial<VideoNodeData>)}
        placeholder={t("video.placeholder")}
        rows={3}
        className="w-full resize-none rounded-md border border-slate-700 bg-slate-800 p-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
      />
      {/* Negative prompt */}
      <textarea
        value={String(d.negativePrompt ?? "")}
        onChange={(e) =>
          updateNodeData(id, { negativePrompt: e.target.value } as Partial<VideoNodeData>)
        }
        placeholder={t("panel.negativePlaceholder")}
        rows={2}
        className="w-full resize-none rounded-md border border-slate-700/60 bg-slate-800/80 p-2 text-xs text-slate-400 placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
      />
      {/* Params — 2-col grid */}
      <div className="grid grid-cols-2 gap-x-2 gap-y-1">
        <div className="flex items-center gap-1">
          <label className="text-[11px] text-slate-500">{t("video.width")}</label>
          <NumberInput min={256} max={1920} step={64} value={d.width}
            onChange={(v) => updateNodeData(id, { width: v } as Partial<VideoNodeData>)}
            className="w-14 rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-xs text-slate-300 focus:border-amber-500 focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-1">
          <label className="text-[11px] text-slate-500">{t("video.height")}</label>
          <NumberInput min={256} max={1920} step={64} value={d.height}
            onChange={(v) => updateNodeData(id, { height: v } as Partial<VideoNodeData>)}
            className="w-14 rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-xs text-slate-300 focus:border-amber-500 focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-1">
          <label className="text-[11px] text-slate-500">{t("video.fps")}</label>
          <NumberInput min={1} max={60} value={d.fps}
            onChange={(v) => updateNodeData(id, { fps: v } as Partial<VideoNodeData>)}
            className="w-14 rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-xs text-slate-300 focus:border-amber-500 focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-1">
          <label className="text-[11px] text-slate-500">{t("video.duration")}</label>
          <NumberInput min={1} max={30} step={0.5} value={d.duration ?? 5}
            onChange={(v) => updateNodeData(id, { duration: v } as Partial<VideoNodeData>)}
            className="w-14 rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-xs text-slate-300 focus:border-amber-500 focus:outline-none"
          />
        </div>
      </div>
      {/* Seed */}
      <div className="flex items-center gap-1">
        <label className="text-xs text-slate-500">{t("panel.seed")} <HelpTooltip>{t("hint.seedVideo")}</HelpTooltip></label>
        <NumberInput
          min={0}
          max={2147483647}
          value={d.seed ?? 0}
          onChange={(v) => updateNodeData(id, { seed: v } as Partial<VideoNodeData>)}
          className="w-24 rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-xs text-slate-300 focus:border-amber-500 focus:outline-none"
        />
      </div>
      {/* Progress bar */}
      {d.executionStatus === "pending" && (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Loader2 size={12} className="animate-spin text-amber-400" />
            <span className="text-xs text-slate-400">
              {d.taskProgress > 0 ? `${d.taskProgress}%` : t("video.creatingTask")}
            </span>
          </div>
          {d.taskProgress > 0 && (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-amber-500 transition-all duration-500"
                style={{ width: `${d.taskProgress}%` }}
              />
            </div>
          )}
        </div>
      )}
      {d.outputUrl && (
        <video
          src={d.outputUrl}
          controls
          loop
          className="max-h-40 w-full rounded-md border border-slate-700"
        />
      )}
      <Handle type="target" position={Position.Left} id="text-in" className="!h-3 !w-3 !bg-sky-500" />
      <Handle type="target" position={Position.Left} id="image-in" className="!-mt-4 !h-3 !w-3 !bg-violet-500" />
      <Handle type="target" position={Position.Left} id="video-in" className="!-mt-8 !h-3 !w-3 !bg-amber-500" />
      <Handle type="source" position={Position.Right} id="video-out" className="!h-3 !w-3 !bg-amber-500" />
    </NodeShell>
  );
}

export const VideoNode = memo(VideoNodeInner);
