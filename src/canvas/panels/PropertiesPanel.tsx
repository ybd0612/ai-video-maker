// ────────────────────────────────────────────────────────────────────────────
// src/canvas/panels/PropertiesPanel.tsx
// Right-side panel that shows the selected node's editable properties,
// execution logs, and output preview.
// ────────────────────────────────────────────────────────────────────────────

import { useCallback } from "react";
import { X, Play, RotateCcw, ChevronDown, ChevronUp } from "lucide-react";
import type { Node } from "@xyflow/react";
import { useCanvasStore } from "@/stores/canvasStore";
import { useWorkflowRunner } from "@/canvas/hooks/useWorkflowRunner";
import { useT } from "@/i18n";
import { NumberInput } from "@/components/ui/NumberInput";
import { HelpTooltip } from "@/components/ui/HelpTooltip";
import { sanitizeNodeLabel, sanitizePrompt, sanitizeRichText } from "@/lib/validation";
import type {
  AnyNodeData,
  TextNodeData,
  ImageNodeData,
  VideoNodeData,
  PromptNodeData,
  UploadNodeData,
} from "@/canvas/types";

interface PropertiesPanelProps {
  node: Node<Record<string, unknown>> | null;
  onClose: () => void;
}

/* ── Inline type guards ──────────────────────────────────────────────────── */

function isTextNode(n: Node<Record<string, unknown>>): n is Node<TextNodeData, "text"> {
  return n.type === "text";
}
function isImageNode(n: Node<Record<string, unknown>>): n is Node<ImageNodeData, "image"> {
  return n.type === "image";
}
function isVideoNode(n: Node<Record<string, unknown>>): n is Node<VideoNodeData, "video"> {
  return n.type === "video";
}
function isPromptNode(n: Node<Record<string, unknown>>): n is Node<PromptNodeData, "prompt"> {
  return n.type === "prompt";
}
function isUploadNode(n: Node<Record<string, unknown>>): n is Node<UploadNodeData, "upload"> {
  return n.type === "upload";
}

/* ── Reusable Field wrapper ──────────────────────────────────────────────── */

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-500 uppercase tracking-wider">{label}{hint && <HelpTooltip>{hint}</HelpTooltip>}</label>
      {children}
    </div>
  );
}

/* ── Component ──────────────────────────────────────────────────────────── */

export function PropertiesPanel({ node, onClose }: PropertiesPanelProps) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const resetExecutionStates = useCanvasStore((s) => s.resetExecutionStates);
  const { run } = useWorkflowRunner();
  const t = useT();

  const handleRunNode = useCallback(() => {
    if (!node) return;
    run({ startNodeId: node.id });
  }, [node, run]);

  const handleReset = useCallback(() => {
    resetExecutionStates();
  }, [resetExecutionStates]);

  if (!node) return null;

  const d = node.data as unknown as AnyNodeData;

  return (
    <div className="absolute right-0 top-0 z-40 h-full w-80 overflow-y-auto border-l border-slate-800 bg-slate-950/95 backdrop-blur-sm">
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-800 bg-slate-950/95 px-4 py-3">
        <h3 className="text-xs font-bold text-slate-100 truncate">
          {d.label || t("panel.properties")}
        </h3>
        <div className="flex items-center gap-1">
          <button
            onClick={handleRunNode}
            title={t("panel.runNode")}
            className="rounded p-1 text-slate-500 transition hover:bg-slate-800 hover:text-emerald-400"
          >
            <Play size={13} />
          </button>
          <button
            onClick={handleReset}
            title={t("panel.resetStates")}
            className="rounded p-1 text-slate-500 transition hover:bg-slate-800 hover:text-amber-400"
          >
            <RotateCcw size={13} />
          </button>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-500 transition hover:bg-slate-800 hover:text-slate-200"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="space-y-4 p-4">
        {/* Label editor */}
        <Field label={t("panel.label")} hint={t("hint.label")}>
          <input
            type="text"
            value={d.label}
            onChange={(e) => updateNodeData(node.id, { label: e.target.value })}
            onBlur={(e) => updateNodeData(node.id, { label: sanitizeNodeLabel(e.target.value) })}
            className="w-full rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-100 focus:border-slate-500 focus:outline-none"
          />
        </Field>

        {/* Node-type specific fields */}
        {isTextNode(node) && <TextNodeFields nodeId={node.id} data={node.data as unknown as TextNodeData} />}
        {isImageNode(node) && <ImageNodeFields nodeId={node.id} data={node.data as unknown as ImageNodeData} />}
        {isVideoNode(node) && <VideoNodeFields nodeId={node.id} data={node.data as unknown as VideoNodeData} />}
        {isPromptNode(node) && <PromptNodeFields nodeId={node.id} data={node.data as unknown as PromptNodeData} />}
        {isUploadNode(node) && <UploadNodeFields nodeId={node.id} data={node.data as unknown as UploadNodeData} />}

        {/* Execution logs */}
        {d.executionLogs && d.executionLogs.length > 0 && (
          <LogsSection logs={d.executionLogs} />
        )}
      </div>
    </div>
  );
}

