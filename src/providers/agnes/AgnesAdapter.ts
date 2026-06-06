// ────────────────────────────────────────────────────────────────────────────
// src/providers/agnes/AgnesAdapter.ts
// Concrete ModelProvider implementation for the Agnes AI API gateway.
// Implements text, image, and video generation via a unified interface.
// ────────────────────────────────────────────────────────────────────────────

import type {
  ModelProvider,
  AIModel,
  TextParams,
  ImageParams,
  VideoParams,
  TextResult,
  ImageResult,
  VideoTaskStatus,
} from "../types";

export class AgnesAdapter implements ModelProvider {
  readonly name = "Agnes AI";

  /* ── Model discovery ──────────────────────────────────────────────────── */

  async discover(apiKey: string, baseUrl: string): Promise<AIModel[]> {
    try {
      const resp = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!resp.ok) return [];
      const json = await resp.json();
      const models: AIModel[] = (json.data ?? []).map((m: Record<string, unknown>) => {
        const arch = m.architecture as Record<string, unknown> | undefined;
        const routing = m.routing as Record<string, unknown> | undefined;
        const pricing = m.pricing as Record<string, number> | undefined;
        const constraints = m.constraints as Record<string, unknown> | undefined;

        let modality: AIModel["modality"] = "text";
        const rawModality = arch?.modality as string ?? "";
        if (rawModality.includes("video")) modality = "video";
        else if (rawModality.includes("image")) modality = "image";

        return {
          id: m.id as string,
          name: m.name as string,
          description: m.description as string ?? "",
          modality,
          endpoint: routing?.endpoint as string ?? "",
          mode: (routing?.mode as string) === "async" ? "async" : "sync",
          maxContextLength: m.context_length as number | undefined,
          pricing: pricing
            ? {
                prompt: pricing.prompt,
                completion: pricing.completion,
                image: pricing.image,
                video: pricing.video,
              }
            : undefined,
          constraints: constraints
            ? {
                maxFrames: constraints.max_frames as number | undefined,
                fpsRange: constraints.fps_range as [number, number] | undefined,
              }
            : undefined,
        };
      });
      return models;
    } catch {
      return [];
    }
  }

  /* ── Text generation ──────────────────────────────────────────────────── */

  async generateText(
    apiKey: string,
    baseUrl: string,
    params: TextParams,
  ): Promise<TextResult> {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: params.model,
        messages: [
          ...(params.systemPrompt
            ? [{ role: "system", content: params.systemPrompt }]
            : []),
          { role: "user", content: params.prompt },
        ],
        temperature: params.temperature,
        max_tokens: params.maxTokens,
        stream: params.stream ?? false,
        ...params.extraBody,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`Text API error ${resp.status}: ${body}`);
    }

    const json = await resp.json();
    const choice = json.choices?.[0];
    return {
      content: choice?.message?.content ?? "",
      finishReason: choice?.finish_reason,
      usage: json.usage
        ? {
            promptTokens: json.usage.prompt_tokens,
            completionTokens: json.usage.completion_tokens,
            totalTokens: json.usage.total_tokens,
          }
        : undefined,
    };
  }

  /* ── Image generation ─────────────────────────────────────────────────── */

  async generateImage(
    apiKey: string,
    baseUrl: string,
    params: ImageParams,
  ): Promise<ImageResult> {
    const body: Record<string, unknown> = {
      model: params.model,
      prompt: params.prompt,
      size: params.size ?? "1024x1024",
      // Always request base64 output so we can store it locally
      return_base64: true,
    };

    // Per Agnes Image API: input image (URL or data URI) goes in top-level `image` array
    if (params.inputImageUrl) {
      body.image = [params.inputImageUrl];
    }

    body.extra_body = {
      ...(params.extraBody ?? {}),
    };

    const resp = await fetch(`${baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Image API error ${resp.status}: ${text}`);
    }

    const json = await resp.json();
    const img = json.data?.[0];
    return {
      url: img?.url ?? img?.b64_json ?? "",
      revisedPrompt: img?.revised_prompt,
    };
  }

  /* ── Video: create async task ─────────────────────────────────────────── */

  async createVideoTask(
    apiKey: string,
    baseUrl: string,
    params: VideoParams,
  ): Promise<string> {
    const body: Record<string, unknown> = {
      model: params.model,
      prompt: params.prompt,
      num_frames: params.numFrames,
      frame_rate: params.fps,
    };

    if (params.width) body.width = params.width;
    if (params.height) body.height = params.height;
    if (params.seed !== undefined) body.seed = params.seed;

    // Per Agnes Video API docs:
    // - Single image (img2video): top-level "image" as a string
    // - Multi-image / keyframes: "extra_body.image" as array + mode
    if (params.imageUrls && params.imageUrls.length > 0) {
      body.extra_body = {
        ...(params.extraBody ?? {}),
        image: params.imageUrls,
        mode: params.mode === "keyframe" ? "keyframes" : "ti2vid",
      };
    } else if (params.imageUrl) {
      body.image = params.imageUrl;
    }

    const resp = await fetch(`${baseUrl}/videos`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Video create error ${resp.status}: ${text}`);
    }

    const json = await resp.json();
    const taskId: string | undefined = json.task_id ?? json.id;
    if (!taskId) throw new Error("Video API did not return a task_id.");
    return taskId;
  }

  /* ── Video: poll task ─────────────────────────────────────────────────── */

  async pollVideoTask(
    apiKey: string,
    baseUrl: string,
    taskId: string,
  ): Promise<VideoTaskStatus> {
    const resp = await fetch(`${baseUrl}/videos/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Video poll error ${resp.status}: ${text}`);
    }

    const json = await resp.json();
    const rawStatus: string = json.status ?? "pending";

    let status: VideoTaskStatus["status"];
    switch (rawStatus) {
      case "pending":
      case "queued":
        status = "pending";
        break;
      case "processing":
      case "running":
        status = "processing";
        break;
      case "completed":
      case "succeeded":
        status = "completed";
        break;
      case "failed":
      case "cancelled":
        status = "failed";
        break;
      default:
        status = "pending";
    }

    return {
      taskId,
      status,
      progress: json.progress ?? 0,
      videoUrl: json.video_url ?? json.output?.video_url,
      coverImageUrl: json.cover_image_url,
      duration: json.seconds ?? json.output?.duration ?? json.duration,
      error: json.error ?? undefined,
      usage: json.usage
        ? { videoFrames: json.usage.total_frames ?? json.usage.video_frames }
        : undefined,
    };
  }
}

