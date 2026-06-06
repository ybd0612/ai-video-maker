// ────────────────────────────────────────────────────────────────────────────
// src/canvas/types.ts
// React Flow node data types — one per node kind.
// Every node carries its own execution state and error log.
// ────────────────────────────────────────────────────────────────────────────

import type { Node } from "@xyflow/react";
import type { Modality } from "@/providers/types";

/* ── Execution status (shared across all node data types) ───────────────── */

export type NodeExecutionStatus = "idle" | "pending" | "success" | "failed";

export interface NodeExecutionLog {
  timestamp: number;
  level: "info" | "warn" | "error";
  message: string;
}

/* ── Model registry — swap models here without touching node code ───────── */

export interface ModelEntry {
  id: string;
  name: string;
  modality: Modality;
}

export const MODEL_REGISTRY: Record<Modality, ModelEntry[]> = {
  text: [
    { id: "agnes-2.0-flash", name: "Agnes 2.0 Flash", modality: "text" },
  ],
  image: [
    { id: "agnes-image-2.1-flash", name: "Agnes Image 2.1 Flash", modality: "image" },
  ],
  video: [
    { id: "agnes-video-v2.0", name: "Agnes Video v2.0", modality: "video" },
  ],
};

export function getDefaultModelId(modality: Modality): string {
  return MODEL_REGISTRY[modality][0]?.id ?? "";
}

export function getModelNameById(id: string): string {
  for (const models of Object.values(MODEL_REGISTRY)) {
    const found = models.find((m) => m.id === id);
    if (found) return found.name;
  }
  return id;
}

/* ── Shared base fields for every node's data bag ─────────────────────── */
/*     Extends Record<string, unknown> to satisfy React Flow v12 constraint  */

interface BaseNodeData extends Record<string, unknown> {
  label: string;
  executionStatus: NodeExecutionStatus;
  executionLogs: NodeExecutionLog[];
  errorMessage?: string;
}

/* ── Prompt node — freeform text input ──────────────────────────────────── */

export interface PromptNodeData extends BaseNodeData {
  prompt: string;
  systemPrompt?: string;
  outputModality: Modality;
}

/* ── Text generation / output node ──────────────────────────────────────── */

export interface TextNodeData extends BaseNodeData {
  modelId?: string;
  prompt: string;
  systemPrompt?: string;
  temperature: number;
  maxTokens: number;
  output?: string;
  finishReason?: string;
}

/* ── Image generation / output node ─────────────────────────────────────── */

export interface ImageNodeData extends BaseNodeData {
  modelId?: string;
  prompt: string;
  size: string;
  quality: string;
  outputUrl?: string;
  outputBlobKey?: string;
  revisedPrompt?: string;
}

/* ── Video generation / output node ─────────────────────────────────────── */

export interface VideoNodeData extends BaseNodeData {
  modelId?: string;
  prompt: string;
  width: number;
  height: number;
  numFrames: number;
  fps: number;
  mode: "normal" | "keyframe";
  seed?: number;
  taskId?: string;
  taskProgress: number;
  outputUrl?: string;
  outputBlobKey?: string;
  coverImageUrl?: string;
  duration?: number;
}

/* ── Upload node — local file upload with base64 output ─────────────────── */

export interface UploadNodeData extends BaseNodeData {
  /** The raw base64 data URL (data:image/png;base64,...) stored after upload */
  base64Data?: string;
  /** Original filename for display */
  fileName?: string;
  /** File MIME type */
  fileType?: string;
  /** File size in bytes for display */
  fileSize?: number;
}

/* ── Discriminated union of all node data types ─────────────────────────── */

export type AnyNodeData =
  | PromptNodeData
  | TextNodeData
  | ImageNodeData
  | VideoNodeData
  | UploadNodeData;

/* ── Typed React Flow node aliases ──────────────────────────────────────── */

export type PromptNode = Node<PromptNodeData, "prompt">;
export type TextNode = Node<TextNodeData, "text">;
export type ImageNode = Node<ImageNodeData, "image">;
export type VideoNode = Node<VideoNodeData, "video">;

export type UploadNode = Node<UploadNodeData, "upload">;

