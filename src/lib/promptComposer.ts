// ────────────────────────────────────────────────────────────────────────────
// src/lib/promptComposer.ts
// 提示词拼装器纯函数库（B 方案）。
// 六段式文生图 / 图生图 / 多图合成 / 定妆照（物种锁定）/ 分镜参考图选取。
// 全部为纯函数，便于单测（tests/lib/promptComposer.test.ts）。
//
// 与现有 lib 的关系：
// - 复用不动：promptUtils.composeVisualPrompt/composeMotionPrompt、
//   characterUtils.injectCharacterDescriptions、assetNamespace.*
// - 替代：useWizardActions.buildImageGenerationInput 的手工拼接与 findBestReference
// ────────────────────────────────────────────────────────────────────────────

import type { Asset, Project, Shot } from "@/stores/projectStore";

/** 多图合成中参考图的角色语义 */
export type ReferenceRole = "scene" | "character" | "product" | "prop" | "style";

/** 风格参考图读取所需的最小项目形状（兼容旧字段，零新列） */
type StyleRefProject = Pick<Project, "assets" | "styleReferenceUrl">;

/* ── 风格读取 helper ─────────────────────────────────────────────────────── */

/**
 * 读取项目风格参考图 URL。
 * 新代码统一经此 helper：style 资产的 imageUrl 优先，
 * 旧字段 project.styleReferenceUrl 作为兜底（兼容历史数据）。
 */
export function getStyleReferenceUrl(
  project: StyleRefProject,
): string | undefined {
  const styleAsset = project.assets.find(
    (a) => a.type === "style" && !!a.imageUrl,
  );
  return styleAsset?.imageUrl ?? project.styleReferenceUrl;
}

/**
 * 读取项目英文风格提示词（style 资产的 prompt，L2 派生物）。
 * 无 style 资产或 prompt 为空时返回 undefined。
 */
export function getStylePrompt(
  project: Pick<Project, "assets">,
): string | undefined {
  const styleAsset = project.assets.find((a) => a.type === "style");
  const prompt = styleAsset?.prompt?.trim();
  return prompt || undefined;
}

/* ── 文生图：六段式 ──────────────────────────────────────────────────────── */

/**
 * 文生图六段式：[主体]+[场景/环境]+[风格]+[光照]+[构图]+[质量要求]。
 * 空段自动剔除，非空段以 ", " 连接，顺序固定。
 */
export function composeTextToImagePrompt(i: {
  subject: string;
  scene?: string;
  style?: string;
  lighting?: string;
  composition?: string;
  quality?: string;
}): string {
  return [i.subject, i.scene, i.style, i.lighting, i.composition, i.quality]
    .map((s) => s?.trim())
    .filter((s): s is string => !!s)
    .join(", ");
}

/* ── 图生图（定妆照/资产图） ─────────────────────────────────────────────── */

/**
 * 图生图提示词：[改变要求]+[新风格/场景]+[保留]。
 * keep 为需原样保留的主体描述，显式以 "Keep unchanged:" 标注，
 * 降低图生图模型把参考图内容复制进结果的概率。
 */
export function composeImageToImagePrompt(i: {
  change: string;
  newStyle?: string;
  keep: string;
}): string {
  const keep = i.keep.trim();
  const parts = [
    i.change.trim(),
    i.newStyle?.trim(),
    keep ? `Keep unchanged: ${keep}` : "",
  ].filter((s): s is string => !!s && s.length > 0);
  return parts.join(", ");
}

/**
 * 资产生图的最小主体边界：保持共享风格参考图，同时要求模型只呈现当前资产。
 * 具体外观提示词仍由资产提取/编辑模型生成，避免在代码中重写资产内容。
 */
export function assetImageBoundary(type: "scene" | "product" | "prop"): string {
  if (type === "scene") return "Environment-only reference image; show the environment itself, not a story scene or characters.";
  if (type === "product") return "Product-only reference image; show only the product itself, not people or a usage scene.";
  return "Prop-only reference image; show only the named object itself, not characters or story action.";
}

