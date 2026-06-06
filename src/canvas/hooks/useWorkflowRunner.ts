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

const VIDEO_POLL_INTERVAL_MS = 3_000;
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
  };

  // Per Agnes Image API docs:
  // - Input image (URL or data URI) goes in top-level `image` array
  // - For base64 output: set `return_base64: true` at top level
  // - `response_format` goes inside `extra_body` (NOT top-level)
  if (params.inputImageUrl) {
    body.image = [params.inputImageUrl];
  }

  // Always request base64 output so we can store it locally
  body.return_base64 = true;

  body.extra_body = {
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
  // b64_json comes back as raw base64; convert to data URL for display
  let url = img?.url ?? "";
  if (img?.b64_json) {
    url = `data:image/png;base64,${img.b64_json}`;
  }
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
  const taskId: string | undefined = json.task_id ?? json.id;
    const videoId: string | undefined = json.video_id;
  if (!taskId) throw new Error(getTranslation("error.videoCreateNoTaskId"));
    return videoId ?? taskId;
}

async function callVideoPollAPI(apiKey: string, _baseUrl: string, taskId: string): Promise<VideoTaskStatus> {
    const pollUrl = taskId.startsWith("video_") ? `${resolveBaseUrl(_baseUrl)}/agnesapi?video_id=${taskId}` : `${resolveBaseUrl(_baseUrl)}/videos/${taskId}`;
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
    case "processing": case "running": status = "processing"; break;
    case "completed": case "succeeded": status = "completed"; break;
    case "failed": case "cancelled": status = "failed"; break;
    default: status = "pending";
  }

  return {
    taskId,
    status,
    progress: json.progress ?? 0,
    videoUrl: json.video_url ?? json.output?.video_url,
    coverImageUrl: json.cover_image_url,
    duration: json.seconds ?? json.output?.duration ?? json.duration,
    error: json.error ?? undefined,
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
            case "image": {
              const data = nodeData as ImageNodeData;
              const imagePrompt = inputs.textInputs.length > 0
                ? inputs.textInputs.join("\n\n")
                : data.prompt;

              if (!imagePrompt) throw new LocalizedError("error.noImagePrompt");

              const result = await callImageAPI(apiKey, baseUrl, {
                model: data.modelId ?? "agnes-image-2.1-flash",
                prompt: imagePrompt,
                inputImageUrl: inputs.imageInputs[0],
                size: `${data.width}x${data.height}`,
                quality: data.quality,

              });

              store.updateNodeData(nodeId, {
                outputUrl: result.url,
                revisedPrompt: result.revisedPrompt,
                executionStatus: "success",
                errorMessage: undefined,
              });
              store.appendNodeLog(nodeId, log("info", getTranslation("log.imageGeneratedSuccess")));
              break;
            }

            /* ── VIDEO ────────────────────────────────────────────── */
            case "video": {
              const data = nodeData as VideoNodeData;
              const videoPrompt = inputs.textInputs.length > 0
                ? inputs.textInputs.join("\n\n")
                : data.prompt;

              if (!videoPrompt) throw new LocalizedError("error.noVideoPrompt");

              const taskId = await callVideoCreateAPI(apiKey, baseUrl, {
                model: data.modelId ?? "agnes-video-v2.0",
                prompt: videoPrompt,
                negativePrompt: data.negativePrompt as string | undefined,
                imageUrl: inputs.imageInputs[0],
                imageUrls: inputs.imageInputs.length > 1 ? inputs.imageInputs : undefined,
                width: data.width,
                height: data.height,
                numFrames: calcNumFrames(data.duration ?? 5, data.fps),
                fps: data.fps,
                mode: data.mode,
                seed: data.seed,
              });

              store.updateNodeData(nodeId, { taskId, taskProgress: 0 });
              store.appendNodeLog(nodeId, log("info", getTranslation("log.videoTaskCreated", { taskId })));

              /* Poll until completion or timeout */
              const deadline = Date.now() + VIDEO_POLL_TIMEOUT_MS;
              let finalStatus: VideoTaskStatus | undefined;

              while (Date.now() < deadline) {
                if (opts.signal?.aborted) throw new Error(getTranslation("error.videoPollCancelled"));

                await new Promise<void>((r) => setTimeout(r, VIDEO_POLL_INTERVAL_MS));
                finalStatus = await callVideoPollAPI(apiKey, baseUrl, taskId);

                store.updateNodeData(nodeId, { taskProgress: finalStatus.progress });
                store.appendNodeLog(nodeId, log("info", getTranslation("log.videoProgress", { progress: finalStatus.progress, status: finalStatus.status })));

                if (finalStatus.status === "completed") break;
                if (finalStatus.status === "failed") {
                  throw new Error(getTranslation("error.videoGenerationFailed", { reason: finalStatus.error ?? "unknown error" }));
                }
              }

              if (!finalStatus || finalStatus.status !== "completed") {
                throw new Error(getTranslation("error.videoGenerationTimedOut"));
              }

              store.updateNodeData(nodeId, {
                outputUrl: finalStatus.videoUrl,
                coverImageUrl: finalStatus.coverImageUrl,
                duration: finalStatus.duration,
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

  return { run, cancel, retryFailed };
}


