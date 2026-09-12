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
  /** 尺寸档位串（"1K" | "2K"），直接作为请求体 size */
  size: string;
  /** 画幅比例（请求体 ratio，如 "9:16"），缺省 "1:1" */
  ratio?: string;
  negativePrompt?: string;
  /** 参考图 URL 列表（图生图 / 多图合成模式，官方要求放 extra_body.image） */
  referenceImageUrls?: string[];
  /**
   * 随机种子（实测 extra_body.seed 生效：同 seed 同 prompt 输出字节级一致）。
   * 「重新生成」类入口传随机值可破除结果趋同。
   */
  seed?: number;
}

export interface ImageResult {
  url: string;
}

export interface VideoParams {
  imageUrl: string;
  lastFrameUrl?: string;
  prompt: string;
  duration: number;
  /** 画幅比例（官方 aspect_ratio），如 "16:9" / "9:16" / "1:1" */
  aspectRatio?: string;
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
