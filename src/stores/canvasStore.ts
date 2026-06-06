// ────────────────────────────────────────────────────────────────────────────
// src/stores/canvasStore.ts
// Zustand store with localForage persistence for the infinite canvas.
// Large binary outputs (image blobs, video files) are persisted to IndexedDB
// under a content-addressed key rather than stuffed into the store state.
// ────────────────────────────────────────────────────────────────────────────

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import localforage from "localforage";
import type { Node, Edge, Viewport } from "@xyflow/react";
import type {
  AnyNodeData,
  NodeExecutionStatus,
  NodeExecutionLog,
} from "@/canvas/types";

/** Flag to prevent local→store sync during external load */
export let canvasLoadInProgress = false;

/* ── IndexedDB storage instances ────────────────────────────────────────── */

const graphStore = localforage.createInstance({
  name: "wxhb",
  storeName: "canvas-graph",
});

const blobStore = localforage.createInstance({
  name: "wxhb",
  storeName: "canvas-blobs",
});

/* ── Zustand ↔ localForage adapter ──────────────────────────────────────── */

/**
 * We store nodes as `Node<Record<string, unknown>>[]` in the store
 * to satisfy React Flow v12's generic constraint.
 * Cast to/from `AnyNodeData` at the boundary.
 */
type StoreNode = Node<Record<string, unknown>>;

const localForageStorage = createJSONStorage<CanvasState>(() => ({
  getItem: async (name) => {
    const value = await graphStore.getItem<string>(name);
    return value ?? null;
  },
  setItem: async (name, value) => {
    await graphStore.setItem(name, value);
  },
  removeItem: async (name) => {
    await graphStore.removeItem(name);
  },
}));

/* ── Blob helpers (exported for use by adapters / runners) ──────────────── */

export async function persistBlob(key: string, data: Blob | ArrayBuffer): Promise<string> {
  await blobStore.setItem(key, data);
  return key;
}

export async function retrieveBlob(key: string): Promise<Blob | ArrayBuffer | null> {
  return blobStore.getItem(key);
}

export async function deleteBlob(key: string): Promise<void> {
  await blobStore.removeItem(key);
}

/* ── Store state shape ──────────────────────────────────────────────────── */

interface CanvasState {
  nodes: StoreNode[];
  edges: Edge[];
  viewport: Viewport;
  setNodes: (nodes: StoreNode[]) => void;
  setEdges: (edges: Edge[]) => void;
  setViewport: (viewport: Viewport) => void;

  addNode: (node: StoreNode) => void;
  removeNode: (nodeId: string) => void;
  updateNodeData: (nodeId: string, data: Partial<AnyNodeData>) => void;

  setNodeExecutionStatus: (nodeId: string, status: NodeExecutionStatus) => void;
  appendNodeLog: (nodeId: string, log: NodeExecutionLog) => void;
  setNodeErrorMessage: (nodeId: string, message: string | undefined) => void;

  cascadeNodeStates: (
    updates: Array<{
      nodeId: string;
      status: NodeExecutionStatus;
      errorMessage?: string;
      errorKey?: string;
      errorParams?: Record<string, string | number>;
      log?: NodeExecutionLog;
    }>,
  ) => void;

  resetExecutionStates: () => void;
  clearAll: () => Promise<void>;
  loadSnapshot: (snapshot: { nodes: StoreNode[]; edges: Edge[]; viewport: Viewport }) => void;
}

/* ── Store creation ─────────────────────────────────────────────────────── */

export const useCanvasStore = create<CanvasState>()(
  persist(
    (set) => ({
      /* ── Initial state ────────────────────────────────────────────────── */
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },

      /* ── Graph mutations ──────────────────────────────────────────────── */

      setNodes: (nodes) => set({ nodes }),
      setEdges: (edges) => set({ edges }),
      setViewport: (viewport) => set({ viewport }),

      addNode: (node) =>
        set((state) => ({ nodes: [...state.nodes, node] })),

      removeNode: (nodeId) =>
        set((state) => ({
          nodes: state.nodes.filter((n) => n.id !== nodeId),
          edges: state.edges.filter(
            (e) => e.source !== nodeId && e.target !== nodeId,
          ),
        })),

      updateNodeData: (nodeId, data) =>
        set((state) => ({
          nodes: state.nodes.map((n) => {
            if (n.id !== nodeId) return n;
            return {
              ...n,
              data: { ...n.data, ...data },
            };
          }),
        })),

      /* ── Execution state mutations ─────────────────────────────────────── */

      setNodeExecutionStatus: (nodeId, status) =>
        set((state) => ({
          nodes: state.nodes.map((n) => {
            if (n.id !== nodeId) return n;
            return {
              ...n,
              data: { ...n.data, executionStatus: status },
            };
          }),
        })),

      appendNodeLog: (nodeId, log) =>
        set((state) => ({
          nodes: state.nodes.map((n) => {
            if (n.id !== nodeId) return n;
            const prevLogs = (n.data.executionLogs as NodeExecutionLog[] | undefined) ?? [];
            return {
              ...n,
              data: {
                ...n.data,
                executionLogs: [...prevLogs, log],
              },
            };
          }),
        })),

      setNodeErrorMessage: (nodeId, message) =>
        set((state) => ({
          nodes: state.nodes.map((n) => {
            if (n.id !== nodeId) return n;
            return {
              ...n,
              data: { ...n.data, errorMessage: message },
            };
          }),
        })),

      cascadeNodeStates: (updates) =>
        set((state) => {
          const updateMap = new Map(updates.map((u) => [u.nodeId, u]));
          return {
            nodes: state.nodes.map((n) => {
              const upd = updateMap.get(n.id);
              if (!upd) return n;
              const prevLogs = (n.data.executionLogs as NodeExecutionLog[] | undefined) ?? [];
              const newLog = upd.log ? [...prevLogs, upd.log] : prevLogs;
              return {
                ...n,
                data: {
                  ...n.data,
                  executionStatus: upd.status,
                  errorMessage: upd.errorMessage,
                  errorKey: upd.errorKey,
                  errorParams: upd.errorParams,
                  executionLogs: newLog,
                },
              };
            }),
          };
        }),

      resetExecutionStates: () =>
        set((state) => ({
          nodes: state.nodes.map((n) => ({
            ...n,
            data: {
              ...n.data,
              errorKey: undefined,
              errorParams: undefined,
              executionStatus: "idle" as NodeExecutionStatus,
              executionLogs: [],
              errorMessage: undefined,
            },
          })),
        })),

      /* ── Provider config ───────────────────────────────────────────────── */



      /* ── Clear everything ──────────────────────────────────────────────── */

      loadSnapshot: (snapshot: { nodes: StoreNode[]; edges: Edge[]; viewport: Viewport }) => {
        canvasLoadInProgress = true;
        set({
          nodes: snapshot.nodes,
          edges: snapshot.edges,
          viewport: snapshot.viewport,
        });
        setTimeout(() => { canvasLoadInProgress = false; }, 200);
      },

      clearAll: async () => {
        await graphStore.clear();
        await blobStore.clear();
        set({
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        });
      },
    }),
    {
      name: "wxhb-canvas-graph",
      storage: localForageStorage as ReturnType<typeof createJSONStorage<CanvasState>> /* eslint-disable-next-line @typescript-eslint/no-explicit-any */ as any,
      partialize: (state) => ({
        nodes: state.nodes,
        edges: state.edges,
        viewport: state.viewport,
      }),
    },
  ),
);

