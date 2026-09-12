// ────────────────────────────────────────────────────────────────────────────
// src/services/imageService.ts
// Generates images for shots using the Agnes Image API.
// ────────────────────────────────────────────────────────────────────────────

import { createAIService } from "@/services/ai/factory";

/** 图片尺寸档位（官方 1K/2K；当前生成链路只用 1K/2K） */
export type ImageSizeTier = "1K" | "2K";

/** 支持的画幅比例（官方 ratio 取值） */
export type ImageRatio =
  | "1:1"
  | "3:4"
  | "4:3"
  | "16:9"
  | "9:16"
  | "2:3"
  | "3:2"
  | "21:9";

const KNOWN_RATIOS: readonly string[] = [
  "1:1", "3:4", "4:3", "16:9", "9:16", "2:3", "3:2", "21:9",
];

interface GenerateImageOptions {
  apiKey: string;
  baseUrl: string;
  prompt: string;
  /** 尺寸档位串（"1K" | "2K"），直接作为请求体 size 传给 API */
  size: string;
  /** 画幅比例（请求体 ratio），缺省由 AI 服务层按 "1:1" 处理 */
  ratio?: string;
  /** 参考图 URL 列表（图生图 / 多图合成模式，官方要求放 extra_body.image） */
  referenceImageUrls?: string[];
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
    ...(opts.ratio ? { ratio: opts.ratio } : {}),
    ...(opts.referenceImageUrls && opts.referenceImageUrls.length > 0
      ? { referenceImageUrls: opts.referenceImageUrls }
      : {}),
  });
  return result.url;
}

/**
 * Map aspect ratio to image generation params（档位串 + 画幅比例）。
 * size 统一走 1K 档（官方 1K 档 RPM 最高、配额最省，且 720P 级向导输出足够）；
 * 画幅经白名单校验，未知值回退 "1:1"。
 */
export function aspectRatioToImageParams(ratio: string): {
  size: ImageSizeTier;
  ratio: ImageRatio;
} {
  const normalized = KNOWN_RATIOS.includes(ratio) ? (ratio as ImageRatio) : "1:1";
  return { size: "1K", ratio: normalized };
}
