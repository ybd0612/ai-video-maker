// ────────────────────────────────────────────────────────────────────────────
// src/lib/shotReferences.ts
// 模型返回的分镜资产引用归一化与项目资产解析。
// ────────────────────────────────────────────────────────────────────────────

import type { Asset, AssetType } from "@/stores/projectStore";

/** 将模型返回的单个资产引用转换为可匹配的字符串 token。 */
export function toIdRef(value: unknown): string | undefined {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized || undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;

  const object = value as Record<string, unknown>;
  for (const key of ["id", "assetId", "name"]) {
    const ref = toIdRef(object[key]);
    if (ref) return ref;
  }
  return undefined;
}

/** 将单值、数组或对象形态统一为去重后的引用列表。 */
export function toIdRefList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of values) {
    const ref = toIdRef(item);
    if (!ref) continue;
    const key = ref.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ref);
  }

  return result;
}

/** 按真实资产 ID 或资产名称解析单个引用。 */
export function resolveAssetId(
  ref: unknown,
  assets: Asset[],
  type: AssetType,
): string | undefined {
  const token = toIdRef(ref);
  if (!token) return undefined;

  const candidates = assets.filter((asset) => asset.type === type);
  const direct = candidates.find((asset) => asset.id === token);
  if (direct) return direct.id;

  const normalized = token.toLocaleLowerCase();
  return candidates.find((asset) => asset.name.trim().toLocaleLowerCase() === normalized)?.id;
}

/** 按真实资产 ID 或资产名称解析列表引用。 */
export function resolveAssetIds(
  refs: unknown,
  assets: Asset[],
  type: AssetType,
): string[] {
  return toIdRefList(refs)
    .map((ref) => resolveAssetId(ref, assets, type))
    .filter((id): id is string => Boolean(id));
}

