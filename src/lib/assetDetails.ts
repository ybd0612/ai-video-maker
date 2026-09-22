// ────────────────────────────────────────────────────────────────────────────
// src/lib/assetDetails.ts
// 资产描述 ↔ 结构化 details 的桥接。
//
// 背景（2026-09-15 事故沉淀）：
//   模型输出的资产 description 是"首行一句话简介 + 若干『标签：值』行"的自然语言，
//   而结构化 details 需要按字段取值。原实现用**硬编码标签清单**做正则匹配，一旦
//   模型换了措辞（`性格` → `性格与行为倾向`、`环境` → `地理与环境`），就出现两类事故：
//     ① 完全不匹配 → 字段静默为空；
//     ② 前缀部分匹配 → 值被污染（personality = "与行为倾向：贪玩…"）。
//   因此改为**结构驱动**解析（只按"标签：值"的形状切分，不关心标签叫什么），
//   再用**别名表**（精确 → 前缀 → 包含 三级匹配）映射到结构化字段。
//   新增/调整模型措辞时只需在别名表补一项，不再改解析逻辑。
// ────────────────────────────────────────────────────────────────────────────

import type {
  Asset,
  AssetDetails,
  CharacterDetails,
  ProductDetails,
  PropDetails,
  SceneDetails,
  StyleDetails,
} from "@/stores/projectStore";

/** 标签长度上限：超过则视为正文而非标签（如"前景、中景、背景与空间层次"共 13 字） */
const MAX_LABEL_LENGTH = 24;

export interface DescriptionParts {
  /** 一句话简介（字段出现前不含冒号的行；供卡片 / 编辑器的「一句话简介」） */
  summary: string;
  /** 「标签：值」行（按出现顺序） */
  fields: Array<{ label: string; value: string }>;
}

/**
 * 把资产描述拆成「一句话简介 + 字段行」。
 * 纯结构判定：只要形如 `标签：值` 就算字段，不校验标签是否在已知清单里。
 * - 字段出现前、且不含冒号的行 → 一句话简介；
 * - 字段出现后、不含冒号的行 → 续接到前一个字段值（模型偶发换行）；
 * - 全程无字段（自由文本）→ 整段作为简介，fields 为空。
 */
export function splitAssetDescription(description: string): DescriptionParts {
  // 迁移会喂入任意历史数据：非字符串一律按空描述处理，绝不抛错
  const text = typeof description === "string" ? description : "";
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return { summary: "", fields: [] };

  const fields: Array<{ label: string; value: string }> = [];
  const summaryLines: string[] = [];

  for (const line of lines) {
    const colonIndex = line.search(/[：:]/);
    const label = colonIndex > 0 ? line.slice(0, colonIndex).trim() : "";
    if (colonIndex > 0 && label.length > 0 && label.length <= MAX_LABEL_LENGTH) {
      fields.push({ label, value: line.slice(colonIndex + 1).trim() });
      continue;
    }
    if (fields.length === 0) {
      summaryLines.push(line);
      continue;
    }
    const last = fields[fields.length - 1];
    last.value = `${last.value} ${line}`.trim();
  }

  return { summary: summaryLines.join(" ").trim(), fields };
}

/** 取描述里的「一句话简介」（所有资产类型统一入口） */
export function extractAssetSummary(description: string): string {
  return splitAssetDescription(description).summary;
}

/* ── 字段别名表（模型措辞 → 结构化字段） ───────────────────────────────────
 * 数组顺序即优先级；匹配策略为「精确 → 前缀 → 包含」三级，三级别内部按数组顺序。
 * 旧标签（历史数据）与新标签（当前骨架）都必须覆盖，保证老项目仍能正确解析。
 */
type AliasMap = Record<string, string[]>;

const CHARACTER_ALIASES: AliasMap = {
  species: ["物种", "类型"],
  role: ["身份", "角色定位", "角色"],
  age: ["年龄", "年龄阶段"],
  personality: ["性格", "性格与行为"],
  appearance: ["外貌", "体型与比例", "体型比例", "体型", "外观"],
  outfit: ["服饰", "服饰与配饰", "服装", "配饰"],
  signature: ["记忆点", "跨镜头", "识别特征", "特殊标记"],
  background: ["背景", "来历", "经历"],
};

