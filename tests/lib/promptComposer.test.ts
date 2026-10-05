// ────────────────────────────────────────────────────────────────────────────
// tests/lib/promptComposer.test.ts
// 提示词拼装器纯函数库的单测。断言来自 src/lib/promptComposer.ts 真实实现。
// ────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import type { Asset, Shot } from "@/stores/projectStore";
import {
  composeTextToImagePrompt,
  composeMultiReferencePrompt,
  composePortraitPrompt,
  pickShotReferences,
  getStyleReferenceUrl,
  getStylePrompt,
  assetImageBoundary,
  composeStyleReferencePrompt,
  collectSubjectVocabulary,
  normalizeCharacterDescription,
  parseCharacterDescription,
  appendRegistryRules,
  type RegistryRuleText,
} from "@/lib/promptComposer";

/* ── 测试数据工厂 ─────────────────────────────────────────────────────────── */

function makeAsset(overrides: Partial<Asset> & Pick<Asset, "id" | "type" | "name">): Asset {
  return { description: "", prompt: "", ...overrides };
}

function makeShot(overrides: Partial<Shot> = {}): Shot {
  return {
    id: "shot_1",
    index: 0,
    scriptText: "",
    visualPrompt: "",
    motionPrompt: "",
    dialogues: [],
    activeCharacterIds: [],
    duration: 5,
    status: "scripted",
    useDualFrame: false,
    ...overrides,
  };
}

/* ── composeTextToImagePrompt：六段式 ──────────────────────────────────────── */

describe("composeTextToImagePrompt", () => {
  it("按 [主体][场景][风格][光照][构图][质量] 顺序输出", () => {
    const out = composeTextToImagePrompt({
      subject: "a young woman",
      scene: "in a cafe",
      style: "anime style",
      lighting: "warm light",
      composition: "wide shot",
      quality: "8k",
    });
    expect(out).toBe("a young woman, in a cafe, anime style, warm light, wide shot, 8k");
  });

  it("空段剔除：仅保留非空段，顺序不乱", () => {
    const out = composeTextToImagePrompt({
      subject: "a red apple",
      scene: undefined,
      style: "  ",
      lighting: "",
      composition: "close-up",
      quality: undefined,
    });
    expect(out).toBe("a red apple, close-up");
  });

  it("全空输入返回空串", () => {
    expect(composeTextToImagePrompt({ subject: "" })).toBe("");
  });
});

/* ── 资产图拼装（composeTextToImagePrompt + assetImageBoundary） ──────────── */

describe("资产主体边界与视觉方向", () => {
  it("按资产类型生成中文最小主体边界（只声明边界，不重写资产内容）", () => {
    expect(assetImageBoundary("scene")).toContain("场景图：只画这个空间本身");
    expect(assetImageBoundary("scene")).toContain("不要出现角色或剧情动作");
    expect(assetImageBoundary("product")).toContain("产品图：只画这个产品本体");
    expect(assetImageBoundary("product")).toContain("不要出现人物或使用场景");
    expect(assetImageBoundary("prop")).toContain("道具图：只画这个物件本体");
    expect(assetImageBoundary("scene")).not.toContain("rabbit");
  });

  it("视觉方向参考图声明为抽象样张载体（正向约束），不改写模型给出的风格语言", () => {
    const stylePrompt = "soft 3D cartoon rendering, fuzzy plush surface, warm golden palette";
    const prompt = composeStyleReferencePrompt(stylePrompt);
    // 模型给的风格语言原样保留：材质词是否合法属效果判断，由 LLM 审计裁定，
    // 代码不做关键词清洗（避免误伤写实/水彩/毛绒产品等合法风格）。
    expect(prompt).toContain("fuzzy plush surface");
    // 2026-09-15 事故：只给否定约束时文生图模型会自造主体填空
    // （"fine fur textures" + 治愈情绪 → 一只毛茸茸的猫），该主体再经图生图
    // 扩散到全部资产图。故必须给出正向、可画的抽象载体。
    expect(prompt).toContain("abstract style sample sheet");
    expect(prompt).toContain("material and texture swatches");
    expect(prompt).toContain("no animal");
    // 不再写死任何风格特化词汇
    expect(prompt).not.toContain("cartoon rendering style study");
  });

  it("风格提示词自带句末句号时不拼出双句号（旧日志出现 \"emotion.. Render\"）", () => {
    const prompt = composeStyleReferencePrompt("warm tones and soft light.");
    expect(prompt).toContain("soft light. Render this as");
    expect(prompt).not.toContain("..");
  });

  it("审计禁止清单只来自项目自身非风格资产名，去重且不硬编码关键词", () => {
    const project = {
      assets: [
        makeAsset({ id: "c1", type: "character", name: " 小兔子 " }),
        makeAsset({ id: "sc1", type: "scene", name: "麦田" }),
        makeAsset({ id: "c2", type: "character", name: "小兔子" }),
        makeAsset({ id: "st1", type: "style", name: "温暖治愈 3D 动画风" }),
        makeAsset({ id: "c3", type: "character", name: "   " }),
      ],
    };
    expect(collectSubjectVocabulary(project)).toEqual(["小兔子", "麦田"]);
    expect(collectSubjectVocabulary({ assets: [] })).toEqual([]);
  });

  it("getStylePrompt 原样返回派生物，不做二次清洗", () => {
    const project = {
      assets: [makeAsset({ id: "s1", type: "style", name: "style", prompt: "  fuzzy plush texture, warm tones  " })],
    };
    expect(getStylePrompt(project)).toBe("fuzzy plush texture, warm tones");
  });
});

