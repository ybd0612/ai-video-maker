// ────────────────────────────────────────────────────────────────────────────
// src/canvas/hooks/useWorkflowRunner.ts
// Topological workflow execution engine with cycle detection,
// partial (downstream-only) execution, and circuit-breaker error propagation.
// ────────────────────────────────────────────────────────────────────────────

import { useCallback, useRef } from "react";
import type { Node, Edge } from "@xyflow/react";
import { useCanvasStore } from "@/stores/canvasStore";
import { useSettingsStore } from "@/stores/settingsStore";
import type {
  AnyNodeData,
  TextNodeData,
  ImageNodeData,
  VideoNodeData,
  PromptNodeData,
  UploadNodeData,
  NodeExecutionLog,
} from "@/canvas/types";
import type {
  TextParams,
  ImageParams,
  VideoParams,
  TextResult,
  ImageResult,
  VideoTaskStatus,
} from "@/providers/types";
import { resolveBaseUrl } from "@/lib/resolveBaseUrl";
import { calcNumFrames } from "@/lib/validation";
import { getTranslation } from "@/i18n";

/* ── Constants ──────────────────────────────────────────────────────────── */

const VIDEO_POLL_INTERVAL_MS = 5_000;
const VIDEO_POLL_TIMEOUT_MS = 10 * 60 * 1000;

type RFNode = Node<Record<string, unknown>>;

class LocalizedError extends Error {
  errorKey: string;
  errorParams?: Record<string, string | number>;
  constructor(key: string, params?: Record<string, string | number>) {
    super(getTranslation(key as Parameters<typeof getTranslation>[0], params));
    this.errorKey = key;
    this.errorParams = params;
  }
}

/* ── Cycle detection (DFS) ──────────────────────────────────────────────── */

function detectCycle(nodes: RFNode[], edges: Edge[]): { hasCycle: boolean; cyclePath: string[] } {
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    const list = adj.get(e.source);
    if (list) list.push(e.target);
  }

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const parent = new Map<string, string | null>();
  for (const n of nodes) {
    color.set(n.id, WHITE);
    parent.set(n.id, null);
  }

  const cyclePath: string[] = [];

  function dfs(u: string): boolean {
    color.set(u, GRAY);
    for (const v of adj.get(u) ?? []) {
      if (color.get(v) === GRAY) {
        cyclePath.push(v);
        let cur = u;
        while (cur !== v) {
          cyclePath.push(cur);
          cur = parent.get(cur) ?? v;
        }
        cyclePath.push(v);
        cyclePath.reverse();
        return true;
      }
      if (color.get(v) === WHITE) {
        parent.set(v, u);
        if (dfs(v)) return true;
      }
    }
    color.set(u, BLACK);
    return false;
  }

  for (const n of nodes) {
    if (color.get(n.id) === WHITE && dfs(n.id)) {
      return { hasCycle: true, cyclePath };
    }
  }

  return { hasCycle: false, cyclePath: [] };
}

/* ── Topological sort (Kahn's algorithm) ────────────────────────────────── */

function topoSort(nodes: RFNode[], edges: Edge[]): string[] {
  const inDeg = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const n of nodes) {
    inDeg.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of edges) {
    adj.get(e.source)?.push(e.target);
    inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDeg) {
    if (deg === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const u = queue.shift()!;
    sorted.push(u);
    for (const v of adj.get(u) ?? []) {
      const newDeg = (inDeg.get(v) ?? 1) - 1;
      inDeg.set(v, newDeg);
      if (newDeg === 0) queue.push(v);
    }
  }

  return sorted;
}

/* ── Downstream discovery (BFS) ─────────────────────────────────────────── */

function findDownstream(startId: string, edges: Edge[]): Set<string> {
  const downstream = new Set<string>();
  const queue = [startId];
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e.target);
  }

  while (queue.length > 0) {
    const u = queue.shift()!;
    for (const v of adj.get(u) ?? []) {
      if (!downstream.has(v)) {
        downstream.add(v);
        queue.push(v);
      }
    }
  }

  return downstream;
}

