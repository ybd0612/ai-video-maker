// ────────────────────────────────────────────────────────────────────────────
// src/lib/extractAssets.ts
// 纯函数：把模型输出的资产（characters/products/scenes/styles）转成可入库的
// Asset 记录，并按名字去重。
//
// ⚠️ 去重基准语义（2026-09-12 事故沉淀）：
// - 追加式场景（分镜生成补建新资产）：dedupeAgainst = 全部旧资产 —— 同名跳过；
// - 替换式场景（想法 → 重新提取）：dedupeAgainst 必须只传 **manual 资产**。
//   旧 extracted 资产即将被整体替换，若参与去重，模型输出的同名新资产会被
//   误判"已存在"而跳过，随后替换写回又清掉旧资产 → 角色凭空消失
//   （实测事故：提取明明返回 2 个角色，写回后一个都不剩）。
// ────────────────────────────────────────────────────────────────────────────

import { newId, type Asset, type AssetType } from "@/stores/projectStore";
import { generateAssetNamespace, generateFullPrompt } from "@/lib/assetNamespace";

/** 模型输出的资产条目（提取/分镜共用的原始形态；style 仅 name+description） */
export interface RawAsset {
  name: string;
  description: string;
  appearancePrompt?: string;
}

/**
 * Build unique Asset records from model output without mutating inputs.
 * 返回 name→id 映射表：模型可能在 shots/dialogues 中使用自编 ID 引用角色，
 * 调用方需据此回填引用，保证对白归属与角色一致性。
 * 角色/产品/场景/风格共用此函数（type 区分）。
 * style 分支不走 appearancePrompt/namespace/fullPrompt：
 * prompt（英文 stylePrompt）为 L2 派生物，运行期由 ensureStyleAsset 懒派生。
 *
 * @param dedupeAgainst 去重基准：追加式传全部旧资产（默认）；
 *                      替换式只传 manual 资产（见顶部语义说明）。
 */
export function extractNewAssets(
  existing: Asset[],
  incoming: RawAsset[],
  type: AssetType,
  dedupeAgainst: Asset[] = existing,
): { assets: Asset[]; idByName: Map<string, string> } {
  const names = new Set(dedupeAgainst.map((a) => a.name.trim().toLocaleLowerCase()));
  const assets: Asset[] = [];
  const idByName = new Map<string, string>();
  for (const item of incoming) {
    const normalizedName = item.name.trim().toLocaleLowerCase();
    if (!normalizedName || names.has(normalizedName)) continue;
    names.add(normalizedName);
    const record: Asset = {
      id: newId("asset"),
      type,
      source: "extracted",
      name: item.name,
      description: item.description,
      prompt: type === "style" ? "" : (item.appearancePrompt ?? ""),
      ...(type === "character"
        ? {
            appearancePrompt: item.appearancePrompt ?? "",
            assetNamespace: generateAssetNamespace(item.name),
            fullPrompt: generateFullPrompt({
              name: item.name,
              appearancePrompt: item.appearancePrompt ?? "",
            }),
          }
        : {}),
    };
    assets.push(record);
    idByName.set(normalizedName, record.id);
  }
  return { assets, idByName };
}
