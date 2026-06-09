import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Film, Loader2 } from "lucide-react";
import { useCanvasStore } from "@/stores/canvasStore";
import type { VideoNodeData } from "@/canvas/types";
import { NodeShell } from "./NodeShell";
import { useT } from "@/i18n";
import { NumberInput } from "@/components/ui/NumberInput";
import { calcNumFrames } from "@/lib/validation";

import { IMEAwareTextarea } from "@/components/ui/IMEAwareTextarea";

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
      <IMEAwareTextarea
        value={d.prompt}
        onChange={(v) => updateNodeData(id, { prompt: v } as Partial<VideoNodeData>)}
        placeholder={t("video.placeholder")}
        rows={3}
        className="w-full resize-none rounded-md border border-slate-700 bg-slate-800 p-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
      />
      {/* Negative prompt */}
      <IMEAwareTextarea
        value={String(d.negativePrompt ?? "")}
        onChange={(v) => updateNodeData(id, { negativePrompt: v } as Partial<VideoNodeData>)}
        placeholder={t("panel.negativePlaceholder")}
        rows={2}
        className="w-full resize-none rounded-md border border-slate-700/60 bg-slate-800/80 p-2 text-xs text-slate-400 placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
      />
      {/* Params — 2-col grid */}
      <div className="grid grid-cols-2 gap-x-2 gap-y-1">
        <div className="col-span-2">
          <label className="text-[11px] text-slate-500">{t("video.size")}</label>
          <select
            value={["1152x768","1280x720","720x1280","1024x1024","1792x1024","1024x1792","auto"].includes(d.size) ? d.size : "custom"}
            onChange={(e) => {
              if (e.target.value === "custom") {
                updateNodeData(id, { size: "1280x768" } as Partial<VideoNodeData>);
              } else {
                updateNodeData(id, { size: e.target.value } as Partial<VideoNodeData>);
              }
            }}
            className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-300 focus:border-amber-500 focus:outline-none"
          >
            <option value="1152x768">横屏 1152x768 (推荐)</option>
            <option value="1280x720">横屏 1280x720</option>
            <option value="720x1280">竖屏 720x1280</option>
            <option value="1024x1024">方形 1024x1024</option>
            <option value="1792x1024">宽屏 1792x1024</option>
            <option value="1024x1792">1024x1792</option>
            <option value="auto">Auto</option>
            <option value="custom">自定义尺寸</option>
          </select>
          {(() => {
            const presets = ["1152x768","1280x720","720x1280","1024x1024","1792x1024","1024x1792","auto"];
            if (presets.includes(d.size)) return null;
            const parts = d.size.split("x");
            const w = parts[0] ?? "";
            const h = parts[1] ?? "";
            return (
              <div className="flex items-center gap-1 mt-1">
                <input
                  type="number"
                  value={w}
                  min={1}
                  max={2048}
                  step={8}
                  onChange={(e) => updateNodeData(id, { size: `${e.target.value}x${h}` } as Partial<VideoNodeData>)}
                  className="w-1/2 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-300 focus:border-amber-500 focus:outline-none"
                  placeholder="宽"
                />
                <span className="text-xs text-slate-600">×</span>
                <input
                  type="number"
                  value={h}
                  min={1}
                  max={2048}
                  step={8}
                  onChange={(e) => updateNodeData(id, { size: `${w}x${e.target.value}` } as Partial<VideoNodeData>)}
                  className="w-1/2 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-300 focus:border-amber-500 focus:outline-none"
                  placeholder="高"
                />
              </div>
            );
          })()}
        </div>
        <div className="flex items-center gap-1">
          <label className="text-[11px] text-slate-500">{t("video.fps")}</label>
          <select
            value={d.fps}
            onChange={(e) => updateNodeData(id, { fps: parseInt(e.target.value) } as Partial<VideoNodeData>)}
            className="w-14 rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-xs text-slate-300 focus:border-amber-500 focus:outline-none"
          >
            <option value="24">24</option>
            <option value="30">30</option>
            <option value="60">60</option>
          </select>
        </div>
        <div className="flex items-center gap-1">
          <label className="text-[11px] text-slate-500">{t("video.duration")}</label>
          <select
            value={d.duration ?? 5}
            onChange={(e) => updateNodeData(id, { duration: parseFloat(e.target.value) } as Partial<VideoNodeData>)}
            className="w-14 rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-xs text-slate-300 focus:border-amber-500 focus:outline-none"
          >
            <option value="3">3s</option>
            <option value="5">5s</option>
            <option value="10">10s</option>
            <option value="18">18s</option>
          </select>
        </div>
        <div className="flex items-center gap-1">
          <label className="text-[11px] text-slate-500">{t("video.count")}</label>
          <select
            value={d.count}
            onChange={(e) => updateNodeData(id, { count: parseInt(e.target.value) } as Partial<VideoNodeData>)}
            className="w-14 rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-xs text-slate-300 focus:border-amber-500 focus:outline-none"
          >
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4</option>
            <option value="5">5</option>
          </select>
        </div>
        <div className="col-span-2 text-[11px] text-slate-500">
          {t("video.numFrames")}: {calcNumFrames(d.duration ?? 5, d.fps)}
        </div>
      </div>
      {/* Seed — lock/unlock toggle + dice button */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500">{t("panel.seed")}</label>
          <button
            onClick={() => {
              if (d.seed && d.seed > 0) {
                // Unlock -> random
                updateNodeData(id, { seed: undefined } as Partial<VideoNodeData>);
              } else {
                // Lock -> generate a random seed
                updateNodeData(id, { seed: Math.floor(Math.random() * 2147483647) } as Partial<VideoNodeData>);
              }
            }}
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition ${
              d.seed && d.seed > 0
                ? "bg-amber-600/30 text-amber-400 hover:bg-amber-600/50"
                : "bg-slate-700/50 text-slate-500 hover:bg-slate-700"
            }`}
            title={d.seed && d.seed > 0 ? t("video.seedUnlock") : t("video.seedLock")}
          >
            {d.seed && d.seed > 0 ? "🔒 " + t("video.seedLocked") : "🎲 " + t("video.seedRandom")}
          </button>
        </div>
        {d.seed && d.seed > 0 && (
          <div className="flex items-center gap-1">
            <NumberInput
              min={1}
              max={2147483647}
              value={d.seed}
              onChange={(v) => updateNodeData(id, { seed: v } as Partial<VideoNodeData>)}
              className="w-28 rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-xs text-slate-300 focus:border-amber-500 focus:outline-none"
            />
            <button
              onClick={() => updateNodeData(id, { seed: Math.floor(Math.random() * 2147483647) } as Partial<VideoNodeData>)}
              className="rounded p-1 text-slate-500 hover:bg-slate-700 hover:text-amber-400 transition"
              title={t("video.seedReroll")}
            >
              🎲
            </button>
          </div>
        )}
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