describe("composeMultiReferencePrompt", () => {
  it("目标镜头差异前置，参考图只作资产身份锚点", () => {
    const out = composeMultiReferencePrompt({
      references: [
        { index: 1, role: "scene", note: "森林: misty forest" },
        { index: 2, role: "character", note: "小狐狸: a small fox" },
        { index: 3, role: "style", note: "整体风格: anime" },
      ],
      scene: "the fox walks in the forest",
    });
    expect(out).toContain("图 1 是场景参考：森林: misty forest");
    expect(out).toContain("图 2 是角色参考：小狐狸: a small fox");
    expect(out).toContain("图 3 是风格参考：整体风格: anime");
    expect(out).toContain("目标镜头：the fox walks in the forest");
    expect(out).toContain(
      "以目标镜头决定构图、动作与环境",
    );
    // 顺序：镜头差异 → 参考图说明 → 图像关系
    const idx1 = out.indexOf("图 1 是场景参考");
    const idxScene = out.indexOf("目标镜头");
    const idxAnchor = out.indexOf("以目标镜头决定构图");
    expect(idxScene).toBeLessThan(idx1);
    expect(idx1).toBeLessThan(idxAnchor);
  });

  it("note 为空的参考图被剔除，不产生空说明；style/lighting/composition 空段剔除", () => {
    const out = composeMultiReferencePrompt({
      references: [{ index: 1, role: "scene", note: "  " }],
      scene: "s",
      style: undefined,
      lighting: " ",
      composition: "",
    });
    expect(out).not.toContain("Image 1");
    expect(out).not.toContain("Style:");
    expect(out).not.toContain("Lighting:");
    expect(out).not.toContain("Composition:");
  });
});

/* ── composePortraitPrompt：物种锁定 ──────────────────────────────────────── */

describe("appendRegistryRules", () => {
  it("无规则返回原提示词（保持纯函数、零副作用）", () => {
    expect(appendRegistryRules("a fox in a forest")).toBe("a fox in a forest");
    expect(appendRegistryRules("a fox", undefined)).toBe("a fox");
  });

  it("composeShot 规则作为正向「构图规则」约束追加", () => {
    const out = appendRegistryRules("the fox walks", {
      composeShot: "declare each reference image role, never copy composition",
    });
    expect(out).toBe(
      "the fox walks, 构图规则：declare each reference image role, never copy composition",
    );
  });

  it("negativeStrategy 规则作为正向「质量要求」约束追加（不新增 negative 字段）", () => {
    const out = appendRegistryRules("the fox walks", {
      negativeStrategy: "keep negatives to generic defects; phrase avoid-items as positive",
    });
    expect(out).toBe(
      "the fox walks, 质量要求：keep negatives to generic defects; phrase avoid-items as positive",
    );
  });

  it("两者同时注入时顺序为 composeShot → negativeStrategy", () => {
    const out = appendRegistryRules("base", {
      composeShot: "multi-reference role declaration",
      negativeStrategy: "quality defects only",
    });
    const iComp = out.indexOf("构图规则");
    const iQual = out.indexOf("质量要求");
    expect(iComp).toBeGreaterThan(-1);
    expect(iQual).toBeGreaterThan(iComp);
  });

  it("空字符串规则不追加任何 block（等同无规则）", () => {
    expect(appendRegistryRules("base", { composeShot: "  ", negativeStrategy: "" })).toBe("base");
  });
});