/** 视觉方向图只呈现风格语言，不让故事主体进入共享风格参考图。 */
export function composeStyleReferencePrompt(stylePrompt: string): string {
  return `${stylePrompt.trim()}. Pure visual style board showing only medium, material, color, lighting and texture; no recognizable subject, character, creature, product or narrative content.`;
}

/* ── 多图合成（分镜图） ──────────────────────────────────────────────────── */

/**
 * 多图合成提示词：[参考图角色说明]+[目标场景]+[风格/光照/构图]+[图像关系]。
 * references 的 index 为 1 起始的参考图序号（对应 referenceImageUrls 数组下标+1）；
 * 尾部固定追加「参考图只作画风/形象锚点，勿复制构图」的图像关系指令。
 */
export function composeMultiReferencePrompt(i: {
  references: Array<{ index: number; role: ReferenceRole; note: string }>;
  scene: string;
  style?: string;
  lighting?: string;
  composition?: string;
}): string {
  const parts: string[] = [];

  // 参考图角色说明（note 为空的参考图跳过，避免出现空描述）
  for (const r of i.references) {
    const note = r.note.trim();
    if (note) parts.push(`Image ${r.index} is the ${r.role} reference: ${note}`);
  }

  const scene = i.scene.trim();
  if (scene) parts.push(`Target scene / subject: ${scene}`);

  const style = i.style?.trim();
  if (style) parts.push(`Style: ${style}`);
  const lighting = i.lighting?.trim();
  if (lighting) parts.push(`Lighting: ${lighting}`);
  const composition = i.composition?.trim();
  if (composition) parts.push(`Composition: ${composition}`);

  // 图像关系：参考图只作锚点，勿复制内容/构图
  parts.push(
    "The reference images only anchor art style, color palette and character identity; do not copy their content or composition.",
    "Scene, product and prop references anchor only the named asset identity and appearance; do not copy their layout.",
  );

  return parts.join(", ");
}

/* ── 定妆照（物种锁定） ──────────────────────────────────────────────────── */

/** 动物物种关键词（按 appearancePrompt 首句小写匹配） */
const ANIMAL_KEYWORDS = [
  "animal", "rabbit", "bunny", "hare", "cat", "kitten", "dog", "puppy",
  "fox", "bird", "owl", "wolf", "tiger", "lion", "bear", "panda", "deer",
  "horse", "pony", "monkey", "mouse", "squirrel", "dragon", "turtle",
  "penguin", "elephant", "creature", "fish", "pig", "piglet", "boar",
] as const;

/** 产品/实物关键词（同样按首句匹配） */
const PRODUCT_KEYWORDS = [
  "product", "bottle", "box", "package", "packaging", "device", "phone",
  "laptop", "watch", "headphones", "sneaker", "shoe", "bag", "cup", "mug",
  "toy", "camera", "gadget", "keyboard", "jar", "can", "perfume",
] as const;

/** 取英文/中文首句（句号/问叹号切分），用于物种探测 */
function firstSentence(text: string): string {
  return text.split(/[.!?。！？]/)[0]?.trim() ?? "";
}

/** 按 appearancePrompt 首句探测物种类型 */
function detectSpecies(text: string): "animal" | "product" | "humanoid" {
  const s = firstSentence(text).toLowerCase();
  if (ANIMAL_KEYWORDS.some((k) => s.includes(k))) return "animal";
  if (PRODUCT_KEYWORDS.some((k) => s.includes(k))) return "product";
  return "humanoid";
}

/** 通用定妆照尾部（全身设定，禁止半身像/看镜头） */
const PORTRAIT_TAIL =
  "Full-body character design sheet, consistent identity, clean presentation";

/** 按主体补充正向解剖约束；猪单独写明物种典型结构，避免模型把“正确肢体数量”理解得过于宽泛。 */
function anatomyConstraint(text: string): string {
  const sentence = firstSentence(text).toLowerCase();
  if (/\b(?:pig|piglet|boar)\b/.test(sentence)) {
    return "Normal pig anatomy: one head, one body, four legs, two ears and one snout; no extra or duplicated limbs, no duplicated or fused body parts";
  }
  if (ANIMAL_KEYWORDS.some((keyword) => sentence.includes(keyword))) {
    return "Normal anatomy for the described animal: one head, one body, correct species-typical limb count and placement; no extra or duplicated limbs, no duplicated or fused body parts";
  }
  return "Normal anatomy for the described subject: one head, one body, correct limb count and placement; no duplicated or fused body parts";
}