const SCENE_ALIASES: AliasMap = {
  settingType: ["空间类型", "场景类型", "类型"],
  environment: ["地理与环境", "环境", "地理"],
  time: ["时间"],
  weather: ["天气"],
  elements: ["主要元素", "元素"],
  spatialLayers: ["空间层次", "前景、中景", "层次", "景别"],
  lighting: ["光线方向与质量", "光线", "光照", "光影"],
  paletteMood: ["色彩与氛围", "色彩", "色调", "氛围"],
  storyUse: ["剧情用途", "可用于", "剧情"],
};

const PRODUCT_ALIASES: AliasMap = {
  category: ["产品类型", "品类", "类型"],
  purpose: ["核心用途", "用途", "功能"],
  silhouette: ["整体轮廓", "轮廓"],
  dimensions: ["尺寸与比例", "尺寸"],
  color: ["颜色", "色彩"],
  material: ["材质"],
  structure: ["结构组成", "结构"],
  surfaceDetails: ["表面细节", "表面"],
  branding: ["品牌或 Logo", "品牌"],
  signature: ["不可改变的识别特征", "识别特征", "记忆点", "特殊标记"],
  usageState: ["使用状态", "状态"],
};

const PROP_ALIASES: AliasMap = {
  purpose: ["道具用途", "用途", "功能"],
  storyRole: ["故事作用", "故事角色", "作用"],
  objectType: ["物件类型", "类型"],
  shape: ["整体形状", "形状"],
  dimensions: ["尺寸与比例", "尺寸"],
  material: ["材质"],
  color: ["颜色", "色彩"],
  structure: ["结构细节", "结构"],
  wear: ["磨损与使用痕迹", "磨损", "使用痕迹"],
  signature: ["特殊标记或识别特征", "特殊标记", "识别特征", "标记"],
  usage: ["在镜头中的使用方式", "使用方式", "使用"],
};

const STYLE_ALIASES: AliasMap = {
  mediumMaterial: ["媒介与材质", "画风与材质", "画风", "媒介", "材质"],
  colorPalette: ["主色调与明暗关系", "主色调", "色彩", "色调"],
  lightingMood: ["光影氛围", "光影", "光照"],
  cameraTexture: ["镜头质感与景深", "镜头质感", "镜头"],
  composition: ["构图规律与留白", "构图倾向", "构图"],
  emotion: ["整体情绪氛围", "整体情绪", "情绪", "氛围"],
};

const ALIASES_BY_KIND: Record<AssetDetails["kind"], AliasMap> = {
  character: CHARACTER_ALIASES,
  scene: SCENE_ALIASES,
  product: PRODUCT_ALIASES,
  prop: PROP_ALIASES,
  style: STYLE_ALIASES,
};

/** 角色字段别名（供描述规范化等外部逻辑判断"这是不是结构化角色描述"） */
export const CHARACTER_FIELD_ALIASES: string[] = Object.values(CHARACTER_ALIASES).flat();

/** 按别名取值：精确 → 前缀 → 包含（三级别内部按别名顺序，先命中先返回） */
function pickField(
  fields: Array<{ label: string; value: string }>,
  aliases: string[],
): string {
  if (fields.length === 0) return "";
  for (const alias of aliases) {
    const hit = fields.find((field) => field.label === alias);
    if (hit?.value) return hit.value;
  }
  for (const alias of aliases) {
    const hit = fields.find((field) => field.label.startsWith(alias));
    if (hit?.value) return hit.value;
  }
  for (const alias of aliases) {
    const hit = fields.find((field) => field.label.includes(alias));
    if (hit?.value) return hit.value;
  }
  return "";
}

function fill<K extends AssetDetails["kind"]>(
  kind: K,
  description: string,
): Extract<AssetDetails, { kind: K }> {
  const { fields } = splitAssetDescription(description);
  const aliases = ALIASES_BY_KIND[kind];
  const out: Record<string, string> = {};
  for (const [key, list] of Object.entries(aliases)) {
    out[key] = pickField(fields, list);
  }
  return { kind, ...out } as Extract<AssetDetails, { kind: K }>;
}