describe("composeMultiReferencePrompt 注入注册表规则", () => {
  const refs = [
    { index: 1, role: "character" as const, note: "小狐狸: a small fox" },
    { index: 2, role: "product" as const, note: "杯子: a cup" },
  ];
  const rules: RegistryRuleText = {
    composeShot: "declare each reference role, never copy composition",
    negativeStrategy: "keep negatives to generic defects only",
  };

  it("rules 进入分镜图提示词，且位于参考图关系指令之后", () => {
    const out = composeMultiReferencePrompt({ references: refs, scene: "the fox walks", rules });
    expect(out).toContain("构图规则：declare each reference role, never copy composition");
    expect(out).toContain("质量要求：keep negatives to generic defects only");
    const iAnchor = out.indexOf("Use the target shot as the source of composition");
    const iComp = out.indexOf("构图规则");
    expect(iComp).toBeGreaterThan(iAnchor);
  });

  it("无 rules 时输出与旧行为一致（向后兼容，默认空 block 不污染）", () => {
    const withRules = composeMultiReferencePrompt({ references: refs, scene: "the fox walks" });
    expect(withRules).not.toContain("构图规则");
    expect(withRules).not.toContain("质量要求");
  });

  it("规则文本不含风格母版载体词（抽象样张等）—— 保持风格母版隔离铁律", () => {
    const out = composeMultiReferencePrompt({ references: refs, scene: "s", rules });
    expect(out).not.toContain("abstract style sample sheet");
    expect(out).not.toContain("material and texture swatches");
  });
});

describe("composeTextToImagePrompt 注入注册表规则", () => {
  it("rules 作为尾部正向约束拼入六段式结果", () => {
    const out = composeTextToImagePrompt({
      subject: "a small fox",
      style: "anime style",
      quality: "8k",
      rules: { composeShot: "reuse appearancePrompt verbatim", negativeStrategy: "no extra limbs" },
    });
    expect(out).toBe(
      "a small fox, anime style, 8k, 构图规则：reuse appearancePrompt verbatim, 质量要求：no extra limbs",
    );
  });

  it("无 rules 时六段式行为不变", () => {
    expect(composeTextToImagePrompt({ subject: "a red apple" })).toBe("a red apple");
  });
});

