// ────────────────────────────────────────────────────────────────────────────
// src/services/videoService.ts
// Generates videos for shots using the Agnes Video API (async + polling).
//
// API 规格：
//   创建任务：POST {baseUrl}/videos → 返回 { video_id }
//   查询结果：GET {origin}/agnesapi?video_id=<VIDEO_ID>
// ────────────────────────────────────────────────────────────────────────────

import { MODELS } from "@/lib/models";
import { fetchWithRetry } from "@/lib/fetchWithRetry";

const VIDEO_POLL_INTERVAL_MS = 5_000;
const VIDEO_POLL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes per attempt
const VIDEO_POLL_MAX_NOT_EXIST_RETRIES = 6; // 最多等待 30 秒让任务注册
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

  constructor(message: string, videoId: string) {
    super(message);
    this.name = "VideoTaskCreatedError";
    this.videoId = videoId;
  }
}

interface CreateVideoOptions {
  apiKey: string;
  baseUrl: string;
  prompt: string;
  imageUrl?: string;
  /** 尾帧图片 URL（双图流模式下使用） */
  lastFrameUrl?: string;
  size: string;
  duration: number;
  fps?: number;
}

interface VideoResult {
  videoUrl: string;
  coverImageUrl?: string;
  duration?: number;
}

/**
 * Map aspect ratio to video size.
 */
export function aspectRatioToVideoSize(ratio: string): string {
  switch (ratio) {
    case "9:16":
      return "720x1280";
    case "16:9":
      return "1280x720";
    case "1:1":
      return "1024x1024";
    default:
      return "1280x720";
  }
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
 * 查询端点：GET {origin}/agnesapi?video_id={videoId}
 *
 * 注意：轮询端点与创建端点使用不同的路径。
 * 创建用 {baseUrl}/videos，轮询用 {origin}/agnesapi。
 * 参考官方文档 agnes-ai.com/doc/agnes-video-v20
 */
export async function generateVideo(
  opts: CreateVideoOptions,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
): Promise<VideoResult> {
  const baseUrl = opts.baseUrl.replace(/\/+$/, "");
  const fps = opts.fps ?? 24;
  const numFrames = calcNumFrames(opts.duration, fps);

  // ── Create task (with 429 retry) ──────────────────────────────────────
  const body: Record<string, unknown> = {
    model: MODELS.video,
    prompt: sanitizePrompt(opts.prompt),
    num_frames: numFrames,
    frame_rate: fps,
  };

  const [w, h] = opts.size.split("x").map(Number);
  if (w && h) {
    body.width = w;
    body.height = h;
  }

  if (opts.imageUrl) {
    body.image = opts.imageUrl;
  }

  // 双图流：传入尾帧让模型同时感知首尾帧
  if (opts.lastFrameUrl) {
    body.last_image = opts.lastFrameUrl;
  }

  let createJson: Record<string, unknown> = {};
  let videoId: string | undefined;

  {
    if (signal?.aborted) throw new Error("视频生成已取消。");

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
    if (!videoId) {
      throw new Error(
        `Video API 未返回 video_id。响应: ${JSON.stringify(createJson).slice(0, 300)}`,
      );
    }
  }

  if (!videoId) {
    throw new Error("视频创建失败：无法获取 video_id");
  }

  // ── Poll for result ────────────────────────────────────────────────────
  // 轮询端点：GET {origin}/agnesapi?video_id={videoId}
  const origin = new URL(baseUrl).origin;
  const pollUrl = `${origin}/agnesapi?video_id=${encodeURIComponent(videoId)}`;
  const deadline = Date.now() + VIDEO_POLL_TIMEOUT_MS;
  let videoUrl = "";
  let coverImageUrl: string | undefined;
  let duration: number | undefined;
  let notExistCount = 0;

  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("视频轮询已取消。");

    await new Promise<void>((r) => setTimeout(r, VIDEO_POLL_INTERVAL_MS));
    if (signal?.aborted) throw new Error("视频轮询已取消。");

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

    onProgress?.(progress);

    if (rawStatus === "completed" || rawStatus === "succeeded") {
      videoUrl = pollJson.video_url ?? pollJson.remixed_from_video_id ?? pollJson.output?.video_url ?? "";
      coverImageUrl = pollJson.cover_image_url;
      duration = pollJson.seconds ?? pollJson.output?.duration ?? pollJson.duration;
      break;
    }

    if (rawStatus === "failed" || rawStatus === "cancelled") {
      const errDetail = typeof pollJson.error === "string"
        ? pollJson.error
        : pollJson.error
          ? JSON.stringify(pollJson.error)
          : "unknown error";
      throw new VideoTaskCreatedError(`视频生成失败: ${errDetail}`, videoId);
    }
  }

  if (!videoUrl) throw new VideoTaskCreatedError("视频生成超时，任务可能仍在服务器运行。", videoId);

  if (!videoUrl.startsWith("http://") && !videoUrl.startsWith("https://")) {
    videoUrl = "https://" + videoUrl;
  }

  return { videoUrl, coverImageUrl, duration };
}

/**
 * Calculate num_frames from duration and fps using the 8n+1 rule (max 441).
 */
function calcNumFrames(durationSec: number, fps: number): number {
  const raw = durationSec * fps;
  const n = Math.floor((raw - 1) / 8);
  return Math.min(n * 8 + 1, 441);
}