/* ── Gather upstream outputs for a node ──────────────────────────────────── */

function gatherInputs(
  nodeId: string,
  edges: Edge[],
): { textInputs: string[]; imageInputs: string[]; videoInputs: string[] } {
  const textInputs: string[] = [];
  const imageInputs: string[] = [];
  const videoInputs: string[] = [];

  const incoming = edges.filter((e) => e.target === nodeId);
  for (const edge of incoming) {
    /* Read from the live store to pick up outputs written by upstream nodes
       that executed earlier in this same run. */
    const liveState = useCanvasStore.getState();
    const srcNode = liveState.nodes.find((n: RFNode) => n.id === edge.source);
    if (!srcNode) continue;
    const data = srcNode.data as unknown as AnyNodeData;

    switch (srcNode.type) {
      case "prompt": {
        const pd = data as PromptNodeData;
        if (pd.prompt) textInputs.push(pd.prompt);
        break;
      }
      case "text": {
        const td = data as TextNodeData;
        if (td.output) textInputs.push(td.output);
        break;
      }
      case "image": {
        const id = data as ImageNodeData;
        if (id.outputUrl) imageInputs.push(id.outputUrl);
        break;
      }
      case "video": {
        const vd = data as VideoNodeData;
        if (vd.outputUrl) videoInputs.push(vd.outputUrl);
        break;
      }
      case "upload": {
        const ud = data as UploadNodeData;
        if (ud.base64Data) imageInputs.push(ud.base64Data);
        else if (ud.imageUrl) imageInputs.push(ud.imageUrl);
        break;
      }
    }
  }

  return { textInputs, imageInputs, videoInputs };
}

/* ── Log factory ────────────────────────────────────────────────────────── */

function log(level: NodeExecutionLog["level"], message: string): NodeExecutionLog {
  return { timestamp: Date.now(), level, message };
}

/* ── REST helpers ───────────────────────────────────────────────────────── */

async function callTextAPI(apiKey: string, _baseUrl: string, params: TextParams): Promise<TextResult> {
  const resp = await fetch(`${resolveBaseUrl(_baseUrl)}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: params.model,
      messages: [
        ...(params.systemPrompt ? [{ role: "system", content: params.systemPrompt }] : []),
        { role: "user", content: params.prompt },
      ],
      temperature: params.temperature,
      max_tokens: params.maxTokens,
      stream: false,
      ...params.extraBody,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(getTranslation("error.apiError", { status: String(resp.status), detail: body }));
  }

  const json = await resp.json();
  const choice = json.choices?.[0];
  return {
    content: choice?.message?.content ?? "",
    finishReason: choice?.finish_reason,
    usage: json.usage
      ? { promptTokens: json.usage.prompt_tokens, completionTokens: json.usage.completion_tokens, totalTokens: json.usage.total_tokens }
      : undefined,
  };
}

async function callImageAPI(apiKey: string, _baseUrl: string, params: ImageParams): Promise<ImageResult> {
  const body: Record<string, unknown> = {
    model: params.model,
    prompt: params.prompt,
    size: params.size ?? "1024x1024",
    ...(params.quality ? { quality: params.quality } : {}),
  };

  // Per Agnes Image API docs:
  // - Input image (URL or data URI) goes in top-level `image` array
  // - For base64 output: set `return_base64: true` at top level
  // - `response_format` goes inside `extra_body` (NOT top-level)
  if (params.inputImageUrl) {
    body.image = [params.inputImageUrl];
  }



  body.extra_body = {
    response_format: "url",
    ...(params.extraBody ?? {}),
  };

  const resp = await fetch(`${resolveBaseUrl(_baseUrl)}/images/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(getTranslation("error.apiError", { status: String(resp.status), detail: text }));
  }

  const json = await resp.json();
  const img = json.data?.[0];
  const url = img?.url ?? "";
  return { url, revisedPrompt: img?.revised_prompt };
}