/** 从描述派生默认 details（别名匹配失败时字段为空串，不抛错） */
export function createDefaultAssetDetails(
  asset: Pick<Asset, "type" | "description">,
): AssetDetails | undefined {
  if (!asset || typeof asset !== "object") return undefined;
  const text = typeof asset.description === "string" ? asset.description : "";
  switch (asset.type) {
    case "character":
      return fill("character", text);
    case "scene":
      return fill("scene", text);
    case "product":
      return fill("product", text);
    case "prop":
      return fill("prop", text);
    case "style":
      return fill("style", text);
    default:
      return undefined;
  }
}

/**
 * 合并模型返回的 details 与描述派生结果。
 *
 * ⚠️ 关键修复（2026-09-15）：模型**不会**返回内部判别字段 `kind`（它是代码侧约定），
 * 旧实现要求 `incoming.kind === defaults.kind` 严格相等，导致模型返回的整份 details
 * 被丢弃、退回（通常为空的）描述派生值 —— 表现为"视觉方向/资产的设定全空"。
 * 现在：incoming 缺 kind 视为同类型正常合并；只有**显式给出不同 kind** 才回落。
 * 另：空串不覆盖已有值，避免模型偶尔返回空字段把可用值抹掉。
 */
export function normalizeAssetDetails(
  asset: Pick<Asset, "type" | "description">,
  incoming?: AssetDetails,
): AssetDetails | undefined {
  const defaults = createDefaultAssetDetails(asset);
  if (!defaults) return undefined;
  if (!incoming) return defaults;

  const incomingKind = (incoming as { kind?: string }).kind;
  if (incomingKind && incomingKind !== defaults.kind) return defaults;

  const merged: Record<string, unknown> = { ...defaults };
  for (const [key, value] of Object.entries(incoming)) {
    if (key === "kind") continue;
    if (typeof value === "string" && value.trim() === "") continue;
    merged[key] = value;
  }
  return { ...merged, kind: defaults.kind } as AssetDetails;
}

/**
 * 以**描述派生值优先**、既有 details 补空的合并（与 normalizeAssetDetails 方向相反）。
 * 使用场景：AI 指令改写了完整描述后保存 —— 描述是刚刚确认的最新意图，
 * 从它解析出的字段值必须胜过旧 details；旧 details 只负责补上描述里没写的字段。
 * 无 description 派生能力（类型不支持）时原样返回 undefined。
 */
export function mergeDetailsPreferDerived(
  asset: Pick<Asset, "type" | "description">,
  current?: AssetDetails,
): AssetDetails | undefined {
  const derived = createDefaultAssetDetails(asset);
  if (!derived) return undefined;

  const currentKind = (current as { kind?: string } | undefined)?.kind;
  const usableCurrent =
    current && (!currentKind || currentKind === derived.kind)
      ? (current as unknown as Record<string, unknown>)
      : undefined;

  const merged: Record<string, unknown> = { ...derived };
  if (usableCurrent) {
    for (const [key, value] of Object.entries(merged)) {
      if (key === "kind") continue;
      const existing = usableCurrent[key];
      if (
        typeof value === "string" &&
        value.trim() === "" &&
        typeof existing === "string" &&
        existing.trim() !== ""
      ) {
        merged[key] = existing;
      }
    }
  }
  return { ...merged, kind: derived.kind } as AssetDetails;
}

export function ensureAssetDetails(asset: Asset): Asset {
  const details = normalizeAssetDetails(asset, asset.details);
  return details ? { ...asset, details } : asset;
}

/**
 * 生图描述里各可视化字段的中文标签。
 * 提示词恒中文（不随界面语言变化），因此标签写死中文，不走 i18n；
 * 标签的作用是消歧 —— 服饰为「无，但披挂窗帘作披风」这类值，
 * 不带标签拼进描述会让模型读成一句无主语的话。
 */
