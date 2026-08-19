// ────────────────────────────────────────────────────────────────────────────
// src/services/imageService.ts
// Generates images for shots using the Agnes Image API.
// ────────────────────────────────────────────────────────────────────────────

import { createAIService } from "@/services/ai/factory";

interface GenerateImageOptions {
  apiKey: string;
  baseUrl: string;
  prompt: string;
  size: string;
  /** If provided, uses image-to-image mode with this reference image */
  inputImageUrl?: string;
}

/**
 * Generate a single image from a visual prompt.
 * Returns the image URL.
 *
 * 内部委托给统一 AI 服务层，保留原有调用签名以兼容现有调用方。
 */
export async function generateImage(opts: GenerateImageOptions): Promise<string> {
  const service = createAIService({
    provider: "openai",
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl,
  });
  const result = await service.generateImage({
    prompt: opts.prompt,
    size: opts.size,
    inputImageUrl: opts.inputImageUrl,
  });
  return result.url;
}

/**
 * Map aspect ratio to image size.
 */
export function aspectRatioToImageSize(ratio: string): string {
  switch (ratio) {
    case "9:16":
      return "768x1344";
    case "16:9":
      return "1344x768";
    case "1:1":
      return "1024x1024";
    default:
      return "1344x768";
  }
}