async function callVideoCreateAPI(apiKey: string, _baseUrl: string, params: VideoParams): Promise<string> {
  const body: Record<string, unknown> = {
    model: params.model,
    prompt: params.prompt,
    ...(params.negativePrompt ? { negative_prompt: params.negativePrompt } : {}),
    num_frames: params.numFrames,
    frame_rate: params.fps,
  };

  if (params.width) body.width = params.width;
  if (params.height) body.height = params.height;
  if (params.seed !== undefined) body.seed = params.seed;

  // Per Agnes Video API docs:
  // - Single image (img2video): top-level "image" as a string
  // - Multi-image / keyframes: "extra_body.image" as an array + "extra_body.mode"
  if (params.imageUrls && params.imageUrls.length > 0) {
    body.extra_body = {
      ...(params.extraBody ?? {}),
      image: params.imageUrls,
      mode: params.mode === "keyframe" ? "keyframes" : "ti2vid",
    };
  } else if (params.imageUrl) {
    body.image = params.imageUrl;
  }

  const resp = await fetch(`${resolveBaseUrl(_baseUrl)}/videos`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(getTranslation("error.apiError", { status: String(resp.status), detail: text }));
  }

  const json = await resp.json();
  const videoId: string | undefined = json.video_id ?? json.task_id ?? json.id;
  if (!videoId) throw new Error(getTranslation("error.videoCreateNoVideoId"));
  return videoId;

}

async function callVideoPollAPI(apiKey: string, _baseUrl: string, videoId: string): Promise<VideoTaskStatus> {
  // Recommended: use video_id query (endpoint has no /v1 prefix)
  // Fallback: use /v1/videos/{task_id} for backward compat
  const strippedBase = resolveBaseUrl(_baseUrl).replace(/\/v1$/, "");
  const pollUrl = videoId.startsWith("video_")
    ? `${strippedBase}/agnesapi?video_id=${videoId}`
    : `${resolveBaseUrl(_baseUrl)}/videos/${videoId}`;
  const resp = await fetch(pollUrl, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(getTranslation("error.apiError", { status: String(resp.status), detail: text }));
  }

  const json = await resp.json();
  const rawStatus: string = json.status ?? "pending";

  let status: VideoTaskStatus["status"];
  switch (rawStatus) {
    case "pending": case "queued": status = "pending"; break;
    case "processing": case "running": case "in_progress": status = "processing"; break;
    case "completed": case "succeeded": status = "completed"; break;
    case "failed": case "cancelled": status = "failed"; break;
    default: status = "pending";
  }

  // Per Agnes docs, video URL is in `remixed_from_video_id` when completed
  const videoUrl = json.remixed_from_video_id ?? json.video_url ?? json.output?.video_url ?? "";

  return {
    videoId,
    status,
    progress: json.progress ?? 0,
    videoUrl,
    coverImageUrl: json.cover_image_url,
    duration: json.seconds ?? json.output?.duration ?? json.duration,
    error: typeof json.error === "string" ? json.error : json.error?.message ?? (json.error ? JSON.stringify(json.error) : undefined),
    usage: json.usage ? { videoFrames: json.usage.total_frames ?? json.usage.video_frames } : undefined,
  };
}
/* ── Runner hook ─────────────────────────────────────────────────────────── */

export interface WorkflowRunOptions {
  startNodeId?: string;
  signal?: AbortSignal;
}

export interface WorkflowRunResult {
  success: boolean;
  executedNodeIds: string[];
  failedNodeId?: string;
  error?: string;
}

