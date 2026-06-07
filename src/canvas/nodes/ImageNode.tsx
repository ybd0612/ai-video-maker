import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ImageIcon, Link, Images } from "lucide-react";
import { useCanvasStore } from "@/stores/canvasStore";
import type { ImageNodeData } from "@/canvas/types";
import type { AnyNodeData } from "@/canvas/types";
import { NodeShell } from "./NodeShell";
import { useT } from '@/i18n';
import { HelpTooltip } from "@/components/ui/HelpTooltip";
import { Lightbox } from "@/components/ui/Lightbox";
import { IMEAwareTextarea } from "@/components/ui/IMEAwareTextarea";

function ImageNodeInner({ id, data }: NodeProps) {
  const d = data as unknown as ImageNodeData;
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const t = useT();

  // Find connected upstream image via edges (image-in handle)
  const connectedImageEdge = edges.find(
    (e) => e.target === id && e.targetHandle === "image-in"
  );
  const upstreamImageUrl: string | undefined = connectedImageEdge
    ? (() => {
        const srcNode = nodes.find((n) => n.id === connectedImageEdge.source);
        if (!srcNode) return undefined;
        const srcData = srcNode.data as unknown as AnyNodeData;
        return "outputUrl" in srcData ? (srcData as ImageNodeData).outputUrl as string | undefined : undefined;
      })()
    : undefined;

  const hasInputImage = !!upstreamImageUrl;

  // Collect all images from other image nodes in the canvas
  const canvasGalleryImages: string[] = [];
  for (const n of nodes) {
    if (n.id === id || n.type !== "image") continue;
    const nd = n.data as unknown as ImageNodeData;
    if (nd.outputUrls) canvasGalleryImages.push(...nd.outputUrls);
    else if (nd.outputUrl) canvasGalleryImages.push(nd.outputUrl);
  }

  return (
    <NodeShell
      nodeId={id}
      label={d.label}
      icon={ImageIcon}
      iconColor="text-violet-400"
      borderColor={hasInputImage ? "border-violet-500/80" : "border-violet-800/60"}
      status={d.executionStatus}
      errorMessage={d.errorMessage}
      errorKey={d.errorKey}
      errorParams={d.errorParams}
    >
      {/* Fixed model label */}
      <div className="rounded border border-slate-700/50 bg-slate-800/50 px-2 py-1 text-xs text-slate-500">
        {t("image.model")}: agnes-image-2.1-flash
        {hasInputImage && (
          <span className="ml-2 text-violet-400">+ {t("image.img2img")}</span>
        )}
      </div>

      {/* Input image preview from connected upstream node */}
      {hasInputImage && (
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-xs text-violet-400">
            <Link size={10} />
            <span>{t("image.connectedInput")}</span>
          </div>
          <Lightbox src={upstreamImageUrl!} alt="Input reference">
            <img
              src={upstreamImageUrl!}
              alt="Input reference"
              className="max-h-24 w-full rounded-md border border-violet-800/40 object-contain"
            />
          </Lightbox>
        </div>
      )}

      {/* Canvas image gallery — pick from other image nodes */}
      {!hasInputImage && canvasGalleryImages.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-xs text-slate-500">
            <Images size={10} />
            <span>{t("image.selectFromCanvas")}</span>
          </div>
          <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
            {canvasGalleryImages.map((url, i) => (
              <button
                key={i}
                onClick={() => updateNodeData(id, { referenceImageUrl: d.referenceImageUrl === url ? undefined : url } as Partial<ImageNodeData>)}
                className={`h-10 w-10 flex-shrink-0 overflow-hidden rounded border transition ${d.referenceImageUrl === url ? "border-violet-400 ring-1 ring-violet-400" : "border-slate-700 hover:border-slate-500"}`}
              >
                <img src={url} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Show selected reference image */}
      {d.referenceImageUrl && !hasInputImage && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-violet-400">{t("image.selectedReference")}</span>
            <button
              onClick={() => updateNodeData(id, { referenceImageUrl: undefined } as Partial<ImageNodeData>)}
              className="text-xs text-slate-500 hover:text-red-400"
            >
              {t("image.clearReference")}
            </button>
          </div>
          <Lightbox src={d.referenceImageUrl} alt="Reference">
            <img
              src={d.referenceImageUrl}
              alt="Reference"
              className="max-h-20 w-full rounded-md border border-violet-800/40 object-contain"
            />
          </Lightbox>
        </div>
      )}

      <IMEAwareTextarea
        value={d.prompt}
        onChange={(v) => updateNodeData(id, { prompt: v } as Partial<ImageNodeData>)}
        placeholder={(hasInputImage || d.referenceImageUrl) ? t("image.img2imgPlaceholder") : t("image.placeholder")}
        rows={3}
        className="w-full resize-none rounded-md border border-slate-700 bg-slate-800 p-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-violet-500 focus:outline-none"
      />

      {/* Size selector */}
      <div className="flex items-center gap-1 text-xs text-slate-500">{t("panel.imageSize")} <HelpTooltip>{t("hint.imageSize")}</HelpTooltip></div>
      <select
        value={d.size}
        onChange={(e) => updateNodeData(id, { size: e.target.value } as Partial<ImageNodeData>)}
        className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-300 focus:border-violet-500 focus:outline-none"
      >
        <option value="576x1024">9:16 (576x1024)</option>
        <option value="648x1152">9:16 (648x1152)</option>
        <option value="682x1024">2:3 (682x1024)</option>
        <option value="768x1024">3:4 (768x1024)</option>
        <option value="864x1536">9:16 (864x1536)</option>
        <option value="1024x1024">1:1 (1024x1024)</option>
        <option value="1024x768">4:3 (1024x768)</option>
        <option value="1024x682">3:2 (1024x682)</option>
        <option value="1024x576">16:9 (1024x576)</option>
        <option value="1152x648">16:9 (1152x648)</option>
        <option value="1536x864">16:9 (1536x864)</option>
        <option value="auto">Auto</option>
      </select>

      {/* Count selector */}
      <div className="flex items-center gap-1 text-xs text-slate-500">{t("panel.imageCount")} <HelpTooltip>{t("hint.imageCount")}</HelpTooltip></div>
      <select
        value={d.count}
        onChange={(e) => updateNodeData(id, { count: parseInt(e.target.value) } as Partial<ImageNodeData>)}
        className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-300 focus:border-violet-500 focus:outline-none"
      >
        <option value="1">1</option>
        <option value="2">2</option>
        <option value="3">3</option>
        <option value="4">4</option>
        <option value="5">5</option>
        <option value="6">6</option>
        <option value="7">7</option>
        <option value="8">8</option>
        <option value="9">9</option>
        <option value="10">10</option>
      </select>

      {/* Output */}
      {d.outputUrls && d.outputUrls.length > 0 ? (
        <div className="space-y-1">
          <span className="text-xs text-slate-500">{t("image.output")}</span>
          <div className="grid grid-cols-2 gap-1">
            {d.outputUrls.map((url, index) => (
              <Lightbox key={index} src={url} alt={"Generated " + (index + 1)}>
                <img
                  src={url}
                  alt={"Generated " + (index + 1)}
                  className="max-h-20 w-full rounded-md border border-slate-700 object-contain"
                />
              </Lightbox>
            ))}
          </div>
        </div>
      ) : d.outputUrl ? (
        <div className="space-y-1">
          <span className="text-xs text-slate-500">{t("image.output")}</span>
          <Lightbox src={d.outputUrl} alt="Generated">
            <img
              src={d.outputUrl}
              alt="Generated"
              className="max-h-40 w-full rounded-md border border-slate-700 object-contain"
            />
          </Lightbox>
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