/**
 * 定妆照专用提示词：物种词前置 + 物种锁定语汇 + 全身角色设定。
 * - animal：物种锁定句（非人类动物，禁止人化）
 * - humanoid / product：通用主体锁定句
 * - 空 appearancePrompt 不产生空锁定句（直接返回风格+尾部）
 * - 严禁 "Portrait of / head and shoulders / looking at camera"（推手之一）
 */
export function composePortraitPrompt(i: {
  appearancePrompt: string;
  stylePrompt?: string;
}): string {
  const appearance = i.appearancePrompt.trim();
  const style = i.stylePrompt?.trim();
  const stylePart = style ? `, ${style}` : "";

  if (!appearance) {
    // 空描述不产生空锁定句
    return `${stylePart ? stylePart.replace(/^, /, "") + ". " : ""}${PORTRAIT_TAIL}`;
  }

  const species = detectSpecies(appearance);
  const lock =
    species === "animal"
      ? `SUBJECT SPECIES LOCK: this subject is a non-human animal (${firstSentence(appearance).toLowerCase()}). Never render it as a human, never add human faces or hands. `
      : "SUBJECT LOCK: strictly preserve the subject type and identity described below; never swap the subject. ";

  return `${lock}${appearance}${stylePart}. ${anatomyConstraint(appearance)}. ${PORTRAIT_TAIL}`;
}

/* ── 分镜图多参考选取 ────────────────────────────────────────────────────── */

/**
 * 分镜图参考图选取（有序去重，总上限 3 张）。
 * 槽位规则（主理人裁决：风格图必须恒保留）：
 * - 场景参考 + 角色定妆照 + 产品图 + 道具图 合计最多取 2 张（按优先级顺序）；
 * - 风格图（getStyleReferenceUrl 结果）恒占末位预留槽：只要有就必保留，
 *   即使非风格参考已满 2 张也会挤掉最后一个非风格项（即非风格项最多 2 张）。
 * 优先级：显式场景 → 文本匹配场景 → 角色定妆照
 * （activeCharacterIds 命中）→ 显式产品 → 显式道具 → 风格图。
 */
export function pickShotReferences(
  shot: Shot,
  project: { assets: Asset[]; styleReferenceUrl?: string },
): string[] {
  const out: string[] = [];

  /** 非风格参考：合计最多 2 张（给风格图预留末位槽） */
  const pushNonStyle = (url: string | undefined | null): void => {
    if (url && !out.includes(url) && out.length < 2) out.push(url);
  };

  // 1. 场景参考：优先使用镜头显式场景，其次才用旧数据的文本匹配/首个场景兜底。
  const scenes = project.assets.filter((a) => a.type === "scene");
  const explicitScene = scenes.find((scene) => scene.id === shot.activeSceneId);
  if (explicitScene?.imageUrl) pushNonStyle(explicitScene.imageUrl);
  if (!explicitScene && shot.sceneDesc?.trim() && scenes.length > 0) {
    const shotScene = shot.sceneDesc.toLowerCase();
    const matched = scenes.find(
      (s) => s.imageUrl && shotScene.includes(s.name.toLowerCase()),
    );
    if (matched?.imageUrl) pushNonStyle(matched.imageUrl);
  }
  if (out.length === 0) pushNonStyle(scenes.find((s) => !!s.imageUrl)?.imageUrl);

  // 2. 角色定妆照（activeCharacterIds 命中；imageUrl 优先，avatarUrl 兜底）
  for (const id of shot.activeCharacterIds ?? []) {
    const c = project.assets.find((a) => a.id === id && a.type === "character");
    pushNonStyle(c?.imageUrl ?? c?.avatarUrl);
  }

  // 3. 产品图：只使用镜头显式引用，避免把全局产品污染到无关镜头。
  for (const id of shot.activeProductIds ?? []) {
    pushNonStyle(project.assets.find((a) => a.id === id && a.type === "product")?.imageUrl);
  }

  // 4. 道具图：只使用镜头显式引用。
  for (const id of shot.activePropIds ?? []) {
    pushNonStyle(project.assets.find((a) => a.id === id && a.type === "prop")?.imageUrl);
  }

  // 5. 风格图：恒占末位预留槽（有则必保留，总上限 3 由非风格 cap=2 保证）
  const styleUrl = getStyleReferenceUrl(project);
  if (styleUrl && !out.includes(styleUrl)) out.push(styleUrl);

  return out;
}

