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

/**
 * 提示词拼装链可用的注册表规则文本。
 * 纯数据：由调用方从 getActiveRules() 按语言提取后传入（见 promptRules.getActiveRuleText）。
 * lib 不读 store —— 保证 promptComposer 全为纯函数，便于单测。
 */
export interface RegistryRuleText {
  /** composeShot 生效规则文本（分镜画面拼装规范） */
  composeShot?: string;
  /** negativeStrategy 生效规则文本（负向策略，需改写为正向约束注入） */
  negativeStrategy?: string;
}

/**
 * 把注册表生效规则作为「正向约束/质量要求」拼接到提示词尾部。
 * 纯函数：规则文本由调用方从 getActiveRules() 提取后传入；lib 不读 store。
 * - composeShot：画面拼装规范，直接作为正向约束追加；
 * - negativeStrategy：负向策略改写为正向质量要求追加（不新增 API negative 字段，
 *   也不污染 stylePrompt）。
 * 规则文本只描述约束意图，不含风格母版载体词（抽象样张等）；风格母版隔离铁律不变。
 */
export function appendRegistryRules(prompt: string, rules?: RegistryRuleText): string {
  if (!rules) return prompt;
  const blocks: string[] = [];
  const compose = rules.composeShot?.trim();
  if (compose) blocks.push(`构图规则：${compose}`);
  const negative = rules.negativeStrategy?.trim();
  if (negative) blocks.push(`质量要求：${negative}`);
  if (blocks.length === 0) return prompt;
  const base = prompt.trim();
  return base ? `${base}, ${blocks.join(", ")}` : blocks.join(", ");
}

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
  /** 来自 getActiveRules() 的 composeShot / negativeStrategy 生效规则文本 */
  rules?: RegistryRuleText;
}): string {
  const base = [i.subject, i.scene, i.style, i.lighting, i.composition, i.quality]
    .map((s) => s?.trim())
    .filter((s): s is string => !!s)
    .join(", ");
  return appendRegistryRules(base, i.rules);
}

/* ── 资产图（角色/场景/产品/道具） ─────────────────────────────────────── */

/**
 * 资产生图的最小主体边界：要求模型只呈现当前资产。
 * 具体外观描述由 `assetDetails.composeAssetAppearance` 从结构化设定拼装，
 * 代码只声明边界，不重写资产内容。
 */
export function assetImageBoundary(type: "scene" | "product" | "prop"): string {
  if (type === "scene") return "场景图：只画这个空间本身的环境与构图，不要出现角色或剧情动作。";
  if (type === "product") return "产品图：只画这个产品本体，不要出现人物或使用场景。";
  return "道具图：只画这个物件本体，不要出现角色或剧情动作。";
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
  /** 来自 getActiveRules() 的 composeShot / negativeStrategy 生效规则文本 */
  rules?: RegistryRuleText;
}): string {
  const parts: string[] = [];
  const scene = i.scene.trim();

  // 镜头差异必须前置，避免被共同的参考图说明淹没。
  if (scene) parts.push(`目标镜头：${scene}`);

  // 参考图只锚定显式引用资产的身份/外观，不提供场景构图。
  for (const r of i.references) {
    const note = r.note.trim();
    if (note) parts.push(`图 ${r.index} 是${r.role === "scene" ? "场景" : r.role === "character" ? "角色" : r.role === "product" ? "产品" : r.role === "prop" ? "道具" : "风格"}参考：${note}`);
  }

  const style = i.style?.trim();
  if (style) parts.push(`可复用视觉风格：${style}`);
  const lighting = i.lighting?.trim();
  if (lighting) parts.push(`本镜头光线：${lighting}`);
  const composition = i.composition?.trim();
  if (composition) parts.push(`本镜头构图：${composition}`);

  parts.push(
    "以目标镜头决定构图、动作与环境；每张参考图只用于保持其点名资产的身份与外观，不得复制任何参考图的构图、机位、背景或光线。",
  );

  return appendRegistryRules(parts.join(", "), i.rules);
}

/* ── 定妆照（物种锁定） ──────────────────────────────────────────────────── */

/**
 * 动物物种线索（中英双语，兼容只存英文外观描述的历史资产）。
 * 只用于判定"是不是非人类动物"以选择锁定句，**不涉及品种**，不是品种白名单。
 */
const ANIMAL_SPECIES_HINTS = [
  "动物", "宠物", "兔", "猫", "狗", "犬", "狐", "鸟", "鹰", "猫头鹰", "狼", "虎",
  "狮", "熊", "熊猫", "鹿", "马", "猴", "鼠", "松鼠", "龙", "龟", "企鹅", "象",
  "生物", "鱼", "猪", "牛", "羊", "鸡", "鸭", "驴", "驼", "貂", "獾", "狸",
  "animal", "rabbit", "bunny", "hare", "cat", "kitten", "dog", "puppy",
  "fox", "bird", "owl", "wolf", "tiger", "lion", "bear", "panda", "deer",
  "horse", "pony", "monkey", "mouse", "squirrel", "dragon", "turtle",
  "penguin", "elephant", "creature", "fish", "pig", "piglet", "boar",
] as const;

