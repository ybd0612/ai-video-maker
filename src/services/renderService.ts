// ────────────────────────────────────────────────────────────────────────────
// src/services/renderService.ts
// Concatenates shot videos into a final MP4 using FFmpeg.wasm.
// ────────────────────────────────────────────────────────────────────────────

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

let ffmpegInstance: FFmpeg | null = null;

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;

  const ffmpeg = new FFmpeg();

  const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
  });

  ffmpegInstance = ffmpeg;
  return ffmpeg;
}

export interface RenderOptions {
  videoUrls: string[];
  onProgress?: (progress: number) => void;
}

/**
 * Concatenate multiple video URLs into a single MP4.
 * Returns a blob URL of the final video.
 */
export async function concatenateVideos(opts: RenderOptions): Promise<string> {
  const { videoUrls, onProgress } = opts;
  if (videoUrls.length === 0) throw new Error("No videos to concatenate.");
  if (videoUrls.length === 1) return videoUrls[0];

  const ffmpeg = await getFFmpeg();

  try {
    // Download all videos into FFmpeg virtual filesystem
    for (let i = 0; i < videoUrls.length; i++) {
      const data = await fetchFile(videoUrls[i]);
      await ffmpeg.writeFile(`input${i}.mp4`, data);
      onProgress?.(Math.round(((i + 1) / (videoUrls.length + 1)) * 50));
    }

    // Create concat list file
    const listContent = videoUrls
      .map((_, i) => `file 'input${i}.mp4'`)
      .join("\n");
    await ffmpeg.writeFile("concat_list.txt", listContent);

    // Run FFmpeg concat demuxer
    await ffmpeg.exec([
      "-f", "concat",
      "-safe", "0",
      "-i", "concat_list.txt",
      "-c", "copy",
      "output.mp4",
    ]);

    onProgress?.(80);

    // Read output
    const rawOutput = await ffmpeg.readFile("output.mp4");
    const outputData = new Uint8Array(rawOutput as unknown as ArrayBuffer);
    const blob = new Blob([outputData], { type: "video/mp4" });
    const url = URL.createObjectURL(blob);

    onProgress?.(100);
    return url;
  } finally {
    // Cleanup virtual FS
    for (let i = 0; i < videoUrls.length; i++) {
      await ffmpeg.deleteFile(`input${i}.mp4`).catch(() => {});
    }
    await ffmpeg.deleteFile("concat_list.txt").catch(() => {});
    await ffmpeg.deleteFile("output.mp4").catch(() => {});
  }
}