const APPEARANCE_FIELD_LABELS: Record<string, string> = {
  species: "物种",
  appearance: "外貌",
  outfit: "服饰",
  signature: "识别特征",
  settingType: "空间类型",
  environment: "环境",
  time: "时间",
  weather: "天气",
  elements: "主要元素",
  spatialLayers: "空间层次",
  lighting: "光线",
  paletteMood: "色彩与氛围",
  category: "品类",
  silhouette: "轮廓",
  dimensions: "尺寸",
  color: "颜色",
  material: "材质",
  structure: "结构",
  surfaceDetails: "表面细节",
  branding: "品牌标识",
  objectType: "物件类型",
  shape: "形状",
  wear: "磨损痕迹",
};

/**
 * 各资产类型进入生图描述的**可视化字段**（顺序即拼接顺序）。
 * 刻意剔除叙事类字段（性格 / 身份 / 背景 / 剧情用途 / 使用方式 / 故事作用）：
 * 它们会让图像模型画出故事场景而不是资产本体。
 */
export const APPEARANCE_FIELDS: Record<AssetDetails["kind"], string[]> = {
  character: ["species", "appearance", "outfit", "signature"],
  scene: [
    "settingType",
    "environment",
    "time",
    "weather",
    "elements",
    "spatialLayers",
    "lighting",
    "paletteMood",
  ],
  product: [
    "category",
    "silhouette",
    "dimensions",
    "color",
    "material",
    "structure",
    "surfaceDetails",
    "branding",
    "signature",
  ],
  prop: [
    "objectType",
    "shape",
    "dimensions",
    "material",
    "color",
    "structure",
    "wear",
    "signature",
  ],
  style: [],
};

/**
 * 生图用的中文外观描述：一句话摘要 + 可视化字段（带字段名）。
 *
 * 2026-09-22 中文化改造的核心：**不再让模型同轮另写一份英文提示词**。
 * 一份事实只留一处载体，中英文各说一套（中文写金毛、英文写 Labrador）从结构上消失。
 *
 * ⚠️ 摘要行必须保留：实测模型常把品种只写进摘要行（「…金毛犬伙伴」），
 * 而 `details.species` 仅写「狗」—— 丢掉摘要行等于丢掉品种事实。
 * 无任何可视化字段与摘要时返回空串，由调用方决定回落策略。
 */
export function composeAssetAppearance(
  asset: Pick<Asset, "type" | "description" | "details">,
): string {
  // 摘要行常自带句末句号，与拼接用的中文逗号相连会留下「。，」残迹 → 剥掉行末标点
  const summaryRaw = (asset.description ?? "").split(/\r?\n/)[0]?.trim() ?? "";
  const summary = summaryRaw.replace(/[。.]+$/, "");
  const fields = APPEARANCE_FIELDS[asset.type] ?? [];
  const details = asset.details as Record<string, string> | undefined;
  const parts: string[] = [];
  if (summary) parts.push(summary);
  for (const key of fields) {
    const value = details?.[key]?.trim();
    if (value && !parts.includes(value)) parts.push(`${APPEARANCE_FIELD_LABELS[key] ?? key}：${value}`);
  }
  return parts.join("，");
}

/**
 * 结构化设定的字段行（剔除内部判别字段 `kind`），顺序即 details 的键顺序。
 * 展示层（资产编辑器「完整设定」）与下游文本链路共用，避免各处各写一遍。
 */
/**
 * 分镜用**短外观锚点**：只给一句身份描述（摘要 + 物种/类型），不复制完整设定。
 *
 * 2026-09-22 回归修复：分镜骨架与规则都要求「沿用资产外观描述原文」，而完整档外观
 * 是带标签的整份设定（物种：…，外貌：…，服饰：…，识别特征：…），于是 visualPrompt
 * 膨胀到 1100-1400 字、开头被某一个角色的完整身份垄断，模型把整句读成
 * 「主体=开头那只动物」→ 多角色镜头画出两只猫、镜头间主体漂移。
 * 完整设定交给参考图锚定，镜头提示词只需要一个短身份锚点。
 */
export const BRIEF_APPEARANCE_FIELDS: Record<AssetDetails["kind"], string[]> = {
  character: ["species"],
  scene: ["settingType"],
  product: ["category"],
  prop: ["objectType"],
  style: [],
};

