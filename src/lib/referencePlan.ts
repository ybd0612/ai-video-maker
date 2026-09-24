// ────────────────────────────────────────────────────────────────────────────
// src/lib/referencePlan.ts
// 把「哪几张参考图进了请求、哪几张被为什么拒了」讲清楚。
// accepted 直接复用 pickShotReferences —— 绝不重算一遍额度，
// 否则解释与实际请求会随时间分叉。
// ────────────────────────────────────────────────────────────────────────────

import { MAX_REFERENCES_BY_SIZE, pickShotReferences } from "@/lib/promptComposer";
import type { Asset, Shot } from "@/stores/projectTypes";

export interface RejectedReference {
  assetId: string;
  name: string;
  because: "size-budget" | "total-budget";
}

export interface ReferenceAssignment {
  accepted: string[];
  rejected: RejectedReference[];
}

export function explainShotReferences(
  shot: Shot,
  project: { assets: Asset[]; styleReferenceUrl?: string },
): ReferenceAssignment {
  const accepted = pickShotReferences(shot, project);
  const acceptedSet = new Set(accepted);
  const budget = MAX_REFERENCES_BY_SIZE[shot.shotSize ?? "unknown"];
  const rejected: RejectedReference[] = [];

  // 与 pickShotReferences 同一资格口径：角色可用 avatarUrl 兜底，且产品与角色共用角色额度
  let charUsed = 0;
  let propUsed = 0;

  const collect = (
    ids: readonly string[] | undefined,
    assetType: Asset["type"],
    kind: "character" | "prop",
  ): void => {
    const cap = kind === "character" ? budget.characters : budget.props;
    for (const id of ids ?? []) {
      const asset = project.assets.find((a) => a.id === id && a.type === assetType);
      if (!asset) continue;
      const url = asset.imageUrl ?? (assetType === "character" ? asset.avatarUrl : undefined);
      if (!url) continue;
      const used = kind === "character" ? charUsed : propUsed;
      if (acceptedSet.has(url)) {
        if (kind === "character") charUsed += 1;
        else propUsed += 1;
        continue;
      }
      rejected.push({
        assetId: id,
        name: asset.name,
        because: used >= cap ? "size-budget" : "total-budget",
      });
    }
  };

  collect(shot.activeCharacterIds, "character", "character");
  collect(shot.activeProductIds, "product", "character");
  collect(shot.activePropIds, "prop", "prop");
  return { accepted, rejected };
}
