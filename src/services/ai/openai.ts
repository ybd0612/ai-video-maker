// ────────────────────────────────────────────────────────────────────────────
// src/services/ai/openai.ts
// OpenAI-compatible provider implementation.
// Reuses existing utilities (fetchWithRetry, MODELS) for robustness.
// ────────────────────────────────────────────────────────────────────────────

import { MODELS, MAX_OUTPUT_TOKENS } from "@/lib/models";
import { resolveBaseUrl } from "@/lib/resolveBaseUrl";
import { fetchWithRetry } from "@/lib/fetchWithRetry";
import { rateLimiter, imageSizeToTier } from "@/services/rateLimit";
import { generateVideo as rawGenerateVideo } from "@/services/videoService";
import { getTranslation } from "@/i18n";

/**
 * 图片提示词被内容安全过滤。
 * 用独立类型（而非匹配错误文案）向上层传递，避免文案本地化后判断失效。
 */
class ImageSafetyFilterError extends Error {
  constructor() {
    super(getTranslation("error.imageSafetyFiltered"));
    this.name = "ImageSafetyFilterError";
  }
}
import { startSpan } from "@/lib/logger";
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

/**
 * 文本调用的单次尝试超时（毫秒）。
 *
 * ⚠️ 结构问题，不走参数决策（与 max_tokens 同类）：
 * 分镜/资产提取等调用要一次性输出整组大 JSON，实测 55-120s，紧贴默认 60s 线。
 * 60s 超时对这类调用是纯伤害 —— 重试也会在同一点被掐断（输出时长只取决于
 * 服务端生成速度，不随重试变化），表现为「一直生成中」3 分钟后报错。
 * 180s 给足生成时间；正常短调用（参数决策等）提前返回，不受影响。
 * 2026-09-15 实测：分镜请求在 60s 超时 + 3 次重试循环里全军覆没。
 */
const TEXT_TIMEOUT_MS = 180_000;

export class OpenAIService implements AIService {
  private config: OpenAIConfig;

  constructor(config: OpenAIConfig) {
    this.config = config;
  }

  /* ── Chat ──────────────────────────────────────────────────────────────── */

  async chatCompletion(params: ChatParams): Promise<ChatResult> {
    const span = startSpan("llm", "POST /chat/completions", {
      model: MODELS.text,
      temperature: params.temperature ?? 0.7,
      topP: params.topP,
      enableThinking: params.enableThinking ?? false,
      messages: params.messages.map((m) => `${m.role}:${m.content.length}`).join(" "),
    });
    try {
    // 用量控制：文本 RPM（按当前套餐节流，超限自动等待）
    await rateLimiter.acquire("text");

    const url = `${resolveBaseUrl(this.config.baseUrl)}/chat/completions`;

    const resp = await fetchWithRetry(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      timeoutMs: TEXT_TIMEOUT_MS,
      body: JSON.stringify({
        model: MODELS.text,
        messages: params.messages,
        temperature: params.temperature ?? 0.7,
        // top_p 仅在参数决策层给出时下发（不给就让服务端用自己的默认值）
        ...(typeof params.topP === "number" ? { top_p: params.topP } : {}),
        // ⚠️ 必须显式传最大输出：实测不传时服务端缺省 max_tokens=4096，
        // 长内容（分镜/9 行角色描述）会被 finish_reason=length 截断。
        // 统一给到模型最大值（效果优先，不做 token 精打细算），参数不外暴露。
        max_tokens: MAX_OUTPUT_TOKENS,
        // Thinking 由参数决策层按用途决定（缺省关闭）：关闭后所有 token 预算
        // 用于实际输出，从根本上避免思考耗尽导致 content 为空。
        chat_template_kwargs: { enable_thinking: params.enableThinking ?? false },
      }),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(
        getTranslation("error.chatApiError", { status: resp.status, detail: body }),
      );
    }

    const contentType = resp.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      const body = await resp.text().catch(() => "");
      // 非 React 上下文的瞬时错误：经 getTranslation 定格当前语言（可接受）
      throw new Error(
        getTranslation("error.chatNonJson", {
          contentType,
          body: body.slice(0, 200),
        }),
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
        throw new Error(getTranslation("error.chatReasoningBudget"));
      }
      throw new Error(
        getTranslation("error.chatEmptyContent", {
          finishReason: finishReason || getTranslation("common.unknown"),
        }),
      );
    }

    span.end({
      finishReason: choice?.finish_reason ?? "",
      promptTokens: json.usage?.prompt_tokens,
      completionTokens: json.usage?.completion_tokens,
      contentChars: content.length,
      content: content.length <= 4000 ? content : `${content.slice(0, 4000)}…(truncated)`,
    });

    return {
      content: content.trim(),
      usage: json.usage
        ? {
            promptTokens: json.usage.prompt_tokens ?? 0,
            completionTokens: json.usage.completion_tokens ?? 0,
          }
        : undefined,
    };
    } catch (error) {
      span.fail(error);
      throw error;
    }
  }

  /* ── Image ─────────────────────────────────────────────────────────────── */

  async generateImage(params: ImageParams): Promise<ImageResult> {
    const span = startSpan("image", "POST /images/generations", {
      model: MODELS.image,
      size: params.size,
      ratio: params.ratio ?? "1:1",
      seed: params.seed,
      referenceImages: params.referenceImageUrls?.length ?? 0,
      prompt: params.prompt,
    });
    try {
    // 用量控制：图片 RPM（按尺寸档位 1K/2K/3K/4K 区分限制）
    await rateLimiter.acquire("image", { sizeTier: imageSizeToTier(params.size) });

    const url = `${this.config.baseUrl.replace(/\/+$/, "")}/images/generations`;

    // ⚠️ 图生图 / 多图合成的参考图必须放在 extra_body.image（官方文档要求）。
    // 放在请求体顶层会被服务端拒绝（403 team_model_access_denied，报错文案有误导性）。
    const extraBody: Record<string, unknown> = { response_format: "url" };
    if (params.referenceImageUrls && params.referenceImageUrls.length > 0) {
      extraBody.image = params.referenceImageUrls;
    }
    // 随机种子（实测 extra_body.seed 生效：同 seed 同 prompt 输出字节级一致）
    if (typeof params.seed === "number" && Number.isFinite(params.seed)) {
      extraBody.seed = params.seed;
    }

    const body: Record<string, unknown> = {
      model: MODELS.image,
      prompt: params.prompt,
      // size 传档位串（"1K"/"2K"），画幅由 ratio 决定（官方要求分开传）
      size: params.size,
      ratio: params.ratio ?? "1:1",
      extra_body: extraBody,
    };

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
          throw new ImageSafetyFilterError();
        }
      } catch (parseErr) {
        // 用错误类型判断，不依赖本地化后的文案
        if (parseErr instanceof ImageSafetyFilterError) throw parseErr;
      }
      throw new Error(
        getTranslation("error.imageApiError", { status: resp.status, detail: text }),
      );
    }

    const contentType = resp.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      const text = await resp.text().catch(() => "");
      throw new Error(
        getTranslation("error.imageApiNonJson", {
          contentType,
          body: text.slice(0, 200),
        }),
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
      throw new Error(getTranslation("error.imageApiNoUrl"));
    }

    span.end({ imageUrl });
    return { url: imageUrl };
    } catch (error) {
      span.fail(error);
      throw error;
    }
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
        // 使用调用方指定画幅，未提供时默认 16:9
        // （agnes-video-2.5-flash 输出固定 720P，画幅由 aspect_ratio 决定）
        aspectRatio: params.aspectRatio ?? "16:9",
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
