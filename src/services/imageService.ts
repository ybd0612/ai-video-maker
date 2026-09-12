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
  /**
   * 图生图被服务端拒绝（team 未开通该能力，403 team_model_access_denied）时，
   * 用该提示词降级为纯文生图重试（模型不变，风格由提示词文本补偿）。
   * 通常传「不含参考图指令的原始提示词」。
   */
  fallbackPrompt?: string;
}

/** 是否为图生图能力被拒（实测 403 仅出现在带 image 参数的调用；纯文生图不受影响） */
function isImg2ImgAccessError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /team_model_access_denied|not allowed to access model/i.test(msg);
}

/**
 * Generate a single image from a visual prompt.
 * Returns the image URL.
 *
 * 带参考图时优先图生图；若 team 未开通图生图能力（403 team_model_access_denied），
 * 自动降级为纯文生图重试（模型不变，用 fallbackPrompt 补偿风格描述）。
 * 其他错误（网络 / 内容安全 / 限流）不降级，直接抛出。
 */
export async function generateImage(opts: GenerateImageOptions): Promise<string> {
  const service = createAIService({
    provider: "openai",
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl,
  });

  if (opts.inputImageUrl) {
    try {
      const result = await service.generateImage({
        prompt: opts.prompt,
        size: opts.size,
        inputImageUrl: opts.inputImageUrl,
      });
      return result.url;
    } catch (err) {
      if (!isImg2ImgAccessError(err)) throw err;
      console.warn(
        "[imageService] 图生图被拒（team 未开通该能力），降级为纯文生图重试",
        err instanceof Error ? err.message : err,
      );
    }
  }

  const result = await service.generateImage({
    prompt: opts.fallbackPrompt ?? opts.prompt,
    size: opts.size,
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
