import type { Asset, AssetDetails, CharacterDetails, ProductDetails, PropDetails, SceneDetails } from "@/stores/projectStore";

const value = (text: string, label: string): string => {
  const match = text.match(new RegExp(`(?:^|\\n)${label}：?\\s*(.+)`, "i"));
  return match?.[1]?.trim() ?? "";
};

export function createDefaultAssetDetails(asset: Pick<Asset, "type" | "description">): AssetDetails | undefined {
  const text = asset.description ?? "";
  if (asset.type === "character") {
    const details: CharacterDetails = {
      kind: "character", species: value(text, "物种"), role: value(text, "身份"), age: value(text, "年龄"),
      personality: value(text, "性格"), appearance: value(text, "外貌"), outfit: value(text, "服饰"),
      signature: value(text, "记忆点"), background: value(text, "背景"),
    };
    return details;
  }
  if (asset.type === "scene") {
    const details: SceneDetails = { kind: "scene", settingType: value(text, "空间类型"), environment: value(text, "环境"), time: value(text, "时间"), weather: value(text, "天气"), elements: value(text, "主要元素"), spatialLayers: value(text, "空间层次"), lighting: value(text, "光线"), paletteMood: value(text, "色彩氛围") || value(text, "氛围"), storyUse: value(text, "剧情用途") };
    return details;
  }
  if (asset.type === "product") {
    const details: ProductDetails = { kind: "product", category: value(text, "产品类型"), purpose: value(text, "用途"), silhouette: value(text, "整体轮廓"), dimensions: value(text, "尺寸与比例"), color: value(text, "颜色"), material: value(text, "材质"), structure: value(text, "结构组成"), surfaceDetails: value(text, "表面细节"), branding: value(text, "品牌或 Logo"), signature: value(text, "识别特征"), usageState: value(text, "使用状态") };
    return details;
  }
  if (asset.type === "prop") {
    const details: PropDetails = { kind: "prop", purpose: value(text, "用途"), storyRole: value(text, "故事作用"), objectType: value(text, "物件类型"), shape: value(text, "整体形状"), dimensions: value(text, "尺寸与比例"), material: value(text, "材质"), color: value(text, "颜色"), structure: value(text, "结构细节"), wear: value(text, "磨损与使用痕迹"), signature: value(text, "特殊标记") || value(text, "识别特征"), usage: value(text, "使用方式") };
    return details;
  }
  return undefined;
}

export function normalizeAssetDetails(
  asset: Pick<Asset, "type" | "description">,
  incoming?: AssetDetails,
): AssetDetails | undefined {
  const defaults = createDefaultAssetDetails(asset);
  if (!defaults) return undefined;
  return incoming && incoming.kind === defaults.kind
    ? ({ ...defaults, ...incoming, kind: defaults.kind } as AssetDetails)
    : defaults;
}

export function ensureAssetDetails(asset: Asset): Asset {
  const details = normalizeAssetDetails(asset, asset.details);
  return details ? { ...asset, details } : asset;
}