export type AnyCanvasNode = PromptNode | TextNode | ImageNode | VideoNode | UploadNode;

/* ── Handle configuration for connection validation ─────────────────────── */

export type HandleDirection = "source" | "target";

export interface HandleSpec {
  id: string;
  direction: HandleDirection;
  dataType: "text" | "image" | "video" | "prompt";
}

/* ── Connection rule ────────────────────────────────────────────────────── */

export interface ConnectionRule {
  sourceDataType: string;
  targetDataType: string;
  label?: string;
}

/* ── Allowed connections matrix ─────────────────────────────────────────── */

export const ALLOWED_CONNECTIONS: ConnectionRule[] = [
  { sourceDataType: "text", targetDataType: "text", label: "Text → Text" },
  { sourceDataType: "text", targetDataType: "prompt", label: "Text → Prompt" },
  { sourceDataType: "image", targetDataType: "image", label: "Image → Image" },
  { sourceDataType: "image", targetDataType: "video", label: "Image → Video" },
  { sourceDataType: "video", targetDataType: "video", label: "Video → Video" },
];

/* ── Handle colors by dataType (shared by nodes and edges) ───────────────── */

export const HANDLE_COLORS: Record<string, { hex: string; tw: string }> = {
  text:   { hex: "#38bdf8", tw: "!bg-sky-500" },
  image:  { hex: "#a78bfa", tw: "!bg-violet-500" },
  video:  { hex: "#fbbf24", tw: "!bg-amber-500" },
};

/* ── Handle registry per node type ──────────────────────────────────────── */

export const NODE_HANDLES: Record<string, HandleSpec[]> = {
  prompt: [
    { id: "prompt-out", direction: "source", dataType: "text" },
  ],
  upload: [
    { id: "image-out", direction: "source", dataType: "image" },
  ],
  text: [
    { id: "text-in", direction: "target", dataType: "text" },
    { id: "text-out", direction: "source", dataType: "text" },
  ],
  image: [
    { id: "image-in", direction: "target", dataType: "image" },
    { id: "text-in", direction: "target", dataType: "text" },
    { id: "image-out", direction: "source", dataType: "image" },
  ],
  video: [
    { id: "video-in", direction: "target", dataType: "video" },
    { id: "image-in", direction: "target", dataType: "image" },
    { id: "text-in", direction: "target", dataType: "text" },
    { id: "video-out", direction: "source", dataType: "video" },
  ],
};

/* ── Default data factories ─────────────────────────────────────────────── */

export function createDefaultPromptNodeData(t: (key: string, vars?: Record<string, unknown>) => string): PromptNodeData {
  return {
    label: t("node.label.prompt"),
    prompt: "",
    systemPrompt: "",
    outputModality: "text",
    executionStatus: "idle",
    executionLogs: [],
  };
}

export function createDefaultTextNodeData(t: (key: string, vars?: Record<string, unknown>) => string): TextNodeData {
  return {
    label: t("node.label.text"),
    modelId: getDefaultModelId("text"),
    prompt: "",
    systemPrompt: "",
    temperature: 0.7,
    maxTokens: 1024,
    executionStatus: "idle",
    executionLogs: [],
  };
}

export function createDefaultImageNodeData(t: (key: string, vars?: Record<string, unknown>) => string): ImageNodeData {
  return {
    label: t("node.label.image"),
    modelId: getDefaultModelId("image"),
    prompt: "",
    size: "1024x1024",
    quality: "standard",
    executionStatus: "idle",
    executionLogs: [],
  };
}

export function createDefaultUploadNodeData(t: (key: string, vars?: Record<string, unknown>) => string): UploadNodeData {
  return {
    label: t("node.label.upload"),
    executionStatus: "idle",
    executionLogs: [],
  };
}

export function createDefaultVideoNodeData(t: (key: string, vars?: Record<string, unknown>) => string): VideoNodeData {
  return {
    label: t("node.label.video"),
    modelId: getDefaultModelId("video"),
    prompt: "",
    width: 768,
    height: 1152,
    numFrames: 121,
    fps: 24,
    mode: "normal",
    taskProgress: 0,
    executionStatus: "idle",
    executionLogs: [],
  };
}
