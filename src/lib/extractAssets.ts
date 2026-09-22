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

import { newId, type Asset, type AssetDetails, type AssetType } from "@/stores/projectStore";
import { generateAssetNamespace, generateFullPrompt } from "@/lib/assetNamespace";
import { normalizeCharacterDescription } from "@/lib/promptComposer";
import { composeAssetAppearance, normalizeAssetDetails } from "@/lib/assetDetails";

/** 模型输出的资产条目（提取/分镜共用的原始形态；style 提供 details 或平铺 6 字段） */
export interface RawAsset {
  name: string;
  description: string;
  appearancePrompt?: string;
  details?: AssetDetails;
  /** 平铺 6 字段（兼容旧模型输出）：未提供 details 时用于物化 style details */
  mediumMaterial?: string;
  colorPalette?: string;
  lightingMood?: string;
  cameraTexture?: string;
  composition?: string;
  emotion?: string;
}

/**
 * Build unique Asset records from model output without mutating inputs.
 * 返回 name→id 映射表：模型可能在 shots/dialogues 中使用自编 ID 引用角色，
 * 调用方需据此回填引用，保证对白归属与角色一致性。
 * 角色/产品/场景/风格共用此函数（type 区分）。
 * style 分支不走 appearancePrompt/namespace/fullPrompt：
 * prompt（英文 stylePrompt）为 L2 派生物，运行期由 useAssetActions.generateStyleReference 懒派生。
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
    const name = typeof item.name === "string" ? item.name : "";
    const rawDescription = typeof item.description === "string" ? item.description : "";
    const normalizedName = name.trim().toLocaleLowerCase();
    if (!normalizedName || names.has(normalizedName)) continue;
    names.add(normalizedName);

    const description = type === "character"
      ? normalizeCharacterDescription(rawDescription)
      : rawDescription;
    // style 兼容：模型偶尔把六个视觉维度平铺返回而不嵌 details，先组成 incoming 再归一化
    const incomingDetails: AssetDetails | undefined =
      item.details ??
      (type === "style"
        ? {
            kind: "style",
            mediumMaterial: item.mediumMaterial ?? "",
            colorPalette: item.colorPalette ?? "",
            lightingMood: item.lightingMood ?? "",
            cameraTexture: item.cameraTexture ?? "",
            composition: item.composition ?? "",
            emotion: item.emotion ?? "",
          }
        : undefined);
    const details = normalizeAssetDetails({ type, description }, incomingDetails);

    // 外观提示词由代码从中文设定拼装（四类通用，style 除外）：品种/材质等事实只有一处载体，
    // 模型同轮再写一份英文必然出现两份表述各说一套。
    // 设定全缺时回落模型给的提示词，避免拼出空描述。
    const modelAppearance = typeof item.appearancePrompt === "string" ? item.appearancePrompt : "";
    const appearancePrompt =
      type === "style"
        ? modelAppearance
        : composeAssetAppearance({ type, description, details }) || modelAppearance;

    const record: Asset = {
      id: newId("asset"),
      type,
      source: "extracted",
      name,
      description,
      prompt: type === "style" ? "" : appearancePrompt,
      ...(details ? { details } : {}),
      ...(type === "character"
        ? {
            appearancePrompt,
            assetNamespace: generateAssetNamespace(name),
            fullPrompt: generateFullPrompt({
              name,
              appearancePrompt,
            }),
          }
        : {}),
    };
    assets.push(record);
    idByName.set(normalizedName, record.id);
  }
  return { assets, idByName };
}