/** 取英文/中文首句（句号/问叹号切分），用于物种兜底探测 */
function firstSentence(text: string): string {
  return text.split(/[.!?。！？]/)[0]?.trim() ?? "";
}

/**
 * 该主体是否应按"非人类动物"上物种锁定。
 * 优先看结构化 `species`（含品种，如「贵宾犬（泰迪）」「dog (Golden Retriever)」），
 * 缺失时才回落到外观描述首句探测 —— 兼容只存英文提示词的历史资产。
 */
export function isAnimalSubject(species: string | undefined, appearance: string): boolean {
  const fromSpecies = species?.trim().toLowerCase() ?? "";
  if (fromSpecies) return ANIMAL_SPECIES_HINTS.some((k) => fromSpecies.includes(k.toLowerCase()));
  return ANIMAL_SPECIES_HINTS.some((k) => firstSentence(appearance).toLowerCase().includes(k.toLowerCase()));
}

/** 通用定妆照尾部（全身设定，禁止半身像/看镜头） */
const PORTRAIT_TAIL = "全身角色设定图，身份一致，画面干净";

/** 按主体补充正向解剖约束；猪单独写明物种典型结构，避免模型把“正确肢体数量”理解得过于宽泛。 */
function anatomyConstraint(species: string | undefined, appearance: string): string {
  const probe = `${species ?? ""} ${firstSentence(appearance)}`.toLowerCase();
  if (/猪|pig|piglet|boar/.test(probe)) {
    return "猪的正常解剖结构：一个头、一个身体、四条腿、两只耳朵和一个鼻子；无多余或重复的肢体，无重复或融合的身体部位";
  }
  if (isAnimalSubject(species, appearance)) {
    return "所描述动物的正常解剖结构：一个头、一个身体、符合该物种的正常肢体数量与位置；无多余或重复的肢体，无重复或融合的身体部位";
  }
  return "所描述主体的正常解剖结构：一个头、一个身体、正确的肢体数量与位置；无重复或融合的身体部位";
}

/**
 * 定妆照专用提示词：物种锁定语汇 + 中文外观描述 + 全身角色设定。
 * - 动物：物种锁定句（把 `species` 原样写进锁定句，品种因此只有一个来源）
 * - 其它：通用主体锁定句
 * - 空描述不产生空锁定句（直接返回风格 + 尾部）
 * - 严禁 "Portrait of / head and shoulders / looking at camera" 这类人像语汇
 */
export function composePortraitPrompt(i: {
  appearancePrompt: string;
  /** 结构化物种（含品种）；决定锁定句与解剖约束，缺失时按外观描述兜底探测 */
  species?: string;
  stylePrompt?: string;
}): string {
  const appearance = i.appearancePrompt.trim();
  const style = i.stylePrompt?.trim();
  const stylePart = style ? `，${style}` : "";

  if (!appearance) {
    // 空描述不产生空锁定句
    return `${style ? `${style}. ` : ""}${PORTRAIT_TAIL}`;
  }

  const species = i.species?.trim();
  const lock = isAnimalSubject(species, appearance)
    ? `主体锁定：这个主体是${(species || firstSentence(appearance)).replace(/[。.]$/, "")}，` +
      "严格保留它的物种与品种，绝不替换成其它物种或其它品种，绝不画成人物，绝不添加人脸或人手。"
    : "主体锁定：严格保留以下描述的主体类型与身份，绝不替换主体。";
  // 取景约束前置：实测只把它放在末尾时，模型会画成半身胸像（物种锁定句权重压过尾部）
  const framing = "取景：完整全身入画，含四肢、尾巴与脚掌，角色设定图视角。";

  // stylePrompt 常自带句末标点，避免与模板补的句号叠成「。。」
  const body = `${lock}${framing}${appearance}${stylePart}`.replace(/[。.]+\s*$/, "");
  return `${body}。${anatomyConstraint(species, appearance)}。${PORTRAIT_TAIL}`;
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
    if (url && !out.includes(url) && out.length < 4) out.push(url);
  };

  // 场景图不进入分镜图 i2i：场景参考图是成品构图，会压平同组镜头差异；
  // 环境由 visualPrompt/sceneDesc 的文本描述重新构图。

  // 1. 角色定妆照（activeCharacterIds 命中；imageUrl 优先，avatarUrl 兜底）
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
