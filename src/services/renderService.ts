// ────────────────────────────────────────────────────────────────────────────
// src/services/renderService.ts
// Concatenates shot videos into a final MP4 using FFmpeg.wasm.
// ────────────────────────────────────────────────────────────────────────────

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";

let ffmpegInstance: FFmpeg | null = null;

// FFmpeg 日志（stderr）尾部保留，失败时拼进错误信息，便于定位。
const MAX_LOG_LINES = 300;
const ffmpegLogLines: string[] = [];
// 当前 exec 的进度回调（progress 事件由 -progress pipe:1 触发）。
let activeProgressHandler: ((progress: number) => void) | null = null;

function onFfmpegLog({ message }: { message?: string }): void {
  if (message) {
    ffmpegLogLines.push(message);
    if (ffmpegLogLines.length > MAX_LOG_LINES) {
      ffmpegLogLines.splice(0, ffmpegLogLines.length - MAX_LOG_LINES);
    }
  }
}

function onFfmpegProgress({ progress }: { progress: number }): void {
  if (typeof progress === "number" && Number.isFinite(progress)) {
    activeProgressHandler?.(progress);
  }
}

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;

  const ffmpeg = new FFmpeg();
  ffmpeg.on("log", onFfmpegLog);
  ffmpeg.on("progress", onFfmpegProgress);

  // 国内网络优先走 npmmirror；开发环境通过 Vite 代理转为同源请求，避免镜像 CORS 头不稳定。
  // 生产环境保留 fastly.jsdelivr.net 回退，避免部署环境没有同名代理。
  const cdnBases = import.meta.env.DEV
    ? [
        "/ffmpeg-core/@ffmpeg/core@0.12.6/dist/esm",
        "https://fastly.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm",
        "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm",
      ]
    : [
        "https://fastly.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm",
        "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm",
      ];

  let loadError: unknown;
  for (const baseURL of cdnBases) {
    try {
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
      });
      ffmpegInstance = ffmpeg;
      return ffmpeg;
    } catch (err) {
      loadError = err;
      console.warn(`[render] FFmpeg 核心加载失败，尝试下一个源: ${baseURL}`, err);
    }
  }

  throw loadError instanceof Error ? loadError : new Error("FFmpeg 核心加载失败。");
}

export interface RenderOptions {
  videoUrls: string[];
  onProgress?: (progress: number) => void;
}

// 走本地 Vite 代理（/cdn-proxy）的已知输出域名，须与 vite.config.ts 保持一致。
// 实测中国站视频成片域名仅 cos-platform-outputs.agnes-ai.cn；
// 历史图片域名 platform-outputs.agnes-ai.space 不代理（直连，图片不走本服务）。
const PROXY_HOSTS = new Set([
  "cos-platform-outputs.agnes-ai.cn",
]);

// 单个视频下载超时（毫秒）
const FETCH_TIMEOUT_MS = 120_000;

/**
 * 本地开发时把已知输出域名的视频 URL 改走 Vite 代理，规避 CORS。
 * 保留 query string——COS 签名 URL 依赖签名参数，丢弃会 403。
 */
function toProxyUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (import.meta.env.DEV && PROXY_HOSTS.has(parsed.hostname)) {
      return `/cdn-proxy${parsed.pathname}${parsed.search}`;
    }
  } catch {
    // Not a valid URL, use as-is
  }
  return url;
}