export function composeAssetBriefAppearance(
  asset: Pick<Asset, "type" | "description" | "details">,
): string {
  const summary = splitAssetDescription(asset.description ?? "").summary.replace(/[。.]+$/, "");
  const details = asset.details as Record<string, string> | undefined;
  const parts: string[] = [];
  if (summary) parts.push(summary);
  for (const key of BRIEF_APPEARANCE_FIELDS[asset.type] ?? []) {
    const value = details?.[key]?.trim().replace(/[。.]+$/, "");
    if (value && !parts.some((x) => x.includes(value) || value.includes(x))) parts.push(value);
  }
  return parts.join("，");
}

export function detailEntries(
  details: AssetDetails | undefined,
): Array<[string, string]> {
  if (!details || typeof details !== "object") return [];
  return Object.entries(details).filter(
    ([key, value]) => key !== "kind" && typeof value === "string",
  ) as Array<[string, string]>;
}

/**
 * 把 details 拼成「字段名: 值」多行文本，供需要**完整设定**的下游链路使用
 * （角色英文外貌提示词派生等）。资产的结构化数据独立存放在 details，
 * 而 `description` 只保留一句话简介，直接拿 description 喂模型会丢信息。
 * 空值字段自动剔除；字段名用英文键名（发给模型的 payload 不做 i18n）。
 */
export function composeDetailsText(details: AssetDetails | undefined): string {
  return detailEntries(details)
    .filter(([, value]) => value.trim() !== "")
    .map(([key, value]) => `${key}: ${value.trim()}`)
    .join("\n");
}

/**
 * 资产完整描述单行文本（一句话简介 + 「字段名: 值」），供模型上下文的
 * 资产清单条目使用（分镜脚本的角色/场景清单等）。
 * description 只存一句话简介，直接拼清单会丢失全部结构化信息；
 * 无 details（旧数据）时回落原始 description。
 */
export function composeAssetDescription(
  asset: Pick<Asset, "description" | "details">,
): string {
  const summary = (asset.description ?? "").trim();
  const parts = detailEntries(asset.details)
    .filter(([, value]) => value.trim() !== "")
    .map(([key, value]) => `${key}: ${value.trim()}`);
  if (parts.length === 0) return summary;
  return [summary, ...parts].join("；");
}

/**
 * 修复历史数据的 details 缺陷（幂等、保守，只动"明显坏了"的字段）：
 *   ① 污染值：值形如「与行为倾向：贪玩…」「或识别特征：…」——旧正则按短标签
 *      前缀截取时把标签残片留在了值里 → 用描述的重新派生值替换；
 *   ② 空缺字段：details 里为空但描述能派生出值 → 补上（旧实现整份丢失的场景）。
 *
 * 已有、且不像污染的值**一律保留**（可能是 AI 或用户专门设定的，不能拿描述覆盖）。
 * 值里含冒号时才判定为污染嫌疑，因此"与麦田相邻的开阔地"这类正常描述不受影响。
 */
export function repairAssetDetails(asset: Asset): Asset {
  if (!asset || typeof asset !== "object") return asset;
  const derived = createDefaultAssetDetails(asset);
  if (!derived) return asset;

  const current = asset.details as Record<string, unknown> | undefined;
  if (!current || current.kind !== derived.kind) {
    return { ...asset, details: derived };
  }

  const next: Record<string, unknown> = { ...current };
  let changed = false;

  for (const [key, derivedValue] of Object.entries(derived)) {
    if (key === "kind") continue;
    const usable = typeof derivedValue === "string" && derivedValue.trim() !== "";
    const existing = next[key];

    if (typeof existing !== "string" || existing.trim() === "") {
      if (usable) {
        next[key] = derivedValue;
        changed = true;
      }
      continue;
    }
    // 污染嫌疑：含冒号且以「与 / 或 / 和」+ 残片开头（旧短标签正则的残留形态）
    if (/^[与或和][^：:]{0,12}[：:]/.test(existing) && usable) {
      next[key] = derivedValue;
      changed = true;
    }
  }

  return changed ? { ...asset, details: next as unknown as AssetDetails } : asset;
}

/* 引用上述具体类型，避免 TS 未使用告警（它们用于 AssetDetails 联合的收窄） */
export type {
  CharacterDetails,
  ProductDetails,
  PropDetails,
  SceneDetails,
  StyleDetails,
};
