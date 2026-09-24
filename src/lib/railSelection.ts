// ────────────────────────────────────────────────────────────────────────────
// src/lib/railSelection.ts
// 镜头轨选中态纯逻辑：页面只持有 currentId，移动规则集中在此以便单测。
// ────────────────────────────────────────────────────────────────────────────

export function moveSelection(
  ids: readonly string[],
  currentId: string | undefined,
  delta: 1 | -1,
): string | undefined {
  const first = ids[0];
  if (first === undefined) return undefined;
  const at = currentId === undefined ? -1 : ids.indexOf(currentId);
  if (at < 0) return first;
  const next = Math.min(ids.length - 1, Math.max(0, at + delta));
  return ids[next];
}

/** 镜头增删后校正选中项，避免详情区指向已不存在的镜头 */
export function syncSelectionWithShots(
  ids: readonly string[],
  currentId: string | undefined,
): string | undefined {
  if (currentId && ids.includes(currentId)) return currentId;
  return ids[0];
}
