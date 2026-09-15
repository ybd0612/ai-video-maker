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
import { CHARACTER_FIELD_ALIASES, splitAssetDescription } from "@/lib/assetDetails";

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

/**
 * 风格提示词审计的禁止主体清单（数据驱动）。
 * 只取项目自身的非风格资产名（角色/场景/产品/道具），
 * 代码不硬编码任何风格或物种关键词——是否越界由 LLM 判断（task=stylePromptAudit）。
 */
export function collectSubjectVocabulary(
  project: Pick<Project, "assets">,
): string[] {
  const names = project.assets
    .filter((asset) => asset.type !== "style")
    .map((asset) => asset.name.trim())
    .filter(Boolean);
  return [...new Set(names)];
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

/* ── 资产图（角色/场景/产品/道具） ─────────────────────────────────────── */

/**
 * 资产生图的最小主体边界：要求模型只呈现当前资产。
 * 具体外观提示词仍由资产提取/编辑模型生成，避免在代码中重写资产内容。
 */
export function assetImageBoundary(type: "scene" | "product" | "prop"): string {
  if (type === "scene") return "Environment-only image; show the environment itself, not a story scene or characters.";
  if (type === "product") return "Product-only image; show only the product itself, not people or a usage scene.";
  return "Prop-only image; show only the named object itself, not characters or story action.";
}

/**
 * 风格参考图提示词：在模型生成的 stylePrompt 上声明这张图的角色（纯风格母版）。
 * 具体风格语言（媒介、色彩、光影、材质、镜头、构图）由模型决定（task=styleRef），
 * 代码不写死任何风格特化词汇，跨动画/写实/水彩/产品摄影等风格通用。
 *
 * ⚠️ 2026-09-15 事故修复：原实现只给否定约束（"no central subject / no recognizable entity"）。
 * 文生图模型无法渲染"空画面"，必然按语境自造主体填空 —— "fine fur textures + tenderness"
 * 被填成一只毛茸茸的猫。现改为**正向载体**：明确要求画面是抽象样张（材质/色卡/光影/笔触样张），
 * 模型有明确可画之物就不会再造主体。载体描述对所有风格通用，不属风格特化。
 */
export function composeStyleReferencePrompt(stylePrompt: string): string {
  // 去掉模型偶发给出的句末句号，避免拼接出 "emotion.. Render ..." 双句号
  const base = stylePrompt.trim().replace(/[\s.]+$/, "");
  return (
    `${base}. Render this as an abstract style sample sheet: material and texture swatches, ` +
    "colour palette chips, lighting and gradient studies, brush and rendering samples. " +
    "Abstract visual language only — no character, no animal, no creature, no person, " +
    "no face, no product, no scenery, no narrative scene."
  );
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

  // 图像关系：参考图都是「我方资产形象」（场景/角色/产品/道具），锚定主体身份与画风；
  // 画面构图由文本决定，勿照抄参考图排版。（风格母版已退出参考图，见 pickShotReferences）
  parts.push(
    "The reference images anchor the identity, appearance and art style of the subjects described above; keep those subjects consistent with their references, but compose the picture from the text description — do not copy the references' layout or background.",
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
 * ⚠️ 2026-09-15 事故决策（主理人裁决）：**风格母版不再进入参考图**。
 * 实测 i2i 模型对参考图内容的复制强度远高于文本否定 —— 母版里不管是猫还是
 * 抽象样张方块，都会被整体复制进资产图/分镜图（两轮事故同一根因）。
 * 风格一致性改由 stylePrompt 文本承载；参考图只保留"有主体归属"的资产形象：
 * - 场景图 + 角色定妆照 + 产品图 + 道具图 合计最多 3 张；
 * 优先级：显式场景 → 文本匹配场景 → 角色定妆照
 * （activeCharacterIds 命中）→ 显式产品 → 显式道具。
 */
export function pickShotReferences(
  shot: Shot,
  project: { assets: Asset[]; styleReferenceUrl?: string },
): string[] {
  const out: string[] = [];

  const push = (url: string | undefined | null): void => {
    if (url && !out.includes(url) && out.length < 3) out.push(url);
  };

  // 1. 场景参考：优先使用镜头显式场景，其次才用旧数据的文本匹配/首个场景兜底。
  const scenes = project.assets.filter((a) => a.type === "scene");
  const explicitScene = scenes.find((scene) => scene.id === shot.activeSceneId);
  if (explicitScene?.imageUrl) push(explicitScene.imageUrl);
  if (!explicitScene && shot.sceneDesc?.trim() && scenes.length > 0) {
    const shotScene = shot.sceneDesc.toLowerCase();
    const matched = scenes.find(
      (s) => s.imageUrl && shotScene.includes(s.name.toLowerCase()),
    );
    if (matched?.imageUrl) push(matched.imageUrl);
  }
  if (out.length === 0) push(scenes.find((s) => !!s.imageUrl)?.imageUrl);

  // 2. 角色定妆照（activeCharacterIds 命中；imageUrl 优先，avatarUrl 兜底）
  for (const id of shot.activeCharacterIds ?? []) {
    const c = project.assets.find((a) => a.id === id && a.type === "character");
    push(c?.imageUrl ?? c?.avatarUrl);
  }

  // 3. 产品图：只使用镜头显式引用，避免把全局产品污染到无关镜头。
  for (const id of shot.activeProductIds ?? []) {
    push(project.assets.find((a) => a.id === id && a.type === "product")?.imageUrl);
  }

  // 4. 道具图：只使用镜头显式引用。
  for (const id of shot.activePropIds ?? []) {
    push(project.assets.find((a) => a.id === id && a.type === "prop")?.imageUrl);
  }

  // 风格母版不进入参考图（见函数头注释）；风格由 stylePrompt 文本承载。

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
 * - 「要素名：内容」行 → fields（中英文冒号均可）
 * - 首行（字段出现前）不含前缀 → 识别为一句话总述（summary）
 * - 自由文本（无任何字段行）→ 整段作为 summary，fields 为空（调用方整段展示）
 *
 * ⚠️ 2026-09-15 修复：原实现硬编码 8 个旧标签、且限制标签长度 1-6 字符，
 * 模型改用新措辞（如「性格与行为倾向」7 字）后整段解析直接放弃、连 summary 也丢，
 * 表现为"角色的一句话简介为空、完整设定里混着简介"。现改为结构驱动解析（见
 * assetDetails.splitAssetDescription），标签叫什么都能拆。
 */
/** 单行压缩描述的标签识别：按角色字段别名表构建，模型换措辞同样可识别。
 *  别名均为中英文文字，不含正则元字符，故直接拼接即可。 */
const CHARACTER_FIELD_PATTERN = new RegExp(
  "(?:^|[。；;\\n])\\s*(?:" + CHARACTER_FIELD_ALIASES.join("|") + ")[：:]\\s*",
  "g",
);

/**
 * 将模型偶尔压成单行、用句号/分号连接的角色描述恢复为规范换行格式。
 * 识别门槛：至少命中 6 个已知角色字段标签，否则视为自由文本保持原文。
 */
export function normalizeCharacterDescription(description: string): string {
  const original = description.trim();
  if (!original || /\r?\n/.test(original)) return original;

  const matches = [...original.matchAll(CHARACTER_FIELD_PATTERN)];
  if (matches.length < 6) return original;

  const firstFieldStart = matches[0].index ?? -1;
  const summary = original.slice(0, firstFieldStart).trim().replace(/[。；;]\s*$/, "");
  if (!summary || /[：:]/.test(summary)) return original;

  const fields = matches.map((match, index) => {
    const label = match[0].trim().replace(/^[。；;]\s*/, "").replace(/[：:]\s*$/, "");
    const valueStart = (match.index ?? 0) + match[0].length;
    const nextStart = index + 1 < matches.length
      ? (matches[index + 1].index ?? original.length)
      : original.length;
    return `${label}：${original.slice(valueStart, nextStart).trim().replace(/[。；;]\s*$/, "")}`;
  });

  if (!fields.every((field) => field.slice(field.indexOf("：") + 1).trim())) return original;
  return [summary, ...fields].filter(Boolean).join("\n");
}

export function parseCharacterDescription(description: string): ParsedCharacterDescription {
  // 先做单行压缩 → 换行的规范化，再按结构拆分；否则"一句话。物种：兔。…"整行
  // 会被当成一个超长标签的字段。
  const parts = splitAssetDescription(normalizeCharacterDescription(description));
  return {
    summary: parts.summary || undefined,
    fields: parts.fields,
  };
}