describe("composePortraitPrompt", () => {
  it("动物角色：中文物种锁定句（禁止人化），且不含人像语汇", () => {
    const out = composePortraitPrompt({
      appearancePrompt: "a small white rabbit with long ears",
    });
    expect(out).toContain("主体锁定：这个主体是");
    expect(out).toContain("绝不画成人物");
    expect(out).toContain("所描述动物的正常解剖结构");
    expect(out).toContain("符合该物种的正常肢体数量与位置");
    expect(out).not.toContain("Portrait of");
    expect(out).not.toContain("head and shoulders");
    expect(out).not.toContain("looking at camera");
  });

  it("物种判定优先吃结构化 species：英文描述无动物词也不再让狗退化", () => {
    // 历史缺陷：词表只认英文，"Realistic young Labrador Retriever" 被判成 humanoid，
    // 狗拿的是弱版通用锁定句（橘猫反而拿到强版物种锁定）。
    const out = composePortraitPrompt({
      appearancePrompt: "Realistic young Labrador Retriever, medium to large muscular build",
      species: "贵宾犬（泰迪）",
    });
    expect(out).toContain("这个主体是贵宾犬（泰迪）");
    expect(out).toContain("严格保留它的物种与品种");
    expect(out).toContain("所描述动物的正常解剖结构");
  });

  it("人物角色：通用主体锁定句与全身设定尾部", () => {
    const out = composePortraitPrompt({
      appearancePrompt: "a young woman with long dark hair",
    });
    expect(out).toContain("主体锁定：严格保留以下描述的主体类型与身份，绝不替换主体。");
    expect(out).toContain("全身角色设定图，身份一致，画面干净");
    expect(out).toContain("所描述主体的正常解剖结构");
    expect(out).not.toContain("绝不画成人物");
  });

  it("stylePrompt 追加在外观描述之后、尾部之前", () => {
    const out = composePortraitPrompt({
      appearancePrompt: "a small white rabbit.",
      stylePrompt: "watercolor illustration style",
    });
    expect(out).toContain("watercolor illustration style");
    expect(out.indexOf("watercolor")).toBeLessThan(out.indexOf("全身角色设定图"));
    // 风格段自带句末标点时不得叠出双句号
    expect(out).not.toContain("。。");
  });

  it("空 appearancePrompt 不产生空锁定句", () => {
    const out = composePortraitPrompt({ appearancePrompt: "", stylePrompt: "anime" });
    expect(out).not.toContain("主体锁定");
    expect(out).toContain("全身角色设定图");
  });

  it("产品主体走通用锁定句（非动物物种句）", () => {
    const out = composePortraitPrompt({
      appearancePrompt: "a product shot of a glass bottle",
    });
    expect(out).toContain("主体锁定：严格保留");
    expect(out).not.toContain("这个主体是");
  });

  it("stylePrompt 自带句号时不叠出双句号", () => {
    // 英文链路同样有此瑕疵（生产日志里 "feeling.. Normal anatomy"）
    const out = composePortraitPrompt({
      appearancePrompt: "一只棕色泰迪犬。",
      species: "贵宾犬（泰迪）",
      stylePrompt: "电影感写实，暖色调。",
    });
    expect(out).not.toContain("。。");
    expect(out).not.toContain("..");
  });

  it("取景约束前置于外观描述（实测末尾放法会画成半身胸像）", () => {
    const out = composePortraitPrompt({
      appearancePrompt: "一只棕色泰迪犬，卷曲浓密的毛发",
      species: "贵宾犬（泰迪）",
      stylePrompt: "电影感写实",
    });
    expect(out).toContain("取景：完整全身入画，含四肢、尾巴与脚掌");
    expect(out.indexOf("取景")).toBeLessThan(out.indexOf("一只棕色泰迪犬"));
  });
});

/* ── pickShotReferences ───────────────────────────────────────────────────── */

