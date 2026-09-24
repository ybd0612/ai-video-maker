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
//   - Flash 限制：参考图 ≤5 张、参考音频 ≤3 段、不支持参考视频
//   - ⚠ 实测（2026-09-21）：reference 与 first_frame / last_frame 服务端硬互斥，
//     同时传返回 400「首尾帧素材与参考素材不能同时使用」→ 只能二选一
// ────────────────────────────────────────────────────────────────────────────

import { startSpan } from "@/lib/logger";
import { getTranslation } from "@/i18n";
import { MODELS } from "@/lib/models";
import { fetchWithRetry } from "@/lib/fetchWithRetry";
import { clampNumber } from "@/lib/validation";
import { MAX_VIDEO_REFERENCE_IMAGES } from "@/lib/videoPlan";
import { rateLimiter, RATE_LIMIT_RETRY_BUDGET } from "@/services/rateLimit";

const VIDEO_POLL_INTERVAL_MS = 5_000;
const VIDEO_POLL_TIMEOUT_MS = 30 * 60 * 1000; // 视频模型较慢，单个任务最多等待 30 分钟
const VIDEO_POLL_MAX_NOT_EXIST_RETRIES = 24; // 最多等待 2 分钟让任务注册
/**
 * 视频创建 POST 的**通用**重试次数 —— 恒为 0。
 * 原注释写「为 429 退避」，但 fetchWithRetry 的 isRetriable 同样覆盖超时与 5xx，
 * 而实测（2026-09-23，debug-dump/runtime.log 30 次真实创建）createMs 包着整次调用，
 * p50 只有 3.6s 却有 3 次越过默认 60s 线（62.8s / 140.8s / 142.8s）→ 超时重发在
 * 生产里真的发生过。POST /videos 非幂等且按秒计费，重发一次就是再建一个任务、
 * 再扣一次秒数，所以超时 / 5xx 一律不重发，失败交用户手动重摇。
 * ⚠ 429 例外：它是服务端在建任务前的拒绝（未建任务、未扣秒数），重发安全，
 * 走下面的独立冷却通道。原先「429 已由 rateLimiter 按 RPM 节流兜住」的前提
 * 已被 2026-09-23 实测否定（免费档文档 RPM=20，服务端 12 请求/38s 即拒），
 * 故 RPM 阈值只作粗过滤，429 的兜底改由闭环冷却承担。
 */
const VIDEO_CREATE_MAX_RETRIES = 0;
/** 单次尝试超时：给足创建时间，避免慢响应被掐断（与文本/图片创建同量级） */
const VIDEO_CREATE_TIMEOUT_MS = 180_000;

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
  /**
   * reference 模式的参考图 URL（身份 + 画风，≤5 张）。
   * ⚠ 与 imageUrl / lastFrameUrl 互斥：服务端对同时使用返回 400，
   * 传入本字段时帧素材会被丢弃。
   */
  referenceImageUrls?: string[];
  /** 画幅比例，如 "16:9" / "9:16" / "1:1" */
  aspectRatio: string;
  /** 视频时长（秒），发送前会收敛到官方支持的 4~12 秒 */
  duration: number;
  /** 任务创建成功后、开始轮询前立刻回调。用于把 videoId 落盘，刷新后可恢复而不重建 */
  onTaskCreated?: (videoId: string, modelName: string) => void;
}

interface VideoResult {
  videoUrl: string;
  coverImageUrl?: string;
  duration?: number;
}

/**
 * 轮询一次任务状态。
 *
 * ⚠️ 请求级失败必须转成带 `videoId` 的 {@link VideoTaskCreatedError} 再上抛：
 * `fetchWithRetry` 在重试耗尽时是**抛错**（HttpError / 网络错误 / 超时）而不是返回响应，
 * 未包装的普通 Error 会被调用方（`useVideoActions`）判成「创建阶段失败」而走自动重发分支，
 * 于是对同一个镜头再发一次 `POST /videos` —— 服务端多出一个个已计费的重复任务。
 * 一次 GET 轮询被 429 卡住正是最容易踩中这条路径的情形（2026-09-23 排查 429 时发现）。
 */