/* ── Text Node Fields ────────────────────────────────────────────────────── */

function TextNodeFields({ nodeId, data }: { nodeId: string; data: TextNodeData }) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const t = useT();

  return (
    <>
      <Field label={t("panel.promptText")}>
        <textarea
          value={data.prompt}
          onChange={(e) => updateNodeData(nodeId, { prompt: e.target.value })}
          onBlur={(e) => updateNodeData(nodeId, { prompt: sanitizePrompt(e.target.value) })}
          placeholder={t("panel.promptPlaceholder")}
          rows={4}
          className="w-full resize-none rounded-md border border-slate-700 bg-slate-800 p-2 text-xs text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
        />
      </Field>
      <Field label={t("panel.temperature")} hint={t("hint.temperature")}>
        <NumberInput
          min={0}
          max={2}
          step={0.1}
          value={data.temperature}
          onChange={(v) => updateNodeData(nodeId, { temperature: v })}
          className="w-24 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
        />
      </Field>
      <Field label={t("panel.maxTokens")} hint={t("hint.maxTokens")}>
        <NumberInput
          min={1}
          max={8192}
          value={data.maxTokens}
          onChange={(v) => updateNodeData(nodeId, { maxTokens: v })}
          className="w-24 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
        />
      </Field>
      {data.output && (
        <Field label={t("panel.textOutput")}>
          <div className="max-h-60 overflow-y-auto rounded-md border border-slate-700 bg-slate-800/50 p-2">
            <p className="whitespace-pre-wrap text-xs text-slate-300 leading-relaxed">{data.output}</p>
          </div>
        </Field>
      )}
    </>
  );
}

/* ── Image Node Fields ───────────────────────────────────────────────────── */

function ImageNodeFields({ nodeId, data }: { nodeId: string; data: ImageNodeData }) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const t = useT();


  return (
    <>
      <Field label={t("panel.imagePrompt")}>
        <textarea
          value={data.prompt}
          onChange={(e) => updateNodeData(nodeId, { prompt: e.target.value })}
          onBlur={(e) => updateNodeData(nodeId, { prompt: sanitizePrompt(e.target.value) })}
          placeholder={t("panel.promptPlaceholder")}
          rows={4}
          className="w-full resize-none rounded-md border border-slate-700 bg-slate-800 p-2 text-xs text-slate-100 placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
        />
      </Field>
      <Field label={t("panel.imageSize")} hint={t("hint.imageSize")}>
        <div className="flex items-center gap-1">
          <NumberInput
            min={64}
            max={2048}
            step={64}
            value={data.width}
            onChange={(v) => updateNodeData(nodeId, { width: v })}
            className="w-20 rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-xs text-slate-300 focus:border-violet-500 focus:outline-none"
          />
          <span className="text-xs text-slate-600">×</span>
          <NumberInput
            min={64}
            max={2048}
            step={64}
            value={data.height}
            onChange={(v) => updateNodeData(nodeId, { height: v })}
            className="w-20 rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-xs text-slate-300 focus:border-violet-500 focus:outline-none"
          />
        </div>
      </Field>
      {/* Input image from upstream is now shown in the canvas node */}
      {data.outputUrl && (
        <Field label={t("panel.outputImage")}>
          <img src={data.outputUrl} alt="Generated" className="w-full rounded-md border border-slate-700" />
        </Field>
      )}
      {data.revisedPrompt && (
        <Field label={t("panel.promptText")}>
          <p className="text-xs text-slate-400 leading-relaxed">{data.revisedPrompt}</p>
        </Field>
      )}
    </>
  );
}

/* ── Video Node Fields ───────────────────────────────────────────────────── */