describe("pickShotReferences", () => {
  const sceneAsset = makeAsset({
    id: "scene_1",
    type: "scene",
    name: "Forest",
    imageUrl: "http://img/scene.png",
  });
  const charAsset = makeAsset({
    id: "char_1",
    type: "character",
    name: "Fox",
    imageUrl: "http://img/char.png",
  });
  const productAsset = makeAsset({
    id: "prod_1",
    type: "product",
    name: "Cup",
    imageUrl: "http://img/product.png",
  });
  const styleAsset = makeAsset({
    id: "style_1",
    type: "style",
    name: "整体风格",
    imageUrl: "http://img/style.png",
  });

  it("场景图退出分镜参考图，显式角色仍保留；风格图也不进入参考图", () => {
    const project = { assets: [sceneAsset, charAsset, styleAsset], styleReferenceUrl: undefined };
    const shot = makeShot({ sceneDesc: "walking in the Forest", activeCharacterIds: ["char_1"] });
    const refs = pickShotReferences(shot, project);
    expect(refs).toEqual(["http://img/char.png"]);
    expect(refs).not.toContain("http://img/scene.png");
    expect(refs).not.toContain("http://img/style.png");
  });

  it("场景图退出后按显式资产保留角色、产品和道具，最多 4 张", () => {
    const propAsset = makeAsset({ id: "prop_1", type: "prop", name: "Fence", imageUrl: "http://img/prop.png" });
    const project = { assets: [sceneAsset, charAsset, productAsset, propAsset, styleAsset], styleReferenceUrl: undefined };
    const shot = makeShot({ sceneDesc: "Forest", activeCharacterIds: ["char_1"], activeProductIds: ["prod_1"], activePropIds: ["prop_1"] });
    const refs = pickShotReferences(shot, project);
    expect(refs).toEqual([
      "http://img/char.png",
      "http://img/product.png",
      "http://img/prop.png",
    ]);
    expect(refs).toHaveLength(3);
    expect(refs).not.toContain("http://img/style.png");
  });

  it("去重：同一 URL 只出现一次", () => {
    const dupChar = makeAsset({
      id: "char_dup",
      type: "character",
      name: "Twin",
      imageUrl: "http://img/scene.png", // 与场景图相同 URL
    });
    const project = { assets: [sceneAsset, dupChar, styleAsset], styleReferenceUrl: undefined };
    const shot = makeShot({ sceneDesc: "Forest", activeCharacterIds: ["char_dup", "char_dup"] });
    const refs = pickShotReferences(shot, project);
    expect(refs.filter((u) => u === "http://img/scene.png")).toHaveLength(1);
  });

  it("没有显式资产引用时返回空数组，不回退场景图", () => {
    const sceneB = makeAsset({ id: "scene_2", type: "scene", name: "Beach", imageUrl: "http://img/beach.png" });
    const project = { assets: [sceneB, styleAsset], styleReferenceUrl: undefined };
    const shot = makeShot({ sceneDesc: "somewhere unrelated" });
    expect(pickShotReferences(shot, project)).toEqual([]);
  });

  it("无场景/角色/产品时返回空数组（纯文生图；风格图不再兜底）", () => {
    const project = { assets: [], styleReferenceUrl: "http://img/legacy-style.png" };
    expect(pickShotReferences(makeShot(), project)).toEqual([]);
  });

  it("P1-3：两个角色占满角色额度后，显式产品仍获得独立产品额度", () => {
    const char2 = makeAsset({ id: "char_2", type: "character", name: "Bear", imageUrl: "http://img/char2.png" });
    const project = { assets: [charAsset, char2, productAsset], styleReferenceUrl: undefined };
    const shot = makeShot({ activeCharacterIds: ["char_1", "char_2"], activeProductIds: ["prod_1"] });
    const refs = pickShotReferences(shot, project);
    // 修复前：产品计入角色额度，第三个被静默跳过 → 只剩两张角色图
    expect(refs).toEqual(["http://img/char.png", "http://img/char2.png", "http://img/product.png"]);
  });

  it("P1-3：远景仍收产品锚定（1 张）但拒道具特写图", () => {
    const project = { assets: [charAsset, productAsset], styleReferenceUrl: undefined };
    const shot = makeShot({ shotSize: "wide" as never, activeCharacterIds: ["char_1"], activeProductIds: ["prod_1"] });
    expect(pickShotReferences(shot, project)).toEqual([
      "http://img/char.png",
      "http://img/product.png",
    ]);
  });

  it("总数仍被 MAX_TOTAL_REFERENCES=4 封顶（角色2+产品1+道具2 → 4）", () => {
    const char2 = makeAsset({ id: "char_2", type: "character", name: "Bear", imageUrl: "http://img/char2.png" });
    const prop1 = makeAsset({ id: "prop_1", type: "prop", name: "Fence", imageUrl: "http://img/prop1.png" });
    const prop2 = makeAsset({ id: "prop_2", type: "prop", name: "Bucket", imageUrl: "http://img/prop2.png" });
    const project = { assets: [charAsset, char2, productAsset, prop1, prop2], styleReferenceUrl: undefined };
    const shot = makeShot({
      shotSize: "medium" as never,
      activeCharacterIds: ["char_1", "char_2"],
      activeProductIds: ["prod_1"],
      activePropIds: ["prop_1", "prop_2"],
    });
    const refs = pickShotReferences(shot, project);
    expect(refs).toHaveLength(4);
    expect(refs).toEqual([
      "http://img/char.png",
      "http://img/char2.png",
      "http://img/product.png",
      "http://img/prop1.png",
    ]);
  });

  it("角色参考优先 imageUrl，缺图时回退 avatarUrl", () => {
    const avatarChar = makeAsset({
      id: "char_av",
      type: "character",
      name: "Av",
      avatarUrl: "http://img/avatar.png",
    });
    const project = { assets: [avatarChar], styleReferenceUrl: undefined };
    expect(pickShotReferences(makeShot({ activeCharacterIds: ["char_av"] }), project)).toEqual([
      "http://img/avatar.png",
    ]);
  });
});

/* ── getStyleReferenceUrl / getStylePrompt ────────────────────────────────── */

