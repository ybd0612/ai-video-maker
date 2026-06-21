// ────────────────────────────────────────────────────────────────────────────
// src/services/videoService.ts
// Generates videos for shots using the Agnes Video API (async + polling).
//
// API 规格：
//   创建任务：POST {baseUrl}/videos → 返回 { video_id }
//   查询结果：GET {baseUrl}/videos?video_id=<VIDEO_ID>
// ────────────────────────────────────────────────────────────────────────────

import { MODELS } from "@/lib/models";

const VIDEO_POLL_INTERVAL_MS = 5_000;
const VIDEO_POLL_TIMEOUT_MS = 10 * 60 * 1000;
const VIDEO_POLL_MAX_NOT_EXIST_RETRIES = 6; // 最多等待 30 秒让任务注册

interface CreateVideoOptions {
  apiKey: string;
  baseUrl: string;
  prompt: string;
  imageUrl?: string;
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
 * Extract the real video_id from a potentially compound identifier.
 *
 * Agnes API may return a compound video_id in the format:
 *   "video_<base64>"
 * where base64 decodes to a semicolon-separated metadata string like:
 *   "litelll;custom_llm_provider:openai;model_id:...;video_id:video_xxxxx"
 *
 * This function decodes the base64 and extracts the actual video_id field.
 * If decoding fails or no video_id is found, returns the original string.
 */
function extractRealVideoId(rawId: string): string {
  // Match compound format: video_<base64payload>
  const match = rawId.match(/^video_([A-Za-z0-9+/=]{20,})$/);
  if (!match) return rawId;

  try {
    const decoded = atob(match[1]);
    // Parse semicolon-separated key:value pairs
    for (const part of decoded.split(";")) {
      const [key, value] = part.split(":");
      if (key === "video_id" && value) return value;
    }
  } catch {
    // Not valid base64, use raw ID
  }

  return rawId;
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
 * 查询端点：GET {baseUrl}/videos?video_id={videoId}
 */
export async function generateVideo(
  opts: CreateVideoOptions,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
): Promise<VideoResult> {
  const baseUrl = opts.baseUrl.replace(/\/+$/, "");
  const fps = opts.fps ?? 24;
  const numFrames = calcNumFrames(opts.duration, fps);

  // ── Create task ────────────────────────────────────────────────────────
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

  const createResp = await fetch(`${baseUrl}/videos`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify(body),
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

  const createJson = await createResp.json();

  // Extract video_id — API 可能返回 base64 复合标识符，需解析真实 ID
  const rawVideoId: string | undefined =
    createJson.video_id ?? createJson.task_id ?? createJson.id;
  if (!rawVideoId) {
    throw new Error(
      `Video API 未返回 video_id。响应: ${JSON.stringify(createJson).slice(0, 300)}`,
    );
  }
  const videoId = extractRealVideoId(rawVideoId);

  // ── Poll for result ────────────────────────────────────────────────────
  // 正确端点：GET {baseUrl}/videos?video_id={videoId}
  const pollUrl = `${baseUrl}/videos?video_id=${encodeURIComponent(videoId)}`;
  const deadline = Date.now() + VIDEO_POLL_TIMEOUT_MS;
  let videoUrl = "";
  let coverImageUrl: string | undefined;
  let duration: number | undefined;
  let notExistCount = 0;

  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("视频轮询已取消。");

    await new Promise<void>((r) => setTimeout(r, VIDEO_POLL_INTERVAL_MS));
    if (signal?.aborted) throw new Error("视频轮询已取消。");

    const pollResp = await fetch(pollUrl, {
      headers: { Authorization: `Bearer ${opts.apiKey}` },
    });

    if (!pollResp.ok) {
      const text = await pollResp.text().catch(() => "");

      // 任务尚未注册 — 等待后重试
      if (text.includes("task_not_exist") || pollResp.status === 404) {
        notExistCount++;
        if (notExistCount > VIDEO_POLL_MAX_NOT_EXIST_RETRIES) {
          throw new Error(
            `视频任务 ${videoId} 持续不存在（已重试 ${notExistCount} 次，HTTP ${pollResp.status}）。` +
            `轮询 URL: ${pollUrl}。响应: ${text.slice(0, 300)}`,
          );
        }
        continue;
      }

      throw new Error(`Video poll error ${pollResp.status}: ${text.slice(0, 500)}`);
    }

    // 成功获取响应，重置 not_exist 计数
    notExistCount = 0;

    const pollContentType = pollResp.headers.get("content-type") ?? "";
    if (!pollContentType.includes("application/json")) {
      const text = await pollResp.text().catch(() => "");
      throw new Error(
        `Video 轮询返回了非 JSON 响应 (Content-Type: ${pollContentType})。响应前 200 字符：${text.slice(0, 200)}`,
      );
    }

    const pollJson = await pollResp.json();
    const rawStatus: string = pollJson.status ?? "pending";
    const progress: number = pollJson.progress ?? 0;

    onProgress?.(progress);

    if (rawStatus === "completed" || rawStatus === "succeeded") {
      videoUrl = pollJson.video_url ?? pollJson.output?.video_url ?? "";
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
      throw new Error(`视频生成失败: ${errDetail}`);
    }
  }

  if (!videoUrl) throw new Error("视频生成超时。");

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
