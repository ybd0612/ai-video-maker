// ────────────────────────────────────────────────────────────────────────────
// src/canvas/CanvasWorkspace.tsx
// The main infinite canvas — wires up React Flow with custom nodes/edges,
// connection validation, drag-to-add, and workflow execution.
// ────────────────────────────────────────────────────────────────────────────

import { useCallback, useRef, useEffect, useState } from "react";
import {
  applyEdgeChanges,
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  BackgroundVariant,
  type Node,
  type Edge,
  type OnConnect,
  type OnNodesChange,
  type Connection,
  type OnEdgesChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { nodeTypes } from "./nodes";
import { edgeTypes } from "./edges";
import { validateCanvasConnection } from "./validateConnection";
import { useCanvasStore, canvasLoadInProgress } from "@/stores/canvasStore";
import { useTaskStore } from "@/stores/taskStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkflowRunner } from './hooks/useWorkflowRunner';
import { useT } from '@/i18n';
import { ContextMenu, type ContextMenuItem } from "@/components/ui/ContextMenu";
import { MessageSquare, Type, ImageIcon, Film, Upload, Trash2 } from "lucide-react";
import { PropertiesPanel } from "./panels/PropertiesPanel";
import {
  createDefaultPromptNodeData,
  createDefaultTextNodeData,
  createDefaultImageNodeData,
  createDefaultVideoNodeData,
  createDefaultUploadNodeData,
} from "./types";

/* ── Node type registry for drag-and-drop ───────────────────────────────── */

function getNodeFactories(t: (key: string, vars?: Record<string, unknown>) => string) {
  return {
    prompt: () => createDefaultPromptNodeData(t),
    text: () => createDefaultTextNodeData(t),
    image: () => createDefaultImageNodeData(t),
    video: () => createDefaultVideoNodeData(t),
    upload: () => createDefaultUploadNodeData(t),
  } as const;
}



type NodeFactories = ReturnType<typeof getNodeFactories>;
type DragNodeType = keyof NodeFactories;

type RFNode = Node<Record<string, unknown>>;

let nodeIdCounter = 0;
function nextNodeId(type: string): string {
  nodeIdCounter += 1;
  return `${type}__${nodeIdCounter}`;
}


/* ── Outer wrapper: provides ReactFlowProvider ──────────────────────────── */

export function CanvasWorkspace() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}


/* ── Inner component: uses useReactFlow() safely ────────────────────────── */