describe("getStyleReferenceUrl", () => {
  it("style 资产 imageUrl 优先，旧字段兜底", () => {
    const project = {
      assets: [makeAsset({ id: "s1", type: "style", name: "style", imageUrl: "http://img/asset-style.png" })],
      styleReferenceUrl: "http://img/legacy.png",
    };
    expect(getStyleReferenceUrl(project)).toBe("http://img/asset-style.png");

    const legacyOnly = { assets: [], styleReferenceUrl: "http://img/legacy.png" };
    expect(getStyleReferenceUrl(legacyOnly)).toBe("http://img/legacy.png");
  });

  it("style 资产无图且无旧字段时返回 undefined", () => {
    const project = { assets: [makeAsset({ id: "s1", type: "style", name: "style" })], styleReferenceUrl: undefined };
    expect(getStyleReferenceUrl(project)).toBeUndefined();
  });
});

describe("getStylePrompt", () => {
  it("返回 style 资产的非空 prompt；无资产或空串返回 undefined", () => {
    const withPrompt = { assets: [makeAsset({ id: "s1", type: "style", name: "style", prompt: "anime, warm tones" })] };
    expect(getStylePrompt(withPrompt)).toBe("anime, warm tones");

    const empty = { assets: [makeAsset({ id: "s1", type: "style", name: "style", prompt: "  " })] };
    expect(getStylePrompt(empty)).toBeUndefined();
    expect(getStylePrompt({ assets: [] })).toBeUndefined();
  });
});

/* ── parseCharacterDescription（首行总述 + 8 要素行格式解析） ───────────────── */

