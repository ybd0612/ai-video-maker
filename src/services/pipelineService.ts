// ────────────────────────────────────────────────────────────────────────────
// src/services/pipelineService.ts
// Orchestrates the four-phase video pipeline: script → image → video → render.
// ────────────────────────────────────────────────────────────────────────────

import { useProjectStore, type Shot } from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { generateScript } from "./scriptService";
import { generateImage, aspectRatioToImageSize } from "./imageService";
import { generateVideo, aspectRatioToVideoSize } from "./videoService";

type PipelinePhase = "script" | "image" | "video" | "render";

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
  const project = store.project;
  if (!project) throw new Error("No active project.");

  const imageSize = aspectRatioToImageSize(project.aspectRatio);
  const videoSize = aspectRatioToVideoSize(project.aspectRatio);

  // ── Phase 1: Script ─────────────────────────────────────────────────────
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

  // ── Phase 2: Images (parallel, max 3 concurrent) ────────────────────────
  opts.onPhaseStart?.("image");
  store.setProjectStatus("imaging");

  const shotsAfterScript = useProjectStore.getState().project!.shots;

  try {
    await runParallel(shotsAfterScript, 3, opts.signal, async (shot) => {
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
    const anyFailed = useProjectStore.getState().project!.shots.some((s) => s.status === "failed");
    if (anyFailed) {
      store.setProjectStatus("failed", "Some shots failed during image generation.");
      return;
    }
  }

  // ── Phase 3: Videos (parallel, max 2 concurrent) ────────────────────────
  opts.onPhaseStart?.("video");
  store.setProjectStatus("videoing");

  const shotsAfterImage = useProjectStore.getState().project!.shots;

  try {
    await runParallel(shotsAfterImage, 2, opts.signal, async (shot) => {
      store.setShotStatus(shot.id, "videoing");
      opts.onShotUpdate?.(shot.id, "videoing");

      try {
        const result = await generateVideo(
          {
            apiKey,
            baseUrl,
            prompt: shot.visualPrompt,
            imageUrl: shot.imageUrl,
            size: videoSize,
            duration: shot.duration,
          },
          (_progress) => {
            // Could update progress in store if needed
          },
          opts.signal,
        );

        store.updateShot(shot.id, { videoUrl: result.videoUrl, status: "videoed" });
        opts.onShotUpdate?.(shot.id, "videoed", { videoUrl: result.videoUrl });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        store.setShotStatus(shot.id, "failed", msg);
        opts.onShotUpdate?.(shot.id, "failed", { error: msg });
        throw err;
      }
    });
  } catch {
    const anyFailed = useProjectStore.getState().project!.shots.some((s) => s.status === "failed");
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
  const project = store.project;
  if (!project) throw new Error("No active project.");

  const shot = project.shots.find((s) => s.id === shotId);
  if (!shot) throw new Error("Shot not found.");

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
    const result = await generateVideo(
      {
        apiKey,
        baseUrl,
        prompt: shot.visualPrompt,
        imageUrl,
        size: videoSize,
        duration: shot.duration,
      },
      undefined,
      opts.signal,
    );
    store.updateShot(shotId, { videoUrl: result.videoUrl, status: "videoed" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    store.setShotStatus(shotId, "failed", msg);
    throw err;
  }
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
  await Promise.all(workers);
}