function CanvasInner() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);

  /* ── Track sync direction to prevent infinite loops ───────────────────── */
  const syncingFromStore = useRef(false);
  const syncingFromLocal = useRef(false);

  /* ── Zustand store ────────────────────────────────────────────────────── */
  const storeNodes = useCanvasStore((s) => s.nodes);
  const storeEdges = useCanvasStore((s) => s.edges);
  const setStoreNodes = useCanvasStore((s) => s.setNodes);
  const setStoreEdges = useCanvasStore((s) => s.setEdges);
  const addStoreNode = useCanvasStore((s) => s.addNode);
  const showGrid = useSettingsStore((s) => s.showGrid);
  const t = useT();
  const showMinimap = useSettingsStore((s) => s.showMinimap);

  /* ── React Flow instance for coordinate conversion ────────────────────── */
  const { screenToFlowPosition, setViewport, fitView: rfFitView } = useReactFlow();

  /* ── React Flow local state ───────────────────────────────────────────── */
  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode>(storeNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(storeEdges);

  /* Sync store → local when store changes externally (e.g., workflow runner) */
  useEffect(() => {
    if (syncingFromLocal.current) {
      syncingFromLocal.current = false;
      return;
    }
    syncingFromStore.current = true;
    setNodes(storeNodes);
  }, [storeNodes, setNodes]);

  useEffect(() => {
    if (syncingFromLocal.current) {
      syncingFromLocal.current = false;
      return;
    }
    syncingFromStore.current = true;
    setEdges(storeEdges);
  }, [storeEdges, setEdges]);


  /* ── Auto-save to active task whenever nodes/edges change ────────────── */
  const activeTaskId = useTaskStore((s) => s.activeTaskId);
  const updateTask = useTaskStore((s) => s.updateTask);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!activeTaskId) return;
    // Debounce: save 500ms after last change
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      updateTask(activeTaskId, {
        canvasData: {
          nodes,
          edges,
          viewport: { x: 0, y: 0, zoom: 1 },
          capturedAt: Date.now(),
        },
      });
    }, 500);
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [nodes, edges, activeTaskId, updateTask]);
  /* Initial fitView on mount */
  const didInitFit = useRef(false);
  useEffect(() => {
    if (!didInitFit.current) {
      didInitFit.current = true;
      // Only fitView if there are nodes but no saved viewport
      const { nodes: storeN, viewport: vp } = useCanvasStore.getState();
      if (storeN.length > 0 && (vp.x !== 0 || vp.y !== 0 || vp.zoom !== 1)) {
        setViewport(vp);
      } else if (storeN.length > 0) {
        rfFitView({ padding: 0.2 });
      }
    }
  });

  /* Restore viewport when active task changes (after loadSnapshot) */
  const prevActiveTaskId = useRef<string | null>(null);
  useEffect(() => {
    if (activeTaskId && activeTaskId !== prevActiveTaskId.current) {
      // Small delay to let nodes/edges render first
      setTimeout(() => {
        const store = useCanvasStore.getState();
        const vp = store.viewport;
        if (vp && (vp.x !== 0 || vp.y !== 0 || vp.zoom !== 1)) {
          setViewport(vp, { duration: 300 });
        } else {
          // No saved viewport — fit to nodes
          rfFitView({ padding: 0.2, duration: 300 });
        }
      }, 50);
    }
    prevActiveTaskId.current = activeTaskId;
  }, [activeTaskId, setViewport, rfFitView]);

  /* Sync local → store when React Flow changes (drag, connect, etc.)
     Skip if an external loadSnapshot is in progress to prevent overwriting. */
  useEffect(() => {
    if (canvasLoadInProgress) return;
    if (syncingFromStore.current) {
      syncingFromStore.current = false;
      return;
    }
    syncingFromLocal.current = true;
    setStoreNodes(nodes);
  }, [nodes, setStoreNodes]);

  useEffect(() => {
    if (canvasLoadInProgress) return;
    if (syncingFromStore.current) {
      syncingFromStore.current = false;
      return;
    }
    syncingFromLocal.current = true;
    setStoreEdges(edges);
  }, [edges, setStoreEdges]);

  /* ── Node changes ─────────────────────────────────────────────────────── */
  const handleNodesChange: OnNodesChange<RFNode> = useCallback(
    (changes) => {
      onNodesChange(changes);
    },
    [onNodesChange],
  );

  const handleEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      onEdgesChange(changes);

      const hasRemoval = changes.some((c) => c.type === "remove");
      if (hasRemoval) {
        setEdges((eds) => {
          const next = applyEdgeChanges(changes, eds);
          syncingFromLocal.current = true;
          setStoreEdges(next);
          return next;
        });
      }
    },
    [onEdgesChange, setEdges, setStoreEdges],
  );

  /* ── Connection handler ───────────────────────────────────────────────── */
  const onConnect: OnConnect = useCallback(
    (connection) => {
      const isValid = validateCanvasConnection(connection, nodes, edges);
      if (!isValid) return;
      const typedEdge: Edge = {
        ...connection,
        id: `edge__${Date.now()}_${Math.random().toString(16).slice(2,8)}`,
        type: "typed",
        animated: true,
      };
      setEdges((eds) => addEdge(typedEdge, eds));
    },
    [nodes, edges, setEdges],
  );

  /* ── Node selection ───────────────────────────────────────────────────── */
  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      setSelectedNodeId(node.id);
    },
    [],
  );

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setEdges((eds) => eds.map((e) => ({ ...e, selected: false })));
  }, [setEdges]);

  /* ── Drag-and-drop ────────────────────────────────────────────────────── */
  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const factories = getNodeFactories(t as (key: string, vars?: Record<string, unknown>) => string);
      const nodeType = event.dataTransfer.getData("application/wxhb-node") as DragNodeType;
      if (!nodeType || !(nodeType in factories)) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNode: RFNode = {
        id: nextNodeId(nodeType),
        type: nodeType,
        position,
        data: factories[nodeType as DragNodeType](),
      };

      addStoreNode(newNode);
      setNodes((nds) => [...nds, newNode]);
    },
    [addStoreNode, setNodes, screenToFlowPosition, t],
  );

  /* ── Workflow runner ──────────────────────────────────────────────────── */
  const { run, retryFailed } = useWorkflowRunner();

  const hasFailedNodes = nodes.some((n) => (n.data as Record<string, unknown>).executionStatus === "failed");

  const handleRetryFailed = useCallback(async () => {
    setStoreNodes(nodes);
    setStoreEdges(edges);
    await retryFailed();
  }, [retryFailed, nodes, edges, setStoreNodes, setStoreEdges]);

  const handleRunAll = useCallback(async () => {
    setStoreNodes(nodes);
    setStoreEdges(edges);
    await run();
  }, [run, nodes, edges, setStoreNodes, setStoreEdges]);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;

  return (
    <div
      ref={reactFlowWrapper}
      className="h-full w-full"
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onPaneContextMenu={(event) => {
          event.preventDefault();
          const pos = screenToFlowPosition({ x: event.clientX, y: event.clientY });
          const factories = getNodeFactories(t as (key: string, vars?: Record<string, unknown>) => string);
          const iconMap: Record<string, typeof MessageSquare> = { prompt: MessageSquare, text: Type, image: ImageIcon, video: Film, upload: Upload };
          const colorMap: Record<string, string> = { prompt: "text-emerald-400", text: "text-sky-400", image: "text-violet-400", video: "text-amber-400", upload: "text-rose-400" };
          const labelMap: Record<string, string> = { prompt: t("palette.prompt"), text: t("palette.text"), image: t("palette.image"), video: t("palette.video"), upload: t("palette.upload") };
          const items: ContextMenuItem[] = Object.keys(factories).map((key) => ({
            label: labelMap[key] ?? key,
            icon: (() => { const Icon = iconMap[key]; return Icon ? <Icon size={13} /> : null; })(),
            color: colorMap[key],
            onClick: () => {
              const type = key as DragNodeType;
              const newNode: RFNode = {
                id: nextNodeId(type),
                type,
                position: pos,
                data: factories[type](),
              };
              addStoreNode(newNode);
              setNodes((nds) => [...nds, newNode]);
            },
          }));
          setContextMenu({ x: event.clientX, y: event.clientY, items });
        }}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        isValidConnection={(conn) => validateCanvasConnection(conn as Connection, nodes, edges)}
        deleteKeyCode={["Backspace", "Delete"]}
        onEdgeClick={(_event, edge) => {
          setSelectedNodeId(null);
          setEdges((eds) =>
            eds.map((e) => ({
              ...e,
              selected: e.id === edge.id,
            })),
          );
        }}
        onEdgeContextMenu={(event, edge) => {
          event.preventDefault();
          setContextMenu({
            x: event.clientX,
            y: event.clientY,
            items: [{
              label: t("contextMenu.deleteEdge"),
              icon: <Trash2 size={13} />,
              color: "text-red-400",
              onClick: () => setEdges((eds) => eds.filter((e) => e.id !== edge.id)),
            }],
          });
        }}

        snapToGrid
        className="bg-slate-950"
        defaultEdgeOptions={{
          type: "typed",
          animated: true,
        }}
      >
        {showGrid && (
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
            color="#1e293b"
          />
        )}
        {showMinimap && (
          <MiniMap
            nodeStrokeColor="#64748b"
            nodeColor={(node) => {
              const colors: Record<string, string> = {
                prompt: "#10b981",
                text: "#38bdf8",
                image: "#a78bfa",
                video: "#fbbf24",
                upload: "#fb7185",
              };
              return colors[node.type as string] ?? "#475569";
            }}
            maskColor="rgba(0,0,0,0.7)"
            pannable
            zoomable
          />
        )}
        <Controls className="controls !bg-slate-900/90 !text-slate-200 !border !border-slate-700 !shadow-xl" showZoom showFitView showInteractive={false} />
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={contextMenu.items}
            onClose={() => setContextMenu(null)}
          />
        )}
      </ReactFlow>

      {/* Floating run button */}
      <div className="absolute bottom-6 left-1/2 z-50 -translate-x-1/2 flex items-center gap-3">
        <button
          onClick={handleRunAll}
          className="rounded-full bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:bg-emerald-500 active:scale-95"
        >
          {t("canvas.runWorkflow")}
        </button>
        {hasFailedNodes && (
          <button
            onClick={handleRetryFailed}
            className="flex items-center gap-1.5 rounded-full bg-amber-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:bg-amber-500 active:scale-95"
          >
            {t("canvas.retryFailed")}
          </button>
        )}
      </div>

      {/* Right-side properties panel */}
      <PropertiesPanel
        node={selectedNode}
        onClose={() => setSelectedNodeId(null)}
      />
    </div>
  );
}