function VideoNodeFields({ nodeId, data }: { nodeId: string; data: VideoNodeData }) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const t = useT();

  return (
    <>
      <Field label={t("panel.videoPrompt")}>
        <textarea
          value={data.prompt}
          onChange={(e) => updateNodeData(nodeId, { prompt: e.target.value })}
          onBlur={(e) => updateNodeData(nodeId, { prompt: sanitizePrompt(e.target.value) })}
          placeholder={t("panel.promptPlaceholder")}
          rows={4}
          className="w-full resize-none rounded-md border border-slate-700 bg-slate-800 p-2 text-xs text-slate-100 placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
        />
      </Field>
      <Field label={t("panel.resolution")} hint={t("hint.resolution")}>
        <div className="flex items-center gap-2">
          <NumberInput min={256} max={1920} step={64} value={data.width}
            onChange={(v) => updateNodeData(nodeId, { width: v })}
            className="w-20 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
          />
          <span className="text-xs text-slate-500">x</span>
          <NumberInput min={256} max={1920} step={64} value={data.height}
            onChange={(v) => updateNodeData(nodeId, { height: v })}
            className="w-20 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
          />
        </div>
      </Field>
      <Field label={t("panel.fpsFrames")} hint={t("hint.fps")}>
        <div className="flex items-center gap-2">
          <NumberInput min={1} max={60} value={data.fps}
            onChange={(v) => updateNodeData(nodeId, { fps: v })}
            className="w-16 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
          />
          <span className="text-xs text-slate-500">{t("panel.fps")}</span>
          <NumberInput min={1} max={300} value={data.numFrames}
            onChange={(v) => updateNodeData(nodeId, { numFrames: v })}
            className="w-16 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
          />
          <span className="text-xs text-slate-500">{t("panel.frames")}</span>
        </div>
      </Field>
      {data.outputUrl && (
        <Field label={t("panel.outputVideo")}>
          <video
            src={data.outputUrl}
            controls
            loop
            className="w-full rounded-md border border-slate-700"
          />
        </Field>
      )}
    </>
  );
}

/* ── Prompt Node Fields ──────────────────────────────────────────────────── */

function PromptNodeFields({ nodeId, data }: { nodeId: string; data: PromptNodeData }) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const t = useT();

  return (
    <>
      <Field label={t("panel.systemPrompt")} hint={t("hint.systemPrompt")}>
        <textarea
          value={data.systemPrompt ?? ""}
          onChange={(e) => updateNodeData(nodeId, { systemPrompt: e.target.value })}
          onBlur={(e) => updateNodeData(nodeId, { systemPrompt: sanitizeRichText(e.target.value) })}
          placeholder={t("panel.systemPromptPlaceholder")}
          rows={2}
          className="w-full resize-none rounded-md border border-slate-700 bg-slate-800 p-2 text-xs text-slate-100 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
        />
      </Field>
      <Field label={t("panel.outputModality")} hint={t("hint.outputModality")}>
        <select
          value={data.outputModality}
          onChange={(e) => updateNodeData(nodeId, { outputModality: e.target.value as "text" | "image" | "video" })}
          className="w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
        >
          <option value="text">{t("panel.text")}</option>
          <option value="image">{t("panel.image")}</option>
          <option value="video">{t("panel.video")}</option>
        </select>
      </Field>
    </>
  );
}

/* ── Upload Node Fields ──────────────────────────────────────────────────── */

function UploadNodeFields({ data }: { nodeId: string; data: UploadNodeData }) {
  const t = useT();

  return (
    <>
      {data.base64Data ? (
        <>
          <Field label={t("panel.file")}>
            <p className="text-xs text-slate-400">
              {data.fileName} ({data.fileType})
            </p>
          </Field>
          <Field label={t("panel.preview")}>
            <img src={data.base64Data} alt={data.fileName ?? "Uploaded"} className="w-full rounded-md border border-slate-700" />
          </Field>
        </>
      ) : (
        <p className="text-xs text-slate-500">{t("panel.noUploadedImage")}</p>
      )}
    </>
  );
}

/* ── Logs Section ────────────────────────────────────────────────────────── */

function LogsSection({ logs }: { logs: NonNullable<AnyNodeData["executionLogs"]> }) {
  const t = useT();
  const count = logs.length;

  return (
    <details open={count > 0} className="group">
      <summary className="flex cursor-pointer items-center gap-1 text-xs font-medium text-slate-500 uppercase tracking-wider">
        {count > 0 ? <ChevronDown size={10} /> : <ChevronUp size={10} />}
        {t("panel.logs")} ({count})
      </summary>
      {count > 0 ? (
        <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-md border border-slate-800 bg-slate-900/50 p-2">
          {logs.map((log, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <span className="mt-0.5 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full" />
              <span className="text-[11px] text-slate-400 leading-tight">
                {new Date(log.timestamp).toLocaleTimeString()} — {log.message}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-1 text-[11px] text-slate-600">{t("panel.noLogs")}</p>
      )}
    </details>
  );
}
