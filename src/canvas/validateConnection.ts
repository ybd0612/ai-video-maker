// ────────────────────────────────────────────────────────────────────────────
// src/canvas/validateConnection.ts
// Rule-based handle verification for React Flow's isValidConnection prop.
// ────────────────────────────────────────────────────────────────────────────

import type { Connection, Node, Edge } from "@xyflow/react";
import {
  ALLOWED_CONNECTIONS,
  NODE_HANDLES,
  type HandleSpec,
} from "./types";

/* ── Helpers ────────────────────────────────────────────────────────────── */

function resolveHandle(
  nodeId: string,
  handleId: string | null,
  direction: "source" | "target",
  nodes: Node<Record<string, unknown>>[],
): HandleSpec | undefined {
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return undefined;

  const handles = NODE_HANDLES[node.type ?? ""];
  if (!handles) return undefined;

  return handles.find(
    (h) => h.id === handleId && h.direction === direction,
  );
}

/* ── Main validator ─────────────────────────────────────────────────────── */

export function validateCanvasConnection(
  connection: Connection,
  nodes: Node<Record<string, unknown>>[],
  existingEdges?: Edge[],
): boolean {
  const { source, target, sourceHandle, targetHandle } = connection;

  if (source === target) return false;

  const srcHandle = resolveHandle(source, sourceHandle, "source", nodes);
  const tgtHandle = resolveHandle(target, targetHandle, "target", nodes);

  if (!srcHandle || !tgtHandle) return false;

  if (existingEdges) {
    const isDuplicate = existingEdges.some(
      (e) =>
        e.source === source &&
        e.target === target &&
        e.sourceHandle === sourceHandle &&
        e.targetHandle === targetHandle,
    );
    if (isDuplicate) return false;
  }

  return ALLOWED_CONNECTIONS.some(
    (rule) =>
      rule.sourceDataType === srcHandle.dataType &&
      rule.targetDataType === tgtHandle.dataType,
  );
}

/**
 * Returns a human-readable rejection reason (or `null` when valid).
 */
export function explainRejection(
  connection: Connection,
  nodes: Node<Record<string, unknown>>[],
): string | null {
  const { source, target, sourceHandle, targetHandle } = connection;

  if (source === target) return "Cannot connect a node to itself.";

  const srcHandle = resolveHandle(source, sourceHandle, "source", nodes);
  const tgtHandle = resolveHandle(target, targetHandle, "target", nodes);

  if (!srcHandle) return "Unknown source handle.";
  if (!tgtHandle) return "Unknown target handle.";

  const allowed = ALLOWED_CONNECTIONS.find(
    (rule) =>
      rule.sourceDataType === srcHandle.dataType &&
      rule.targetDataType === tgtHandle.dataType,
  );

  if (!allowed) {
    return `Cannot connect ${srcHandle.dataType} output to ${tgtHandle.dataType} input.`;
  }

  return null;
}