/* ── 结构化角色描述解析（首行总述 + 8 要素行格式） ───────────────────────── */

export interface ParsedCharacterDescription {
  /** 一句话总述（首行，供资产卡片单行展示）；无总述行时为 undefined */
  summary?: string;
  /** 8 要素字段行；为空数组时调用方应整段展示原始文本（旧格式/自由文本兜底） */
  fields: Array<{ label: string; value: string }>;
}

/**
 * 解析角色描述：
 * - 「要素名：内容」行 → fields（中英文冒号均可，前缀 1-6 字）
 * - 首行若不含前缀且后随要素行 → 识别为一句话总述（summary）
 * - 含任何无法归类的行，或整体不是"总述+要素行"结构 → fields 为空，
 *   调用方整段展示原始文本（兼容旧版一句话描述，不半解析）。
 */
const CHARACTER_FIELDS = [
  "物种",
  "身份",
  "年龄",
  "性格",
  "外貌",
  "服饰",
  "记忆点",
  "背景",
] as const;

const CHARACTER_FIELD_PATTERN = /(?:^|[。；;])\s*(物种|身份|年龄|性格|外貌|服饰|记忆点|背景)[：:]\s*/g;

/**
 * 将模型偶尔压成单行、用句号/分号连接的角色描述恢复为规范 9 行格式。
 * 已经是换行格式或无法识别为完整 8 要素时保持原文，避免破坏自由文本。
 */
export function normalizeCharacterDescription(description: string): string {
  const original = description.trim();
  if (!original || /\r?\n/.test(original)) return original;

  const matches = [...original.matchAll(CHARACTER_FIELD_PATTERN)];
  if (matches.length === 0) return original;

  // 已是规范换行时，换行属于字段边界，不应留在上一个字段值中。
  const firstFieldStart = matches[0].index ?? -1;
  const summary = original.slice(0, firstFieldStart).trim().replace(/[。；;]\s*$/, "");
  if (!summary || /[：:]/.test(summary)) return original;

  const fields = matches.map((match, index) => {
    const label = match[1];
    const valueStart = (match.index ?? 0) + match[0].length;
    const nextStart = index + 1 < matches.length
      ? (matches[index + 1].index ?? original.length)
      : original.length;
    return `${label}：${original.slice(valueStart, nextStart).trim().replace(/[。；;]\s*$/, "")}`;
  });

  const labels = fields.map((field) => field.slice(0, field.indexOf("：")));
  const isComplete =
    matches.length === CHARACTER_FIELDS.length &&
    labels.every((label, index) => label === CHARACTER_FIELDS[index]) &&
    fields.every((field) => field.includes("：") && field.slice(field.indexOf("：") + 1).trim());
  if (!isComplete) return original;

  return [summary, ...fields].filter(Boolean).join("\n");
}

export function parseCharacterDescription(description: string): ParsedCharacterDescription {
  const normalized = normalizeCharacterDescription(description);
  const lines = normalized
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const fields: Array<{ label: string; value: string }> = [];
  let summary: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^([^：:]{1,6})[：:]\s*(.+)$/);
    if (m) {
      if (!CHARACTER_FIELDS.includes(m[1] as (typeof CHARACTER_FIELDS)[number])) {
        return { fields: [] };
      }
      fields.push({ label: m[1], value: m[2].trim() });
      continue;
    }
    // 无前缀行：仅首行（不含冒号、且后面还有要素行）可作总述；否则视为自由文本 → 兜底
    if (i === 0 && lines.length > 1 && !/[：:]/.test(line)) {
      summary = line;
      continue;
    }
    return { fields: [] };
  }

  if (fields.length === 0) return { fields: [] };
  return { summary, fields };
}
