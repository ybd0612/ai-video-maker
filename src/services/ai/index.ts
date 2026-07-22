// ────────────────────────────────────────────────────────────────────────────
// src/services/ai/index.ts
// Unified AI service interface — abstracts provider-specific details.
// ────────────────────────────────────────────────────────────────────────────

export interface ChatParams {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  temperature?: number;
  maxTokens?: number;
  /** 是否启用推理模型的 Thinking 模式（默认 false：思考会占用 token 预算，
   * 关闭后所有预算用于实际输出，避免思考耗尽导致 content 为空） */
  enableThinking?: boolean;
}

export interface ChatResult {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

export interface ImageParams {
  prompt: string;
  size: string;
  negativePrompt?: string;
  /** 参考图 URL（图生图模式） */
  inputImageUrl?: string;
}

export interface ImageResult {
  url: string;
}

export interface VideoParams {
  imageUrl: string;
  lastFrameUrl?: string;
  prompt: string;
  duration: number;
}

export interface VideoResult {
  videoUrl: string;
  coverImageUrl?: string;
  duration?: number;
}

export interface GenerateVideoCallbacks {
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}

export interface AIService {
  chatCompletion(params: ChatParams): Promise<ChatResult>;
  generateImage(params: ImageParams): Promise<ImageResult>;
  generateVideo(
    params: VideoParams,
    callbacks?: GenerateVideoCallbacks,
  ): Promise<VideoResult>;
}
