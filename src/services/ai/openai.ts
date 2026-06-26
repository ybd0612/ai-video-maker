// ────────────────────────────────────────────────────────────────────────────
// src/services/ai/openai.ts
// OpenAI-compatible provider implementation.
// Reuses existing utilities (fetchWithRetry, MODELS) for robustness.
// ────────────────────────────────────────────────────────────────────────────

import { MODELS } from "@/lib/models";
import { resolveBaseUrl } from "@/lib/resolveBaseUrl";
import { fetchWithRetry } from "@/lib/fetchWithRetry";
import { generateVideo as rawGenerateVideo } from "@/services/videoService";
import type {
  AIService,
  ChatParams,
  ChatResult,
  ImageParams,
  ImageResult,
  VideoParams,
  VideoResult,
  GenerateVideoCallbacks,
} from "./index";

interface OpenAIConfig {
  apiKey: string;
  baseUrl: string;
}

export class OpenAIService implements AIService {
  private config: OpenAIConfig;

  constructor(config: OpenAIConfig) {
    this.config = config;
  }

  /* ── Chat ──────────────────────────────────────────────────────────────── */

  async chatCompletion(params: ChatParams): Promise<ChatResult> {
    const url = `${resolveBaseUrl(this.config.baseUrl)}/chat/completions`;

    const resp = await fetchWithRetry(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: MODELS.text,
        messages: params.messages,
        temperature: params.temperature ?? 0.7,
        max_tokens: params.maxTokens ?? 1024,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`Chat API error ${resp.status}: ${body}`);
    }

    const contentType = resp.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      const body = await resp.text().catch(() => "");
      throw new Error(
        `Chat API 返回了非 JSON 响应 (Content-Type: ${contentType})。响应前 200 字符：${body.slice(0, 200)}`,
      );
    }

    const json = await resp.json();
    const content: string = json.choices?.[0]?.message?.content ?? "";

    if (!content) {
      throw new Error("Chat API 返回了空内容。");
    }

    return {
      content: content.trim(),
      usage: json.usage
        ? {
            promptTokens: json.usage.prompt_tokens ?? 0,
            completionTokens: json.usage.completion_tokens ?? 0,
          }
        : undefined,
    };
  }

  /* ── Image ─────────────────────────────────────────────────────────────── */

  async generateImage(params: ImageParams): Promise<ImageResult> {
    const url = `${this.config.baseUrl.replace(/\/+$/, "")}/images/generations`;
    const body: Record<string, unknown> = {
      model: MODELS.image,
      prompt: params.prompt,
      size: params.size,
      extra_body: { response_format: "url" },
    };

    // 图生图模式
    if (params.inputImageUrl) {
      body.image = [params.inputImageUrl];
    }

    const resp = await fetchWithRetry(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      // 内容安全过滤特殊处理
      try {
        const errJson = JSON.parse(text);
        if (errJson.error?.code === "content_policy_violation") {
          throw new Error(
            "图片提示词触发了内容安全过滤，请修改提示词后重试（避免涉及未成年人、暴力等敏感内容）。",
          );
        }
      } catch (parseErr) {
        if (
          parseErr instanceof Error &&
          parseErr.message.includes("内容安全过滤")
        )
          throw parseErr;
      }
      throw new Error(`Image API error ${resp.status}: ${text}`);
    }

    const contentType = resp.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      const text = await resp.text().catch(() => "");
      throw new Error(
        `Image API 返回了非 JSON 响应 (Content-Type: ${contentType})。请检查 Base URL 是否正确。响应前 200 字符：${text.slice(0, 200)}`,
      );
    }

    const json = await resp.json();
    let imageUrl: string = json.data?.[0]?.url ?? "";
    if (
      imageUrl &&
      !imageUrl.startsWith("http://") &&
      !imageUrl.startsWith("https://")
    ) {
      imageUrl = "https://" + imageUrl;
    }
    if (!imageUrl) {
      throw new Error("Image API returned no URL.");
    }

    return { url: imageUrl };
  }

  /* ── Video ─────────────────────────────────────────────────────────────── */

  async generateVideo(
    params: VideoParams,
    callbacks?: GenerateVideoCallbacks,
  ): Promise<VideoResult> {
    const result = await rawGenerateVideo(
      {
        apiKey: this.config.apiKey,
        baseUrl: this.config.baseUrl,
        prompt: params.prompt,
        imageUrl: params.imageUrl,
        // 默认 16:9 尺寸，后续可从 Project 配置获取
        size: "1280x720",
        duration: params.duration,
      },
      callbacks?.onProgress,
      callbacks?.signal,
    );

    return {
      videoUrl: result.videoUrl,
      coverImageUrl: result.coverImageUrl,
      duration: result.duration,
    };
  }
}
