// ────────────────────────────────────────────────────────────────────────────
// src/providers/types.ts
// Abstract Model Provider layer — decoupled from any concrete API.
// Every adapter (Agnes, OpenAI, Replicate, …) implements these interfaces.
// ────────────────────────────────────────────────────────────────────────────

/* ── Capability taxonomy ────────────────────────────────────────────────── */

export type Modality = "text" | "image" | "video";

export type ExecutionMode = "sync" | "async";

export type TaskStatus = "pending" | "processing" | "completed" | "failed";

/* ── Unified model descriptor ───────────────────────────────────────────── */

export interface AIModel {
  id: string;
  name: string;
  description: string;
  modality: Modality;
  endpoint: string;
  mode: ExecutionMode;
  maxContextLength?: number;
  pricing?: {
    prompt?: number;
    completion?: number;
    image?: number;
    video?: number;
  };
  constraints?: {
    maxFrames?: number;
    fpsRange?: [number, number];
    maxResolution?: [number, number];
    supportedFormats?: string[];
  };
}

/* ── Input parameter bags (one per modality) ────────────────────────────── */

export interface TextParams {
  model: string;
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  /** Free-form key-value pairs forwarded verbatim to the provider. */
  extraBody?: Record<string, unknown>;
}

export interface ImageParams {
  model: string;
  prompt: string;
  /** If provided the request becomes image-to-image. */
  inputImageUrl?: string;
  size?: string;
  quality?: string;
  responseFormat?: "url" | "b64_json";
  n?: number;
  extraBody?: Record<string, unknown>;
}

export interface VideoParams {
  model: string;
  prompt: string;
  /** Single reference image (image-to-video). */
  imageUrl?: string;
  /** Multiple reference images (multi-image / keyframe). */
  imageUrls?: string[];
  width?: number;
  height?: number;
  numFrames?: number;
  fps?: number;
  /** "normal" | "keyframe" */
  mode?: string;
  seed?: number;
  extraBody?: Record<string, unknown>;
}

/* ── Unified result types ───────────────────────────────────────────────── */

export interface Usage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  images?: number;
  videoFrames?: number;
}

export interface TextResult {
  content: string;
  finishReason?: string;
  usage?: Usage;
}

export interface ImageResult {
  url: string;
  revisedPrompt?: string;
  usage?: Usage;
}

export interface VideoTaskStatus {
  taskId: string;
  status: TaskStatus;
  /** 0–100 */
  progress: number;
  videoUrl?: string;
  coverImageUrl?: string;
  duration?: number;
  error?: string;
  usage?: Usage;
}

/* ── Provider interface (every adapter must implement this) ──────────────── */

export interface ModelProvider {
  /** Human-readable provider name. */
  readonly name: string;

  /**
   * Discover available models from the remote API.
   * Returns an empty array when the endpoint is unreachable.
   */
  discover(apiKey: string, baseUrl: string): Promise<AIModel[]>;

  /** Synchronous text generation. */
  generateText(apiKey: string, baseUrl: string, params: TextParams): Promise<TextResult>;

  /** Synchronous image generation. */
  generateImage(apiKey: string, baseUrl: string, params: ImageParams): Promise<ImageResult>;

  /**
   * Create an async video task.
   * Returns a task ID that must be polled with `pollVideoTask`.
   */
  createVideoTask(apiKey: string, baseUrl: string, params: VideoParams): Promise<string>;

  /** Poll an async video task until it completes or fails. */
  pollVideoTask(apiKey: string, baseUrl: string, taskId: string): Promise<VideoTaskStatus>;
}

/* ── Canvas execution status (shared across all node data types) ────────── */

export type NodeExecutionStatus = "idle" | "pending" | "success" | "failed";

export interface NodeExecutionLog {
  timestamp: number;
  level: "info" | "warn" | "error";
  message: string;
}

/* ── Environment configuration ──────────────────────────────────────────── */

export interface ProviderConfig {
  apiKey: string;
  baseUrl: string;
  /** Model ID overrides keyed by modality. */
  modelOverrides?: Partial<Record<Modality, string>>;
}