export function useWorkflowRunner() {
  const isRunningRef = useRef(false);

  const runWorkflow = useCallback(
    async (opts: WorkflowRunOptions = {}): Promise<WorkflowRunResult> => {
      if (isRunningRef.current) {
        return { success: false, executedNodeIds: [], error: "A workflow is already running." };
      }
      isRunningRef.current = true;

      const store = useCanvasStore.getState();
      const { nodes, edges } = store;
      const { providerConfig } = useSettingsStore.getState();
      const { apiKey, baseUrl } = providerConfig;

      if (!apiKey) {
        isRunningRef.current = false;
        return { success: false, executedNodeIds: [], error: "API key is not configured. Open Settings to add your key." };
      }

      /* ── Cycle detection ──────────────────────────────────────────── */
      const cycleCheck = detectCycle(nodes, edges);
      if (cycleCheck.hasCycle) {
        isRunningRef.current = false;
        return { success: false, executedNodeIds: [], error: `Workflow contains a cycle: ${cycleCheck.cyclePath.join(" → ")}` };
      }

      /* ── Determine execution scope ───────────────────────────────── */
      const downstream = opts.startNodeId != null
        ? findDownstream(opts.startNodeId, edges)
        : new Set(nodes.map((n) => n.id));

      if (opts.startNodeId) downstream.add(opts.startNodeId);

      /* ── Topological sort ────────────────────────────────────────── */
      const fullOrder = topoSort(nodes, edges);
      const execOrder = fullOrder.filter((id) => downstream.has(id));

      const nodeMap = new Map(nodes.map((n) => [n.id, n]));
      const executed: string[] = [];

      /* ── Reset execution states for nodes in scope ───────────────── */
      store.cascadeNodeStates(
        execOrder.map((id) => ({
          nodeId: id,
          status: "idle" as const,
          errorMessage: undefined,
          log: log("info", getTranslation("log.queuedForExecution")),
        })),
      );

      /* ── Sequential execution with circuit breaker ───────────────── */
      let failedNodeId: string | undefined;
      let failureMessage: string | undefined;

      for (const nodeId of execOrder) {
        if (opts.signal?.aborted) {
          failureMessage = "Workflow cancelled by user.";
          break;
        }

        const node = nodeMap.get(nodeId);
        if (!node) continue;

        /* ── Cascade failure from upstream ─────────────────────────── */
        if (failedNodeId) {
          store.cascadeNodeStates([{
            nodeId,
            status: "failed",
            errorMessage: `Upstream dependency "${failedNodeId}" failed.`,
            errorKey: "error.upstreamFailed",
            errorParams: { nodeId: failedNodeId },
            log: log("error", getTranslation("log.skippedUpstreamFailure")),
          }]);
          executed.push(nodeId);
          continue;
        }

        store.setNodeExecutionStatus(nodeId, "pending");
        store.appendNodeLog(nodeId, log("info", getTranslation("log.executionStarted")));

        const inputs = gatherInputs(nodeId, edges);
        /* Re-read node data from the live store so upstream outputs are fresh */
        const liveNode = useCanvasStore.getState().nodes.find((n: RFNode) => n.id === nodeId);
        const nodeData = (liveNode?.data ?? node.data) as unknown as AnyNodeData;

        try {
          switch (node.type) {
            /* ---- UPLOAD (image container, no execution needed) ---- */
            case "upload": {
              const ud = nodeData as UploadNodeData;
              const hasUpstream = inputs.imageInputs.length > 0;
              if (hasUpstream && !ud.base64Data) {
                store.updateNodeData(nodeId, {
                  imageUrl: inputs.imageInputs[0],
                  executionStatus: "success",
                  errorMessage: undefined,
                });
              } else {
                store.setNodeExecutionStatus(nodeId, "success");
              }
              break;
            }

            /* ── TEXT / PROMPT ─────────────────────────────────────── */
            case "prompt":
            case "text": {
              const data = nodeData as TextNodeData | PromptNodeData;
              const textPrompt = inputs.textInputs.length > 0
                ? inputs.textInputs.join("\n\n")
                : ("prompt" in data ? data.prompt : "");

              if (!textPrompt) throw new LocalizedError("error.noPromptText");

              const result = await callTextAPI(apiKey, baseUrl, {
                model: (("modelId" in data ? (data as TextNodeData).modelId : undefined)) ?? "agnes-2.0-flash",
                prompt: textPrompt,
                systemPrompt: "systemPrompt" in data ? data.systemPrompt : undefined,
                temperature: "temperature" in data ? (data as TextNodeData).temperature : 0.7,
                maxTokens: "maxTokens" in data ? (data as TextNodeData).maxTokens : 1024,
              });

              store.updateNodeData(nodeId, {
                output: result.content,
                finishReason: result.finishReason,
                executionStatus: "success",
                errorMessage: undefined,
              });
              store.appendNodeLog(nodeId, log("info", getTranslation("log.generatedChars", { count: result.content.length })));
              break;
            }

            /* ── IMAGE ────────────────────────────────────────────── */
            /* ── IMAGE ────────────────────────────────────────────── */
            case "image": {
              const data = nodeData as ImageNodeData;
              const imagePrompt = inputs.textInputs.length > 0
                ? inputs.textInputs.join("\n\n")
                : data.prompt;

              if (!imagePrompt) throw new LocalizedError("error.noImagePrompt");

              const imageCount = data.count ?? 1;
              const imageUrls: (string | undefined)[] = new Array(imageCount).fill(undefined);
              let lastRevisedPrompt: string | undefined;

              // Initialize pendingUrls with empty slots for real-time rendering
              store.updateNodeData(nodeId, {
                pendingUrls: new Array(imageCount).fill(undefined),
                executionStatus: "pending" as const,
                errorMessage: undefined,
              });

              if (imageCount > 1) {
                store.appendNodeLog(nodeId, log("info", getTranslation("log.imageBatchStart", { total: String(imageCount) })));
              }

              // Fire all requests concurrently
              const tasks = Array.from({ length: imageCount }, (_, i) => i);
              const settled = await Promise.allSettled(
                tasks.map(async (i) => {
                  if (opts.signal?.aborted) throw new Error("Cancelled");
                  const result = await callImageAPI(apiKey, baseUrl, {
                    model: data.modelId ?? "agnes-image-2.1-flash",
                    prompt: imagePrompt,
                    inputImageUrl: inputs.imageInputs[0] ?? data.referenceImageUrl,
                    size: data.size,
                    quality: data.quality,
                  });
                  let url = result.url;
                  if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
                    url = "https://" + url;
                  }
                  return { index: i, url, revisedPrompt: result.revisedPrompt };
                }),
              );

              // Process results: update UI as each finishes, collect errors
              let hasAnySuccess = false;
              const errors: string[] = [];
              for (const result of settled) {
                if (result.status === "fulfilled") {
                  const { index, url, revisedPrompt } = result.value;
                  imageUrls[index] = url;
                  if (revisedPrompt) lastRevisedPrompt = revisedPrompt;
                  hasAnySuccess = true;
                  // Real-time update: write partial results so ImageNode renders immediately
                  store.updateNodeData(nodeId, {
                    pendingUrls: [...imageUrls],
                    outputUrl: imageUrls.find(Boolean),
                    outputUrls: imageUrls.filter(Boolean) as string[],
                    revisedPrompt: lastRevisedPrompt,
                  });
                  store.appendNodeLog(nodeId, log("info", getTranslation("log.imageSingleReady", { current: String(index + 1), total: String(imageCount) })));
                } else {
                  errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
                }
              }

              // If all failed, throw
              if (!hasAnySuccess) {
                throw new Error(errors[0] ?? getTranslation("error.imageGenerationFailed"));
              }

              const validUrls = imageUrls.filter(Boolean) as string[];
              store.updateNodeData(nodeId, {
                outputUrl: validUrls[0],
                outputUrls: validUrls,
                pendingUrls: undefined,
                revisedPrompt: lastRevisedPrompt,
                executionStatus: "success" as const,
                errorMessage: errors.length > 0 ? errors.join("; ") : undefined,
              });
              store.appendNodeLog(nodeId, log("info", getTranslation("log.imageGeneratedSuccess")));

              // Output routing: distribute or auto-create
              if (validUrls.length > 0) {
                const downstreamImageEdges = store.edges.filter(
                  (e) => e.source === nodeId && e.sourceHandle === "image-out"
                );
                const downstreamImageNodes = downstreamImageEdges
                  .map((e) => store.nodes.find((n) => n.id === e.target))
                  .filter((n): n is RFNode => n != null && (n.type === "image" || n.type === "upload"));

                if (downstreamImageNodes.length > 0) {
                  const count = Math.min(validUrls.length, downstreamImageNodes.length);
                  for (let di = 0; di < count; di++) {
                    store.updateNodeData(downstreamImageNodes[di].id, {
                      imageUrl: validUrls[di],
                      executionStatus: "success" as const,
                      executionLogs: [] as NodeExecutionLog[],
                    });
                  }
                  store.appendNodeLog(nodeId, log("info", getTranslation("log.imageDistributed", { count: String(count) })));
                } else {
                  const sourceNode = store.nodes.find((n) => n.id === nodeId);
                  const sourcePos = sourceNode?.position ?? { x: 0, y: 0 };
                  const nodeWidth = 320;
                  const gapX = 60;
                  const newEdges: Edge[] = [];

                  for (let gi = 0; gi < validUrls.length; gi++) {
                    const outNodeId = `upload__auto_${Date.now()}_${gi}`;
                    const outNode: RFNode = {
                      id: outNodeId,
                      type: "upload",
                      position: {
                        x: sourcePos.x + nodeWidth + gapX,
                        y: sourcePos.y + gi * 360,
                      },
                      data: {
                        label: `${data.label || "Image"} #${gi + 1}`,
                        imageUrl: validUrls[gi],
                        executionStatus: "success" as const,
                        executionLogs: [] as NodeExecutionLog[],
                      } as unknown as Record<string, unknown>,
                    };
                    store.addNode(outNode);

                    newEdges.push({
                      id: `edge__auto_${Date.now()}_${gi}`,
                      source: nodeId,
                      sourceHandle: "image-out",
                      target: outNodeId,
                      targetHandle: "image-in",
                      type: "typed",
                      animated: true,
                    });
                  }

                  if (newEdges.length > 0) {
                    store.setEdges([...store.edges, ...newEdges]);
                  }
                  store.appendNodeLog(nodeId, log("info", getTranslation("log.imageAutoCreated", { count: String(validUrls.length) })));
                }
              }

              break;
            }
/* ── VIDEO ────────────────────────────────────────────── */
            case "video": {
              const data = nodeData as VideoNodeData;
              const videoPrompt = inputs.textInputs.length > 0
                ? inputs.textInputs.join("\n\n")
                : data.prompt;

              if (!videoPrompt) throw new LocalizedError("error.noVideoPrompt");

              // Parse size string to width and height
              const sizeParts = data.size === "auto" ? [] : data.size.split("x").map(Number);
              const width = sizeParts[0];
              const height = sizeParts[1];

              const videoCount = data.count ?? 1;
              const effectiveSeed = (data.seed && data.seed > 0) ? data.seed : undefined;
              const outputUrlsArr: string[] = [];
              const coverUrlsArr: string[] = [];
              let lastDuration: number | undefined;

              for (let vi = 0; vi < videoCount; vi++) {
                if (opts.signal?.aborted) throw new Error("Cancelled");
                if (videoCount > 1) {
                  store.appendNodeLog(nodeId, log("info", getTranslation("log.videoBatchProgress", { current: vi + 1, total: videoCount })));
                }

                const newVideoId = await callVideoCreateAPI(apiKey, baseUrl, {
                  model: data.modelId ?? "agnes-video-v2.0",
                  prompt: videoPrompt,
                  negativePrompt: data.negativePrompt as string | undefined,
                  imageUrl: inputs.imageInputs[0],
                  imageUrls: inputs.imageInputs.length > 1 ? inputs.imageInputs : undefined,
                  width: width,
                  height: height,
                  numFrames: calcNumFrames(data.duration ?? 5, data.fps),
                  fps: data.fps,
                  mode: data.mode,
                  seed: effectiveSeed,
                });

                store.updateNodeData(nodeId, { videoId: newVideoId, taskProgress: 0 });
                store.appendNodeLog(nodeId, log("info", getTranslation("log.videoCreated", { videoId: newVideoId })));

                /* Poll until completion or timeout */
                const deadline = Date.now() + VIDEO_POLL_TIMEOUT_MS;
                let finalStatus: VideoTaskStatus | undefined;

                while (Date.now() < deadline) {
                  if (opts.signal?.aborted) throw new Error(getTranslation("error.videoPollCancelled"));

                  await new Promise<void>((r) => setTimeout(r, VIDEO_POLL_INTERVAL_MS));
                  finalStatus = await callVideoPollAPI(apiKey, baseUrl, newVideoId);

                  store.updateNodeData(nodeId, { taskProgress: finalStatus.progress });
                  store.appendNodeLog(nodeId, log("info", getTranslation("log.videoProgress", { progress: finalStatus.progress, status: finalStatus.status })));

                  if (finalStatus.status === "completed") break;
                  if (finalStatus.status === "failed") {
                    throw new Error(getTranslation("error.videoGenerationFailed", { reason: (typeof finalStatus.error === "string" ? finalStatus.error : finalStatus.error ? JSON.stringify(finalStatus.error) : "unknown error") }));
                  }
                }

                if (!finalStatus || finalStatus.status !== "completed") {
                  throw new Error(getTranslation("error.videoGenerationTimedOut"));
                }

                // Ensure video URL has protocol
                let videoUrl = finalStatus.videoUrl ?? "";
                if (videoUrl && !videoUrl.startsWith("http://") && !videoUrl.startsWith("https://")) {
                  videoUrl = "https://" + videoUrl;
                }
                let coverUrl = finalStatus.coverImageUrl ?? "";
                if (coverUrl && !coverUrl.startsWith("http://") && !coverUrl.startsWith("https://")) {
                  coverUrl = "https://" + coverUrl;
                }

                outputUrlsArr.push(videoUrl);
                if (coverUrl) coverUrlsArr.push(coverUrl);
                lastDuration = finalStatus.duration;
              }

              store.updateNodeData(nodeId, {
                outputUrl: outputUrlsArr[0],
                outputUrls: outputUrlsArr,
                coverImageUrl: coverUrlsArr[0],
                coverImageUrls: coverUrlsArr,
                duration: lastDuration,
                taskProgress: 100,
                executionStatus: "success",
                errorMessage: undefined,
              });
              store.appendNodeLog(nodeId, log("info", getTranslation("log.videoCompleted")));
              break;
            }

            default:
              throw new Error(getTranslation("error.unknownNodeType", { type: String(node.type) }));
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const isLocalized = err instanceof LocalizedError;
          failedNodeId = nodeId;
          failureMessage = message;

          store.cascadeNodeStates([{
            nodeId,
            status: "failed",
            errorMessage: message,
            errorKey: isLocalized ? err.errorKey : undefined,
            errorParams: isLocalized ? err.errorParams : undefined,
            log: log("error", getTranslation("log.failed", { message })),
          }]);
        }

        executed.push(nodeId);
      }

      isRunningRef.current = false;
      return {
        success: failedNodeId === undefined,
        executedNodeIds: executed,
        failedNodeId,
        error: failureMessage,
      };
    },
    [],
  );

  const cancelRef = useRef<AbortController | null>(null);

  const run = useCallback(
    async (opts: Omit<WorkflowRunOptions, "signal"> = {}) => {
      cancelRef.current?.abort();
      const controller = new AbortController();
      cancelRef.current = controller;
      return runWorkflow({ ...opts, signal: controller.signal });
    },
    [runWorkflow],
  );

  const cancel = useCallback(() => {
    cancelRef.current?.abort();
    cancelRef.current = null;
  }, []);

  const retryFailed = useCallback(
    async (opts: Omit<WorkflowRunOptions, "signal"> = {}) => {
      const store = useCanvasStore.getState();
      const failedNodes = store.nodes.filter((n) => {
        const d = n.data as unknown as AnyNodeData;
        return d.executionStatus === "failed";
      });

      if (failedNodes.length === 0) return { success: true, executedNodeIds: [], failedNodeId: undefined, error: undefined };

      // Collect all failed node ids + their downstream
      const toRetry = new Set<string>();
      for (const n of failedNodes) {
        toRetry.add(n.id);
        for (const ds of findDownstream(n.id, store.edges)) {
          toRetry.add(ds);
        }
      }

      // Reset failed and downstream nodes to idle
      store.cascadeNodeStates(
        [...toRetry].map((id) => ({ nodeId: id, status: "idle" as const })),
      );

      // Re-run from each original failed node
      cancelRef.current?.abort();
      const controller = new AbortController();
      cancelRef.current = controller;

      let lastResult: { success: boolean; executedNodeIds: string[]; failedNodeId?: string; error?: string } | undefined;
      for (const n of failedNodes) {
        lastResult = await runWorkflow({ ...opts, startNodeId: n.id, signal: controller.signal });
        if (!lastResult.success) break;
      }

      return lastResult ?? { success: true, executedNodeIds: [], failedNodeId: undefined, error: undefined };
    },
    [runWorkflow],
  );

  const resumePendingVideoPolls = useCallback(
    async () => {
      const store = useCanvasStore.getState();
      const pendingVideoNodes = store.nodes.filter((n) => {
        const d = n.data as unknown as AnyNodeData;
        return n.type === "video" && d.executionStatus === "pending" && "videoId" in d && (d as VideoNodeData).videoId;
      });

      if (pendingVideoNodes.length === 0) return;

      const { providerConfig } = useSettingsStore.getState();
      const { apiKey, baseUrl } = providerConfig;
      if (!apiKey || !baseUrl) return;

      for (const node of pendingVideoNodes) {
        const data = node.data as unknown as VideoNodeData;
        const vid = data.videoId!;
        const nodeLog = (level: NodeExecutionLog["level"], message: string): NodeExecutionLog => ({ timestamp: Date.now(), level, message });

        store.appendNodeLog(node.id, nodeLog("info", getTranslation("log.videoResumingPoll", { videoId: vid })));

        const deadline = Date.now() + VIDEO_POLL_TIMEOUT_MS;
        let finalStatus: VideoTaskStatus | undefined;

        try {
          while (Date.now() < deadline) {
            await new Promise<void>((r) => setTimeout(r, VIDEO_POLL_INTERVAL_MS));
            finalStatus = await callVideoPollAPI(apiKey, baseUrl, vid);

            store.updateNodeData(node.id, { taskProgress: finalStatus.progress });
            store.appendNodeLog(node.id, nodeLog("info", getTranslation("log.videoProgress", { progress: finalStatus.progress, status: finalStatus.status })));

            if (finalStatus.status === "completed") break;
            if (finalStatus.status === "failed") {
              throw new Error(getTranslation("error.videoGenerationFailed", { reason: (typeof finalStatus.error === "string" ? finalStatus.error : finalStatus.error ? JSON.stringify(finalStatus.error) : "unknown error") }));
            }
          }

          if (!finalStatus || finalStatus.status !== "completed") {
            throw new Error(getTranslation("error.videoGenerationTimedOut"));
          }

          let videoUrl = finalStatus.videoUrl ?? "";
          if (videoUrl && !videoUrl.startsWith("http://") && !videoUrl.startsWith("https://")) {
            videoUrl = "https://" + videoUrl;
          }
          let coverUrl = finalStatus.coverImageUrl ?? "";
          if (coverUrl && !coverUrl.startsWith("http://") && !coverUrl.startsWith("https://")) {
            coverUrl = "https://" + coverUrl;
          }

          store.updateNodeData(node.id, {
            outputUrl: videoUrl,
            outputUrls: [videoUrl],
            coverImageUrl: coverUrl,
            coverImageUrls: coverUrl ? [coverUrl] : undefined,
            duration: finalStatus.duration,
            taskProgress: 100,
            executionStatus: "success",
            errorMessage: undefined,
          });
          store.appendNodeLog(node.id, nodeLog("info", getTranslation("log.videoCompleted")));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          store.cascadeNodeStates([{
            nodeId: node.id,
            status: "failed",
            errorMessage: message,
            log: nodeLog("error", getTranslation("log.failed", { message })),
          }]);
        }
      }
    },
    [],
  );

  return { run, cancel, retryFailed, resumePendingVideoPolls };
}