/** 带超时的 fetch，供 @ffmpeg/util 的 fetchFile 使用，避免下载无限挂起。 */
async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 下载单个视频为字节数组，HTTP 非 2xx 视为失败。 */
async function downloadToBytes(url: string): Promise<Uint8Array> {
  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    throw new Error(`下载视频失败 HTTP ${res.status}: ${url}`);
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

/** 下载单个视频：先走代理，失败则回退直连原 URL（若服务端允许 CORS 也能救回）。 */
async function fetchVideoBytes(proxyUrl: string, originalUrl: string): Promise<Uint8Array> {
  try {
    return await downloadToBytes(proxyUrl);
  } catch (err) {
    if (proxyUrl !== originalUrl) {
      console.warn(`[render] 代理下载失败，回退直连: ${originalUrl}`, err);
      return await downloadToBytes(originalUrl);
    }
    throw err;
  }
}

/** 取 FFmpeg 日志尾部，失败时附加到错误信息。 */
function lastFfmpegLog(n = 20): string {
  return ffmpegLogLines.slice(-n).join("\n");
}

/**
 * 执行 concat 拼接，输出到 output.mp4。
 * 传入 -progress pipe:1 使 FFmpeg.wasm 触发 progress 事件，映射到 [start, end] 进度区间。
 */
async function runConcat(
  ffmpeg: FFmpeg,
  codecArgs: string[],
  start: number,
  end: number,
  onProgress?: (progress: number) => void,
): Promise<void> {
  activeProgressHandler = (p) => {
    onProgress?.(Math.round((start + Math.min(Math.max(p, 0), 1) * (end - start)) * 10) / 10);
  };
  try {
    await ffmpeg.exec([
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", "concat_list.txt",
      ...codecArgs,
      "-progress", "pipe:1",
      "output.mp4",
    ]);
    onProgress?.(end);
  } finally {
    activeProgressHandler = null;
  }
}

/**
 * Concatenate multiple video URLs into a single MP4.
 * Returns a blob URL of the final video.
 */
export async function concatenateVideos(opts: RenderOptions): Promise<string> {
  const { videoUrls, onProgress } = opts;
  if (videoUrls.length === 0) throw new Error("没有可拼接的视频。");
  if (videoUrls.length === 1) return videoUrls[0];

  const ffmpeg = await getFFmpeg();
  ffmpegLogLines.length = 0;

  try {
    // Download all videos into FFmpeg virtual filesystem
    for (let i = 0; i < videoUrls.length; i++) {
      const originalUrl = videoUrls[i];
      const proxyUrl = toProxyUrl(originalUrl);
      const data = await fetchVideoBytes(proxyUrl, originalUrl);
      await ffmpeg.writeFile(`input${i}.mp4`, data);
      onProgress?.(Math.round(((i + 1) / (videoUrls.length + 1)) * 50));
    }

    // Create concat list file
    const listContent = videoUrls
      .map((_, i) => `file 'input${i}.mp4'`)
      .join("\n");
    await ffmpeg.writeFile("concat_list.txt", listContent);

    // 先尝试 stream copy 快速拼接（要求各镜头编码参数一致，同一项目通常满足）
    try {
      await runConcat(ffmpeg, ["-c", "copy"], 50, 80, onProgress);
    } catch (copyErr) {
      // 参数不一致（分辨率/帧率/编码器/音轨差异）时降级重编码拼接
      await ffmpeg.deleteFile("output.mp4").catch(() => {});
      console.warn("[render] -c copy 拼接失败，降级重编码:", copyErr);
      await runConcat(
        ffmpeg,
        ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-c:a", "aac"],
        50,
        80,
        onProgress,
      );
    }

    onProgress?.(85);

    // Read output
    const rawOutput = await ffmpeg.readFile("output.mp4");
    // 拷贝为标准 ArrayBuffer 视图（readFile 可能返回 string 或 ArrayBufferLike 视图，直接 new Blob 类型不兼容）
    const outputData = typeof rawOutput === "string"
      ? new TextEncoder().encode(rawOutput)
      : new Uint8Array(rawOutput);
    const blob = new Blob([outputData], { type: "video/mp4" });
    const url = URL.createObjectURL(blob);

    onProgress?.(100);
    return url;
  } catch (err) {
    // 把 FFmpeg 日志尾部带进错误信息，便于用户反馈定位
    const logTail = lastFfmpegLog();
    const detail = err instanceof Error ? err.message : String(err);
    const msg = logTail ? `${detail}\nFFmpeg 日志尾部：\n${logTail}` : detail;
    throw new Error(msg);
  } finally {
    // Cleanup virtual FS
    for (let i = 0; i < videoUrls.length; i++) {
      await ffmpeg.deleteFile(`input${i}.mp4`).catch(() => {});
    }
    await ffmpeg.deleteFile("concat_list.txt").catch(() => {});
    await ffmpeg.deleteFile("output.mp4").catch(() => {});
  }
}