describe("parseCharacterDescription", () => {
  it("解析「总述 + 8 要素行」为 summary + 字段数组", () => {
    const desc = [
      "一只怀抱胡萝卜安然入梦的小白兔。",
      "物种：兔",
      "身份：主角",
      "年龄：幼年",
      "性格：纯真安静",
      "外貌：圆滚滚的白色小兔，长耳朵内侧粉色",
      "服饰：淡蓝色小围巾",
      "记忆点：蓝围巾 + 歪耳朵",
      "背景：森林月夜里与兔妈相依",
    ].join("\n");
    const parsed = parseCharacterDescription(desc);
    expect(parsed.summary).toBe("一只怀抱胡萝卜安然入梦的小白兔。");
    expect(parsed.fields).toHaveLength(8);
    expect(parsed.fields[0]).toEqual({ label: "物种", value: "兔" });
    expect(parsed.fields[6]).toEqual({ label: "记忆点", value: "蓝围巾 + 歪耳朵" });
  });

  it("无总述行的 8 要素格式：summary 为 undefined，fields 正常", () => {
    const parsed = parseCharacterDescription("物种：兔\n身份：主角\n年龄：幼年");
    expect(parsed.summary).toBeUndefined();
    expect(parsed.fields).toHaveLength(3);
  });

  it("兼容英文冒号与值内冒号（取第一个冒号拆分）", () => {
    const parsed = parseCharacterDescription("物种:小白兔\n记忆点:蓝围巾: 蓝色系");
    expect(parsed.fields).toEqual([
      { label: "物种", value: "小白兔" },
      { label: "记忆点", value: "蓝围巾: 蓝色系" },
    ]);
  });

  it("兼容模型压成单行、使用句号分隔的 1+8 格式", () => {
    const parsed = parseCharacterDescription(
      "一只憨态可掬的小猪。物种：猪。身份：故事主角。年龄：幼年期。性格：贪玩、好奇。外貌：圆润的粉色身体。服饰：无。记忆点：圆滚滚的体型。背景：乡村田野居民。",
    );
    expect(parsed.summary).toBe("一只憨态可掬的小猪");
    expect(parsed.fields).toHaveLength(8);
    expect(parsed.fields[0]).toEqual({ label: "物种", value: "猪" });
    expect(parsed.fields[7]).toEqual({ label: "背景", value: "乡村田野居民" });
  });

  it("将单行角色描述规范化为总述 + 要素换行", () => {
    const normalized = normalizeCharacterDescription(
      "一只憨态可掬的小猪。物种：猪。身份：故事主角。年龄：幼年期。性格：贪玩、好奇。外貌：圆润的粉色身体。服饰：无。记忆点：圆滚滚的体型。背景：乡村田野居民。",
    );
    expect(normalized.split("\n")).toEqual([
      "一只憨态可掬的小猪",
      "物种：猪",
      "身份：故事主角",
      "年龄：幼年期",
      "性格：贪玩、好奇",
      "外貌：圆润的粉色身体",
      "服饰：无",
      "记忆点：圆滚滚的体型",
      "背景：乡村田野居民",
    ]);
  });

  it("已有换行格式保持原文，包括行尾标点", () => {
    const desc = "一只兔子。\n物种：兔。\n身份：主角。";
    expect(normalizeCharacterDescription(desc)).toBe(desc);
  });

  it("自由文本即使包含字段词也不强行结构化（首行含冒号 → 非「总述+要素」结构，保持原文）", () => {
    const desc = "说明：这是一段自由文本。物种：兔。身份：主角。年龄：幼年。性格：安静。外貌：白色。服饰：围巾。记忆点：蓝眼睛。背景：森林。";
    expect(normalizeCharacterDescription(desc)).toBe(desc);
  });

  it("单行压缩描述命中 ≥6 个角色字段即规范化（容忍缺字段）", () => {
    const desc = "一只兔子。物种：兔。身份：主角。年龄：幼年。性格：安静。外貌：白色。服饰：围巾。背景：森林。";
    expect(normalizeCharacterDescription(desc).split("\n")).toEqual([
      "一只兔子",
      "物种：兔",
      "身份：主角",
      "年龄：幼年",
      "性格：安静",
      "外貌：白色",
      "服饰：围巾",
      "背景：森林",
    ]);
  });

  it("模型改用长标签措辞时仍能解析（回归：曾因标签超 6 字导致简介与设定全丢）", () => {
    const desc = [
      "一只圆润贪玩、憨态可掬的小猪仔，毛茸茸的粉色身体透着天真与温柔",
      "物种：猪（幼年小猪仔）",
      "身份：故事主角，乡间小猪",
      "年龄：幼年（小猪仔）",
      "性格与行为倾向：贪玩、好奇心强，喜欢用鼻子拱动地面探索",
      "外貌：全身圆润饱满，比例偏短粗",
      "服饰与配饰：无服饰，保持自然体态",
      "记忆点：圆滚滚的粉色身体、水汪汪大眼",
      "来历与角色关系：乡间长大的小猪仔，在篱笆旁与小狗意外相遇",
    ].join("\n");
    const parsed = parseCharacterDescription(desc);
    expect(parsed.summary).toBe("一只圆润贪玩、憨态可掬的小猪仔，毛茸茸的粉色身体透着天真与温柔");
    expect(parsed.fields).toHaveLength(8);
    expect(parsed.fields.map((f) => f.label)).toContain("性格与行为倾向");
    expect(parsed.fields.map((f) => f.label)).toContain("服饰与配饰");
  });

  it("规范化保持幂等", () => {
    const desc = "一只兔子。物种：兔。身份：主角。年龄：幼年。性格：安静。外貌：白色。服饰：围巾。记忆点：蓝眼睛。背景：森林。";
    const normalized = normalizeCharacterDescription(desc);
    expect(normalizeCharacterDescription(normalized)).toBe(normalized);
  });

  it("旧版一句话描述（单行无前缀）：整段作为简介，fields 为空", () => {
    const parsed = parseCharacterDescription("一只安详入睡的小兔子，怀里抱着胡萝卜。");
    expect(parsed.summary).toBe("一只安详入睡的小兔子，怀里抱着胡萝卜。");
    expect(parsed.fields).toHaveLength(0);
  });

  it("字段后出现无前缀行：续接到上一字段值（模型偶发换行，不丢信息）", () => {
    const parsed = parseCharacterDescription("物种：小白兔\n这是一句没有前缀的说明文字。\n身份：主角");
    expect(parsed.fields).toEqual([
      { label: "物种", value: "小白兔 这是一句没有前缀的说明文字。" },
      { label: "身份", value: "主角" },
    ]);
  });

  it("标签长度上限放宽到 24 字（真实标签如「前景、中景、背景与空间层次」需容纳）", () => {
    const parsed = parseCharacterDescription("这是一个较长的标签名称：内容\n物种：兔");
    expect(parsed.fields[0]).toEqual({ label: "这是一个较长的标签名称", value: "内容" });
  });

  it("空文本：fields 为空", () => {
    expect(parseCharacterDescription("").fields).toHaveLength(0);
    expect(parseCharacterDescription("  \n  ").fields).toHaveLength(0);
  });
});
