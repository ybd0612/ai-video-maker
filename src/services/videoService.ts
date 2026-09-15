// ────────────────────────────────────────────────────────────────────────────
// src/services/videoService.ts
// Generates videos for shots using the Agnes Video API (async + polling).
//
// API 规格（agnes-video-2.5-flash）：
//   创建任务：POST {baseUrl}/videos → 返回 { video_id }
//   查询结果：GET {origin}/agnesapi?video_id=<VIDEO_ID>&model_name=agnes-video-2.5-flash
//
// 与旧版 agnes-video-v2.0 的参数差异（2.5 Flash 为不同参数体系，改动时务必注意）：
//   - size 固定为字符串 "720P"（传其他值直接 HTTP 400），画幅改由 aspect_ratio 控制
//   - 时长用 seconds 字符串 "4"~"12"，不再使用 num_frames(8n+1) + frame_rate
//   - 首帧 / 尾帧字段为 first_frame / last_frame（旧版为 image / last_image），
//     有首帧时 mode="keyframe"，无图时 mode="text"
//   - 轮询需带 model_name，keyframe 模式不带会查不到任务
//   - Flash 限制：参考图 ≤5 张、参考音频 ≤3 段、不支持参考视频（本项目均未使用）
// ────────────────────────────────────────────────────────────────────────────

import { startSpan } from "@/lib/logger";
import { getTranslation } from "@/i18n";
import { MODELS } from "@/lib/models";
import { fetchWithRetry } from "@/lib/fetchWithRetry";
import { clampNumber } from "@/lib/validation";
import { rateLimiter } from "@/services/rateLimit";

const VIDEO_POLL_INTERVAL_MS = 5_000;
const VIDEO_POLL_TIMEOUT_MS = 30 * 60 * 1000; // 视频模型较慢，单个任务最多等待 30 分钟
const VIDEO_POLL_MAX_NOT_EXIST_RETRIES = 24; // 最多等待 2 分钟让任务注册
const VIDEO_CREATE_MAX_RETRIES = 3; // 429 rate-limit retry
const VIDEO_CREATE_BASE_DELAY_MS = 10_000; // 10s base delay for 429 retry

/**
 * Error thrown when the video task was already created on the server
 * but polling failed (timeout, error, etc.).
 * Callers should NOT retry creating a new task when they receive this error.
 */
export class VideoTaskCreatedError extends Error {
  readonly taskCreated = true;
  readonly videoId: string;
  /** 服务端任务仍可能运行；真正 failed/cancelled 时为 false。 */
  readonly stillRunning: boolean;

  constructor(message: string, videoId: string, stillRunning = true) {
    super(message);
    this.name = "VideoTaskCreatedError";
    this.videoId = videoId;
    this.stillRunning = stillRunning;
  }
}

interface CreateVideoOptions {
  apiKey: string;
  baseUrl: string;
  prompt: string;
  /** 首帧图片 URL（提供时使用 keyframe 模式） */
  imageUrl?: string;
  /** 尾帧图片 URL（双图流模式下使用，需同时提供首帧） */
  lastFrameUrl?: string;
  /** 画幅比例，如 "16:9" / "9:16" / "1:1" */
  aspectRatio: string;
  /** 视频时长（秒），发送前会收敛到官方支持的 4~12 秒 */
  duration: number;
}

interface VideoResult {
  videoUrl: string;
  coverImageUrl?: string;
  duration?: number;
}

/** Agnes Video 2.5 Flash 固定输出 720P，画幅由 aspect_ratio 决定。 */
export const VIDEO_SIZE = "720P";

/** 官方支持的 aspect_ratio 取值。 */
const SUPPORTED_VIDEO_ASPECTS = [
  "1:1",
  "3:4",
  "4:3",
  "16:9",
  "9:16",
  "2:3",
  "3:2",
  "21:9",
] as const;

/** 官方支持的时长区间（秒）。 */
const VIDEO_MIN_SECONDS = 4;
const VIDEO_MAX_SECONDS = 12;
/** 时长缺失时的默认值（秒）。 */
const DEFAULT_SECONDS = 5;

/**
 * Map project aspect ratio to the official `aspect_ratio` value.
 * 非法值回退 16:9（横屏）。
 */
export function aspectRatioToVideoAspect(ratio: string): string {
  return (SUPPORTED_VIDEO_ASPECTS as readonly string[]).includes(ratio) ? ratio : "16:9";
}

/**
 * Sanitize prompt before sending to the Video API.
 */