async function pollVideoTask(pollUrl: string, apiKey: string, videoId: string): Promise<Response> {
  try {
    return await fetchWithRetry(pollUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new VideoTaskCreatedError(
      `${getTranslation("error.videoPollRequestFailedWithId", { videoId, detail })} ${getTranslation("error.videoTaskKept")}`,
      videoId,
    );
  }
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
  // reference 模式：以参考图锚定身份与画风。实测与 first_frame / last_frame
  // 服务端硬互斥（同时传返回 400「首尾帧素材与参考素材不能同时使用」），
  // 因此一旦有参考图就丢弃帧素材，绝不叠加。
  const referenceImages = (opts.referenceImageUrls ?? []).slice(0, MAX_VIDEO_REFERENCE_IMAGES);
  const hasReference = referenceImages.length > 0;
  if (hasReference && (hasFirstFrame || hasLastFrame)) {
    console.warn(
      "[video] reference 与首尾帧互斥，已按 reference 优先丢弃 first_frame/last_frame 素材",
    );
  }
  const seconds = clampNumber(
    Math.round(opts.duration) || DEFAULT_SECONDS,
    VIDEO_MIN_SECONDS,
    VIDEO_MAX_SECONDS,
  );

  const body: Record<string, unknown> = {
    model: MODELS.video,
    prompt: sanitizePrompt(opts.prompt),
    // 有参考图走 reference；否则有首/尾帧走 keyframe；再否则纯文本
    mode: hasReference ? "reference" : (hasFirstFrame || hasLastFrame ? "keyframe" : "text"),
    size: VIDEO_SIZE,
    aspect_ratio: aspectRatioToVideoAspect(opts.aspectRatio),
    seconds: String(seconds),
    n: 1,
  };

  if (hasReference) {
    body.images = referenceImages;
  } else {
    // keyframe 模式：first_frame / last_frame 至少提供一个
    if (opts.imageUrl) {
      body.first_frame = opts.imageUrl;
    }
    if (opts.lastFrameUrl) {
      body.last_frame = opts.lastFrameUrl;
    }
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
      timeoutMs: VIDEO_CREATE_TIMEOUT_MS,
      // 429 = 服务端建任务前的拒绝（未建任务、未扣秒数），等窗口解除后重发安全。
      // 重发不再走 acquire()：那会把被拒绝的请求也记进每日秒数配额，虚增用量。
      rateLimitRetries: RATE_LIMIT_RETRY_BUDGET,
      onRateLimited: ({ retryAfterMs }) =>
        rateLimiter.notifyRateLimited("video", { retryAfterMs, signal }),
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

  // 任务已在服务端创建：先落盘再轮询。轮询期间的任何失败都不能让任务 ID 一起丢掉
  // （视频按秒计费，丢了 ID 就只能重建任务）。
  opts.onTaskCreated?.(videoId, MODELS.video);

  return pollVideoTaskById({ apiKey: opts.apiKey, baseUrl }, videoId, MODELS.video, onProgress, signal);
}

/**
 * 继续轮询一个**已存在**的服务端任务：只发 GET，绝不发 POST /videos。
 * 供刷新后恢复在飞任务使用（见 Shot.videoTaskId），也被 generateVideo 内部复用。
 */
export async function pollVideoTaskById(
  opts: { apiKey: string; baseUrl: string },
  videoId: string,
  modelName: string,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
): Promise<VideoResult> {
  const baseUrl = opts.baseUrl.replace(/\/+$/, "");

  // ── Poll for result ────────────────────────────────────────────────────
  // 轮询端点：GET {origin}/agnesapi?video_id={videoId}&model_name={model}
  // model_name 必带：2.5 Flash 的 keyframe / reference 模式不带会查不到任务。
  const origin = new URL(baseUrl).origin;
  const pollUrl = `${origin}/agnesapi?video_id=${encodeURIComponent(videoId)}&model_name=${encodeURIComponent(modelName)}`;
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

    const pollResp = await pollVideoTask(pollUrl, opts.apiKey, videoId);

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
