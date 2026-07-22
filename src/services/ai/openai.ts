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
        // 推理模型（如 agnes-2.0-flash）会先消耗 token 用于思考（reasoning_content），
        // 剩余才输出到 content。预算太小会导致思考耗尽、content 为空，故默认给 4096。
        max_tokens: params.maxTokens ?? 4096,
        // 默认关闭 Thinking 模式：聊天/脚本生成等任务无需深度推理，
        // 关闭后所有 token 预算用于实际输出，从根本上避免思考耗尽导致 content 为空，且响应更快。
        chat_template_kwargs: { enable_thinking: params.enableThinking ?? false },
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
    const choice = json.choices?.[0];

    // 规范化 content：部分提供商返回数组形式（[{type, text}]）或 null
    let rawContent: unknown = choice?.message?.content ?? "";
    if (Array.isArray(rawContent)) {
      rawContent = rawContent
        .map((part) => (typeof part === "string" ? part : (part?.text ?? "")))
        .join("");
    }
    const content: string = typeof rawContent === "string" ? rawContent : "";

    if (!content.trim()) {
      // 诊断：推理模型思考耗尽 token 预算（finish_reason=length 且有 reasoning_content）
      const finishReason: string = choice?.finish_reason ?? "";
      const hasReasoning = !!choice?.message?.reasoning_content;
      if (finishReason === "length" && hasReasoning) {
        throw new Error(
          "推理模型的思考过程耗尽了 token 预算，没有剩余空间输出回答。请重试；若持续出现，需调大 max_tokens。",
        );
      }
      throw new Error(`Chat API 返回了空内容（finish_reason: ${finishReason || "未知"}）。`);
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
        // 双图流：传递尾帧 URL
        ...(params.lastFrameUrl ? { lastFrameUrl: params.lastFrameUrl } : {}),
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