function sanitizePrompt(prompt: string): string {
  const cleaned = prompt
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) {
    throw new Error("Video prompt is empty after sanitization.");
  }
  return cleaned;
}

/**
 * Create an async video task and poll until completion.
 * Returns the final video URL.
 *
 * 创建端点：POST {baseUrl}/videos
 * 查询端点：GET {origin}/agnesapi?video_id={videoId}&model_name={model}
 *
 * 注意：轮询端点与创建端点使用不同的路径与查询参数。
 * 创建用 {baseUrl}/videos，轮询用 {origin}/agnesapi 且必须带 model_name
 * （keyframe 模式不带 model_name 会查不到任务）。
 * 参考官方文档 https://agnes-ai.cn/zh-Hans/docs/agnes-video-25-flash
 */
export async function generateVideo(
  opts: CreateVideoOptions,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
): Promise<VideoResult> {
  const baseUrl = opts.baseUrl.replace(/\/+$/, "");

  // ── Create task (with 429 retry) ──────────────────────────────────────
  // 用量控制：视频 RPM（默认档仅 1 RPM，会把并发串行化到约 1 次/分钟）
  // + Token Plan 每日秒数配额（cost = 请求时长秒数）
  await rateLimiter.acquire("video", { cost: opts.duration || 1, signal });

  const hasFirstFrame = !!opts.imageUrl;
  const hasLastFrame = !!opts.lastFrameUrl;
  const seconds = clampNumber(
    Math.round(opts.duration) || DEFAULT_SECONDS,
    VIDEO_MIN_SECONDS,
    VIDEO_MAX_SECONDS,
  );

  const body: Record<string, unknown> = {
    model: MODELS.video,
    prompt: sanitizePrompt(opts.prompt),
    // 有首帧/尾帧走 keyframe（首尾帧控制），纯文本走 text
    mode: hasFirstFrame || hasLastFrame ? "keyframe" : "text",
    size: VIDEO_SIZE,
    aspect_ratio: aspectRatioToVideoAspect(opts.aspectRatio),
    seconds: String(seconds),
    n: 1,
  };

  // keyframe 模式：first_frame / last_frame 至少提供一个
  if (opts.imageUrl) {
    body.first_frame = opts.imageUrl;
  }
  if (opts.lastFrameUrl) {
    body.last_frame = opts.lastFrameUrl;
  }

  let createJson: Record<string, unknown> = {};
  let videoId: string | undefined;

  {
    if (signal?.aborted)
      throw new Error(getTranslation("error.videoGenerationCancelled"));

    const createStartedAt = Date.now();

    const createResp = await fetchWithRetry(`${baseUrl}/videos`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
      maxRetries: VIDEO_CREATE_MAX_RETRIES,
      baseDelayMs: VIDEO_CREATE_BASE_DELAY_MS,
    });

    if (!createResp.ok) {
      const text = await createResp.text().catch(() => "");
      throw new Error(`Video create error ${createResp.status}: ${text}`);
    }

    const createContentType = createResp.headers.get("content-type") ?? "";
    if (!createContentType.includes("application/json")) {
      const text = await createResp.text().catch(() => "");
      throw new Error(
        `Video API 返回了非 JSON 响应 (Content-Type: ${createContentType})。请检查 Base URL 是否正确。响应前 200 字符：${text.slice(0, 200)}`,
      );
    }

    createJson = await createResp.json();

    // Extract video_id from create response
    videoId = (createJson.video_id as string) ?? (createJson.task_id as string) ?? (createJson.id as string) ?? undefined;
    startSpan("video", "POST /videos", {
      model: MODELS.video,
      mode: body.mode,
      size: body.size,
      aspectRatio: body.aspect_ratio,
      seconds: body.seconds,
      hasFirstFrame,
      hasLastFrame,
      prompt: body.prompt,
    }).end({ videoId, createMs: Date.now() - createStartedAt });
    if (!videoId) {
      throw new Error(
        `Video API 未返回 video_id。响应: ${JSON.stringify(createJson).slice(0, 300)}`,
      );
    }
  }

  if (!videoId) {
    throw new Error(getTranslation("error.videoCreateNoVideoId"));
  }

  // ── Poll for result ────────────────────────────────────────────────────
  // 轮询端点：GET {origin}/agnesapi?video_id={videoId}&model_name={model}
  // model_name 必带：2.5 Flash 的 keyframe / reference 模式不带会查不到任务。
  const origin = new URL(baseUrl).origin;
  const pollUrl = `${origin}/agnesapi?video_id=${encodeURIComponent(videoId)}&model_name=${encodeURIComponent(MODELS.video)}`;
  const pollStartedAt = Date.now();
  let pollRounds = 0;
  const deadline = Date.now() + VIDEO_POLL_TIMEOUT_MS;
  let videoUrl = "";
  let coverImageUrl: string | undefined;
  let duration: number | undefined;
  let notExistCount = 0;

  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error(getTranslation("error.videoPollCancelled"));

    await new Promise<void>((r) => setTimeout(r, VIDEO_POLL_INTERVAL_MS));
    if (signal?.aborted) throw new Error(getTranslation("error.videoPollCancelled"));

    const pollResp = await fetchWithRetry(pollUrl, {
      headers: { Authorization: `Bearer ${opts.apiKey}` },
    });

    if (!pollResp.ok) {
      const text = await pollResp.text().catch(() => "");

      // 任务尚未注册 — 等待后重试
      if (text.includes("task_not_exist") || pollResp.status === 404) {
        notExistCount++;
        if (notExistCount > VIDEO_POLL_MAX_NOT_EXIST_RETRIES) {
          throw new VideoTaskCreatedError(
            `视频任务 ${videoId} 持续不存在（已重试 ${notExistCount} 次，HTTP ${pollResp.status}）。` +
            `轮询 URL: ${pollUrl}。响应: ${text.slice(0, 300)}`,
            videoId,
          );
        }
        continue;
      }

      throw new VideoTaskCreatedError(`Video poll error ${pollResp.status}: ${text.slice(0, 500)}`, videoId);
    }

    // 成功获取响应，重置 not_exist 计数
    notExistCount = 0;

    const pollContentType = pollResp.headers.get("content-type") ?? "";
    if (!pollContentType.includes("application/json")) {
      const text = await pollResp.text().catch(() => "");
      throw new VideoTaskCreatedError(
        `Video 轮询返回了非 JSON 响应 (Content-Type: ${pollContentType})。响应前 200 字符：${text.slice(0, 200)}`,
        videoId,
      );
    }

    const pollJson = await pollResp.json();
    const rawStatus: string = pollJson.status ?? "pending";
    const progress: number = pollJson.progress ?? 0;

    pollRounds++;
    onProgress?.(progress);

    if (rawStatus === "completed" || rawStatus === "succeeded" || pollJson.internal_status === "completed") {
      // Agnes 实际返回：成片 URL 位于顶层 `url` 字段（用户实测响应，如
      // https://cos-platform-outputs.agnes-ai.cn/videos/...mp4）。
      // 官方文档示例格式为 metadata.url；另兼容旧版 video_url / output.url 等字段。
      videoUrl = pollJson.url
        ?? pollJson.metadata?.url
        ?? pollJson.video_url
        ?? pollJson.output?.url
        ?? pollJson.output?.video_url
        ?? pollJson.remixed_from_video_id
        ?? "";
      coverImageUrl = pollJson.cover_image_url ?? pollJson.metadata?.cover_url;
      duration = pollJson.seconds !== undefined && pollJson.seconds !== null
        ? Number(pollJson.seconds)
        : (pollJson.output?.duration ?? pollJson.duration);
      if (!videoUrl) {
        throw new VideoTaskCreatedError(
          `视频任务 ${videoId} 已完成，但响应中没有视频 URL（url/metadata.url 均缺失）。响应: ${JSON.stringify(pollJson).slice(0, 500)}`,
          videoId,
          false,
        );
      }
      startSpan("video", "logmsg.videoCompleted", { videoId }).end({
        videoUrl,
        coverImageUrl,
        seconds: duration,
        pollRounds,
        pollMs: Date.now() - pollStartedAt,
      });
      break;
    }

    if (rawStatus === "failed" || rawStatus === "cancelled") {
      const errDetail = typeof pollJson.error === "string"
        ? pollJson.error
        : pollJson.error
          ? JSON.stringify(pollJson.error)
          : "unknown error";
      startSpan("video", "logmsg.videoFailed", { videoId }).fail(new Error(errDetail));
      throw new VideoTaskCreatedError(
        getTranslation("error.videoGenerationFailed", { reason: errDetail }),
        videoId,
        false,
      );
    }
  }

  if (!videoUrl)
    throw new VideoTaskCreatedError(
      getTranslation("error.videoGenerationTimedOut"),
      videoId,
      true,
    );

  if (!videoUrl.startsWith("http://") && !videoUrl.startsWith("https://")) {
    videoUrl = "https://" + videoUrl;
  }

  return { videoUrl, coverImageUrl, duration };
}
