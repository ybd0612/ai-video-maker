import { memo, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ImageIcon, Link, Unlink } from "lucide-react";
import { useCanvasStore } from "@/stores/canvasStore";
import type { ImageNodeData } from "@/canvas/types";
import type { AnyNodeData } from "@/canvas/types";
import { NodeShell } from "./NodeShell"
import { useT } from '@/i18n';;
import { sanitizePrompt, isValidUrl } from "@/lib/validation";

const SIZE_OPTIONS = ["512x512", "768x768", "1024x1024", "1024x1792", "1792x1024"];

function ImageNodeInner({ id, data }: NodeProps) {
  const d = data as unknown as ImageNodeData;
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const t = useT();

  // Find connected upstream image via edges (image-in handle)
  const connectedImageEdge = edges.find(
    (e) => e.target === id && e.targetHandle === "image-in"
  );
  const upstreamImageUrl = connectedImageEdge
    ? (() => {
        const srcNode = nodes.find((n) => n.id === connectedImageEdge.source);
        if (!srcNode) return undefined;
        const srcData = srcNode.data as unknown as AnyNodeData;
        return "outputUrl" in srcData ? (srcData as ImageNodeData).outputUrl : undefined;
      })()
    : undefined;

  // Effective input: connected upstream takes priority over manual URL
  const effectiveInputUrl = upstreamImageUrl ?? d.inputImageUrl;
  const hasInputImage = !!effectiveInputUrl;

  return (
    <NodeShell
      nodeId={id}
      label={d.label}
      icon={ImageIcon}
      iconColor="text-violet-400"
      borderColor={hasInputImage ? "border-violet-500/80" : "border-violet-800/60"}
      status={d.executionStatus}
      errorMessage={d.errorMessage}
    >
      {/* Fixed model label */}
      <div className="rounded border border-slate-700/50 bg-slate-800/50 px-2 py-1 text-xs text-slate-500">
        {t("image.model")}: agnes-image-2.1-flash
        {hasInputImage && (
          <span className="ml-2 text-violet-400">+ {t("image.img2img")}</span>
        )}
      </div>

      {/* Input image preview */}
      {hasInputImage ? (
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-xs text-violet-400">
            {upstreamImageUrl ? <Link size={10} /> : <Link size={10} />}
            <span>{upstreamImageUrl ? t("image.connectedInput") : t("image.manualInput")}</span>
            {upstreamImageUrl && (
              <button
                onClick={() => {}}
                className="ml-auto text-slate-500 hover:text-slate-300"
                title={t("image.disconnectTooltip")}
              >
                <Unlink size={10} />
              </button>
            )}
          </div>
          <img
            src={effectiveInputUrl}
            alt="Input reference"
            className="max-h-24 w-full rounded-md border border-violet-800/40 object-contain"
          />
        </div>
      ) : null}

      {/* Manual input image URL (only when not connected upstream) */}
      {!upstreamImageUrl && (
        <div>
          <button
            onClick={() => setShowUrlInput(!showUrlInput)}
            className="text-xs text-slate-500 hover:text-violet-400 transition"
          >
            {showUrlInput ? t("image.hideInput") : t("image.showInput")} (img2img)
          </button>
          {showUrlInput && (
            <input
              type="text"
              value={d.inputImageUrl ?? ""}
              onChange={(e) =>
                updateNodeData(id, { inputImageUrl: e.target.value || undefined } as Partial<ImageNodeData>)
              }
              onBlur={(e) => { const v = e.target.value.trim(); if (v && !isValidUrl(v)) { e.target.value = ""; updateNodeData(id, { inputImageUrl: undefined } as Partial<ImageNodeData>); } }}
              placeholder="https://example.com/image.png"
              className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-300 placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
            />
          )}
        </div>
      )}

      <textarea
        value={d.prompt}
        onChange={(e) =>
          updateNodeData(id, { prompt: e.target.value } as Partial<ImageNodeData>)
        }
        onBlur={(e) => updateNodeData(id, { prompt: sanitizePrompt(e.target.value) } as Partial<ImageNodeData>)}
        placeholder={hasInputImage ? t("image.img2imgPlaceholder") : t("image.placeholder")}
        rows={3}
        className="w-full resize-none rounded-md border border-slate-700 bg-slate-800 p-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-violet-500 focus:outline-none"
      />

      {/* Size selector */}
      <select
        value={d.size}
        onChange={(e) => updateNodeData(id, { size: e.target.value } as Partial<ImageNodeData>)}
        className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-300 focus:border-violet-500 focus:outline-none"
      >
        {SIZE_OPTIONS.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>

      {/* Output */}
      {d.outputUrl ? (
        <div className="space-y-1">
          <span className="text-xs text-slate-500">{t("image.output")}</span>
          <img
            src={d.outputUrl}
            alt="Generated"
            className="max-h-40 w-full rounded-md border border-slate-700 object-contain"
          />
        </div>
      ) : d.executionStatus === "pending" ? (
        <div className="flex h-24 items-center justify-center rounded-md border border-dashed border-slate-700">
          <span className="text-xs text-slate-500">{t("image.generating")}</span>
        </div>
      ) : null}

      <Handle type="target" position={Position.Left} id="text-in" className="!h-3 !w-3 !bg-sky-500" />
      <Handle type="target" position={Position.Left} id="image-in" className="!-mt-4 !h-3 !w-3 !bg-violet-500" />
      <Handle type="source" position={Position.Right} id="image-out" className="!h-3 !w-3 !bg-violet-500" />
    </NodeShell>
  );
}

export const ImageNode = memo(ImageNodeInner);
