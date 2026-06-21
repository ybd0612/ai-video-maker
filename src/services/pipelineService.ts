// ────────────────────────────────────────────────────────────────────────────
// src/services/pipelineService.ts
// Orchestrates the four-phase video pipeline: script → image → video → render.
// ────────────────────────────────────────────────────────────────────────────

import { useProjectStore, selectActiveProject, type Shot } from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { generateScript } from "./scriptService";
import { generateImage, aspectRatioToImageSize } from "./imageService";
import { generateVideo, aspectRatioToVideoSize } from "./videoService";

type PipelinePhase = "script" | "image" | "video" | "render";

const VIDEO_MAX_RETRIES = 3;
const VIDEO_RETRY_DELAY_MS = 5_000;

interface RunOptions {
  signal?: AbortSignal;
  onPhaseStart?: (phase: PipelinePhase) => void;
  onShotUpdate?: (shotId: string, status: Shot["status"], extra?: Partial<Shot>) => void;
}

/**
 * Run the full pipeline from a user prompt:
 * 1. Generate script (shots)
 * 2. Generate images for each shot
 * 3. Generate videos for each shot
 */
export async function runPipeline(prompt: string, opts: RunOptions = {}) {
  const { providerConfig } = useSettingsStore.getState();
  const { apiKey, baseUrl } = providerConfig;
  if (!apiKey || !baseUrl) throw new Error("API key is not configured.");

  const store = useProjectStore.getState();
  const project = selectActiveProject(store);
  if (!project) throw new Error("No active project.");

  const imageSize = aspectRatioToImageSize(project.aspectRatio);
  const videoSize = aspectRatioToVideoSize(project.aspectRatio);

  // ── Phase 1: Script (skip if prompt is empty and shots already exist) ──
  const shouldGenerateScript = prompt.trim().length > 0;

  if (shouldGenerateScript) {
    opts.onPhaseStart?.("script");
    store.setProjectStatus("scripting");

    try {
      const rawShots = await generateScript({
        apiKey,
        baseUrl,
        prompt,
        language: project.language,
        aspectRatio: project.aspectRatio,
      });

      const shots: Shot[] = rawShots.map((s, i) => ({
        id: `shot_${Date.now()}_${i}`,
        index: i,
        status: "scripted" as const,
        ...s,
      }));

      store.setShots(shots);
    } catch (err) {
      store.setProjectStatus("failed", err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  // ── Phase 2: Images (parallel, max 3 concurrent) ────────────────────────
  opts.onPhaseStart?.("image");
  store.setProjectStatus("imaging");

  const shotsAfterScript = selectActiveProject(useProjectStore.getState())!.shots;

  try {
    await runParallel(shotsAfterScript, 3, opts.signal, async (shot) => {
      // Skip shots with empty visual prompt
      if (!shot.visualPrompt?.trim()) {
        store.setShotStatus(shot.id, "failed", "画面描述为空，跳过图片生成。");
        opts.onShotUpdate?.(shot.id, "failed", { error: "画面描述为空" });
        throw new Error(`Shot ${shot.id} has empty visualPrompt.`);
      }

      store.setShotStatus(shot.id, "imaging");
      opts.onShotUpdate?.(shot.id, "imaging");

      try {
        const imageUrl = await generateImage({
          apiKey,
          baseUrl,
          prompt: shot.visualPrompt,
          size: imageSize,
        });

        store.updateShot(shot.id, { imageUrl, status: "imaged" });
        opts.onShotUpdate?.(shot.id, "imaged", { imageUrl });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        store.setShotStatus(shot.id, "failed", msg);
        opts.onShotUpdate?.(shot.id, "failed", { error: msg });
        throw err;
      }
    });
  } catch {
    // Some shots may have failed; continue to check
    const anyFailed = selectActiveProject(useProjectStore.getState())!.shots.some((s) => s.status === "failed");
    if (anyFailed) {
      store.setProjectStatus("failed", "Some shots failed during image generation.");
      return;
    }
  }

  // ── Phase 3: Videos (parallel, max 2 concurrent) ────────────────────────
  opts.onPhaseStart?.("video");
  store.setProjectStatus("videoing");

  const shotsAfterImage = selectActiveProject(useProjectStore.getState())!.shots;

  try {
    await runParallel(shotsAfterImage, 2, opts.signal, async (shot) => {
      // Skip shots with empty visual prompt or missing image
      if (!shot.visualPrompt?.trim()) {
        store.setShotStatus(shot.id, "failed", "画面描述为空，跳过视频生成。");
        opts.onShotUpdate?.(shot.id, "failed", { error: "画面描述为空" });
        throw new Error(`Shot ${shot.id} has empty visualPrompt.`);
      }
      if (!shot.imageUrl) {
        store.setShotStatus(shot.id, "failed", "缺少参考图，跳过视频生成。");
        opts.onShotUpdate?.(shot.id, "failed", { error: "缺少参考图" });
        throw new Error(`Shot ${shot.id} has no imageUrl.`);
      }

      store.setShotStatus(shot.id, "videoing");
      opts.onShotUpdate?.(shot.id, "videoing");

      await generateVideoWithRetry(
          shot.id,
          {
            apiKey,
            baseUrl,
            prompt: shot.visualPrompt,
            imageUrl: shot.imageUrl,
            size: videoSize,
            duration: shot.duration,
          },
          opts.signal,
        );

        store.updateShot(shot.id, { status: "videoed" });
        opts.onShotUpdate?.(shot.id, "videoed");
    });
  } catch {
    const anyFailed = selectActiveProject(useProjectStore.getState())!.shots.some((s) => s.status === "failed");
    if (anyFailed) {
      store.setProjectStatus("failed", "Some shots failed during video generation.");
      return;
    }
  }

  store.setProjectStatus("done");
}

/**
 * Run a single shot through image + video phases.
 */
export async function runSingleShot(shotId: string, opts: RunOptions = {}) {
  const { providerConfig } = useSettingsStore.getState();
  const { apiKey, baseUrl } = providerConfig;
  if (!apiKey || !baseUrl) throw new Error("API key is not configured.");

  const store = useProjectStore.getState();
  const project = selectActiveProject(store);
  if (!project) throw new Error("No active project.");

  const shot = project.shots.find((s) => s.id === shotId);
  if (!shot) throw new Error("Shot not found.");
  if (!shot.visualPrompt?.trim()) throw new Error("镜头画面描述为空，无法生成。");

  const imageSize = aspectRatioToImageSize(project.aspectRatio);
  const videoSize = aspectRatioToVideoSize(project.aspectRatio);

  // Image
  let imageUrl: string;
  store.setShotStatus(shotId, "imaging");
  try {
    imageUrl = await generateImage({
      apiKey,
      baseUrl,
      prompt: shot.visualPrompt,
      size: imageSize,
    });
    store.updateShot(shotId, { imageUrl, status: "imaged" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    store.setShotStatus(shotId, "failed", msg);
    throw err;
  }

  // Video
  store.setShotStatus(shotId, "videoing");
  try {
    await generateVideoWithRetry(
      shotId,
      {
        apiKey,
        baseUrl,
        prompt: shot.visualPrompt,
        imageUrl,
        size: videoSize,
        duration: shot.duration,
      },
      opts.signal,
    );
    store.updateShot(shotId, { status: "videoed" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    store.setShotStatus(shotId, "failed", msg);
    throw err;
  }
}

/**
 * Retry all failed video shots in the active project.
 * Only retries shots that failed during video phase (have imageUrl but no videoUrl).
 */
export async function retryFailedVideos(opts: RunOptions = {}) {
  const { providerConfig } = useSettingsStore.getState();
  const { apiKey, baseUrl } = providerConfig;
  if (!apiKey || !baseUrl) throw new Error("API key is not configured.");

  const store = useProjectStore.getState();
  const project = selectActiveProject(store);
  if (!project) throw new Error("No active project.");

  const failedVideoShots = project.shots.filter(
    (s) => s.status === "failed" && s.imageUrl && !s.videoUrl,
  );
  if (failedVideoShots.length === 0) return;

  const videoSize = aspectRatioToVideoSize(project.aspectRatio);
  store.setProjectStatus("videoing");

  try {
    await runParallel(failedVideoShots, 2, opts.signal, async (shot) => {
      store.setShotStatus(shot.id, "videoing");
      store.updateShot(shot.id, { videoRetryCount: 0, videoProgress: undefined });

      await generateVideoWithRetry(
        shot.id,
        {
          apiKey,
          baseUrl,
          prompt: shot.visualPrompt,
          imageUrl: shot.imageUrl!,
          size: videoSize,
          duration: shot.duration,
        },
        opts.signal,
      );
      store.updateShot(shot.id, { status: "videoed" });
    });
  } catch {
    const anyFailed = selectActiveProject(useProjectStore.getState())!.shots.some(
      (s) => s.status === "failed",
    );
    if (anyFailed) {
      store.setProjectStatus("failed", "部分视频生成失败，已自动重试。");
      return;
    }
  }

  store.setProjectStatus("done");
}

/**
 * Generate video with automatic retry on transient failures.
 * Retries up to VIDEO_MAX_RETRIES times with delay between attempts.
 */
async function generateVideoWithRetry(
  shotId: string,
  opts: {
    apiKey: string;
    baseUrl: string;
    prompt: string;
    imageUrl: string;
    size: string;
    duration: number;
  },
  signal?: AbortSignal,
): Promise<void> {
  const store = useProjectStore.getState();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= VIDEO_MAX_RETRIES; attempt++) {
    if (signal?.aborted) throw new Error("Pipeline cancelled.");

    // Delay before retry (not on first attempt)
    if (attempt > 0) {
      store.updateShot(shotId, {
        videoRetryCount: attempt,
        error: `第 ${attempt} 次重试中…（共 ${VIDEO_MAX_RETRIES} 次）`,
      });
      await new Promise<void>((r) => setTimeout(r, VIDEO_RETRY_DELAY_MS));
      if (signal?.aborted) throw new Error("Pipeline cancelled.");
    }

    try {
      const result = await generateVideo(
        opts,
        (progress) => {
          useProjectStore.getState().updateShot(shotId, { videoProgress: progress });
        },
        signal,
      );
      useProjectStore.getState().updateShot(shotId, {
        videoUrl: result.videoUrl,
        videoRetryCount: attempt,
        error: undefined,
      });
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (!isRetriableError(lastError) || attempt === VIDEO_MAX_RETRIES) {
        store.setShotStatus(
          shotId,
          "failed",
          attempt > 0
            ? `已重试 ${attempt} 次仍失败: ${lastError.message}`
            : lastError.message,
        );
        throw lastError;
      }
    }
  }

  throw lastError ?? new Error("Video generation failed after retries.");
}

/**
 * Check if an error is transient and worth retrying.
 */
function isRetriableError(err: Error): boolean {
  const msg = err.message.toLowerCase();
  if (msg.includes("failed to fetch") || msg.includes("networkerror")) return true;
  if (msg.includes("timeout") || msg.includes("aborted")) return true;
  if (/error 5\d{2}/.test(msg)) return true;
  if (msg.includes("ssl") || msg.includes("econnrefused") || msg.includes("enetunreach")) return true;
  return false;
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

async function runParallel<T>(
  items: T[],
  concurrency: number,
  signal: AbortSignal | undefined,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;

  async function worker() {
    while (index < items.length) {
      if (signal?.aborted) throw new Error("Pipeline cancelled.");
      const current = index++;
      await fn(items[current]);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  const results = await Promise.allSettled(workers);
  const firstFailure = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
  if (firstFailure) throw firstFailure.reason;
}







