import { memo, useRef } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Upload, X } from "lucide-react";
import { useCanvasStore } from "@/stores/canvasStore";
import type { UploadNodeData } from "@/canvas/types";
import { NodeShell } from "./NodeShell"
import { useT } from '@/i18n';
import { Lightbox } from "@/components/ui/Lightbox";;

const ACCEPTED = "image/png,image/jpeg,image/webp,image/gif";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function UploadNodeInner({ id, data }: NodeProps) {
  const d = data as unknown as UploadNodeData;
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const inputRef = useRef<HTMLInputElement>(null);
  const t = useT();

  // Check for connected upstream image
  const connectedImageEdge = edges.find(
    (e) => e.target === id && e.targetHandle === "image-in"
  );
  const upstreamImageUrl: string | undefined = connectedImageEdge
    ? (() => {
        const srcNode = nodes.find((n) => n.id === connectedImageEdge.source);
        if (!srcNode) return undefined;
        const srcData = srcNode.data as Record<string, unknown>;
        return (srcData.outputUrl as string) || undefined;
      })()
    : undefined;

  const hasInputImage = !!upstreamImageUrl || !!d.imageUrl;
  const displayImageUrl = d.imageUrl || upstreamImageUrl;

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    // Read as base64 data URL
    const base64 = await fileToBase64(file);
    updateNodeData(id, {
      base64Data: base64,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
    } as Partial<UploadNodeData>);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleClear = () => {
    updateNodeData(id, {
      base64Data: undefined,
      fileName: undefined,
      fileType: undefined,
      fileSize: undefined,
    } as Partial<UploadNodeData>);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <NodeShell
      nodeId={id}
      label={d.label}
      icon={Upload}
      iconColor="text-rose-400"
      borderColor={(d.base64Data || hasInputImage) ? "border-rose-500/80" : "border-rose-800/60"}
      status={d.executionStatus}
      errorMessage={d.errorMessage}
      errorKey={d.errorKey}
      errorParams={d.errorParams}
      runnable={false}
    >
      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        onChange={handleInputChange}
        className="hidden"
      />

      {hasInputImage ? (
        /* Show upstream image — no upload needed */
        <Lightbox src={displayImageUrl!} alt="Input">
          <img
            src={displayImageUrl!}
            alt="Input"
            className="max-h-40 w-full rounded-md border border-rose-800/40 object-contain cursor-pointer"
          />
        </Lightbox>
      ) : d.base64Data ? (
        /* Preview when local image is loaded */
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 truncate max-w-[180px]">
              {d.fileName} ({formatSize(d.fileSize ?? 0)})
            </span>
            <button
              onClick={handleClear}
              className="rounded p-0.5 text-slate-500 hover:bg-slate-700 hover:text-red-400 transition"
              title={t("upload.removeTooltip")}
            >
              <X size={12} />
            </button>
          </div>
          <Lightbox src={d.base64Data} alt={d.fileName ?? "Uploaded"}>
            <img
              src={d.base64Data}
              alt={d.fileName ?? "Uploaded"}
              className="max-h-40 w-full rounded-md border border-slate-700 object-contain cursor-pointer"
            />
          </Lightbox>
        </div>
      ) : (
        /* Drop zone when empty and no upstream */
        <div
          onClick={() => inputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          className="flex h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-slate-700 transition hover:border-rose-500/60 hover:bg-slate-800/40"
        >
          <Upload size={20} className="text-slate-500" />
          <span className="text-xs text-slate-500">
            {t("upload.dropHint")}
          </span>
          <span className="text-[11px] text-slate-600">
            {t("upload.formats")}
          </span>
        </div>
      )}

      <Handle type="target" position={Position.Left} id="image-in" className="!h-3 !w-3 !bg-rose-500" />
      <Handle
        type="source"
        position={Position.Right}
        id="image-out"
        className="!h-3 !w-3 !bg-rose-500"
      />
    </NodeShell>
  );
}

export const UploadNode = memo(UploadNodeInner);
