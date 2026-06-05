// ────────────────────────────────────────────────────────────────────────────
// src/canvas/edges/TypedEdge.tsx
// Edge with color based on data type and animated style for running status.
// ────────────────────────────────────────────────────────────────────────────

import { memo } from "react";
import { BaseEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react";

const HANDLE_COLORS: Record<string, string> = {
  "text-in": "#38bdf8",
  "text-out": "#38bdf8",
  "prompt-out": "#34d399",
  "image-in": "#a78bfa",
  "image-out": "#a78bfa",
  "video-in": "#fbbf24",
  "video-out": "#fbbf24",
};

function TypedEdgeInner({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  sourceHandleId,
  style,
  markerEnd,
}: EdgeProps) {
  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 16,
  });

  const color = HANDLE_COLORS[sourceHandleId ?? ""] ?? "#64748b";

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      markerEnd={markerEnd}
      style={{
        ...style,
        stroke: color,
        strokeWidth: 1.5,
      }}
    />
  );
}

export const TypedEdge = memo(TypedEdgeInner);
