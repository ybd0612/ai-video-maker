// ────────────────────────────────────────────────────────────────────────────
// src/services/imageService.ts
// Generates images for shots using the Agnes Image API.
// ────────────────────────────────────────────────────────────────────────────

import { MODELS } from "@/lib/models";

interface GenerateImageOptions {
  apiKey: string;
  baseUrl: string;
  prompt: string;
  size: string;
}

/**
 * Generate a single image from a visual prompt.
 * Returns the image URL.
 */
export async function generateImage(opts: GenerateImageOptions): Promise<string> {
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/images/generations`;
  const body: Record<string, unknown> = {
    model: MODELS.image,
    prompt: opts.prompt,
    size: opts.size,
    extra_body: { response_format: "url" },
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Image API error ${resp.status}: ${text}`);
  }

  const json = await resp.json();
  let imageUrl: string = json.data?.[0]?.url ?? "";
  if (imageUrl && !imageUrl.startsWith("http://") && !imageUrl.startsWith("https://")) {
    imageUrl = "https://" + imageUrl;
  }
  if (!imageUrl) {
    throw new Error("Image API returned no URL.");
  }
  return imageUrl;
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
