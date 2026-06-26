// ────────────────────────────────────────────────────────────────────────────
// src/services/ai/index.ts
// Unified AI service interface — abstracts provider-specific details.
// ────────────────────────────────────────────────────────────────────────────

export interface ChatParams {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  temperature?: number;
  maxTokens?: number;
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
