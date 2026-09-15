// ────────────────────────────────────────────────────────────────────────────
// src/lib/promptRules.ts
// 提示词规则注册表（T04）：内置条目 BUILTIN_RULES + 骨架 SKELETONS + 渲染/合并。
//
// 设计要点：
// - 禁 enum（erasableSyntaxOnly），全部用联合类型；
// - 条目 content 为 zh/en 成对：zh 版提示词里的规则文本为中文、en 版为英文，
//   按调用 language 取对应份（polish/character 条目原文为单语文本，zh=en=原文，不翻译）；
// - JSON 输出格式与字段定义留在 SKELETONS（含 {{rules}}/{{examples}}/{{safety}} 占位符）；
//   动态数据（已有角色/场景/产品/风格列表）不入条目，由服务层在 {{assets}} 槽内拼装；
// - 渲染顺序 rules → examples → safety；同 section 内按 BUILTIN_RULES 定义顺序，
//   custom 条目追加其后；enabled=false 剔除；
// - 用户改动只存差异（settingsStore.promptRules），mergeRules 时同 id 覆盖内置。
// ────────────────────────────────────────────────────────────────────────────

import { useSettingsStore } from "@/stores/settingsStore";

/* ── 类型 ────────────────────────────────────────────────────────────────── */

/** 规则所属任务（决定该条目参与哪个 system prompt 的渲染） */
export type PromptTask =
  | "extractAssets"
  | "visualDirection"
  | "visualDirectionAudit"
  | "storyboardOutline"
  | "storyboardShot"
  | "characterAppearance"
  | "styleRef"
  | "stylePromptAudit"
  | "generationParams"
  | "composeShot"
  | "negativeStrategy"
  | "polish";

/** 规则区块（渲染顺序固定：rules → examples → safety） */
export type RuleSection = "rules" | "examples" | "safety";

export interface PromptRule {
  /** 唯一标识；内置条目为 "task.name" 形式，自定义条目为 "custom.*" */
  id: string;
  task: PromptTask;
  section: RuleSection;
  /** 条目文本（zh/en 成对；单语条目 zh=en=原文） */
  content: { zh: string; en: string };
  enabled: boolean;
  /** builtin = 内置条目（可被同 id 覆盖）；custom = 用户自建 */
  source: "builtin" | "custom";
}

/* ── 骨架（JSON 格式 + 字段定义留在骨架，占位符注入规则） ──────────────────── */

/**
 * SKELETONS：每个任务一份 zh/en 骨架。
 * 占位符机制：
 * - {{#rules}}...{{rules}}...{{/rules}} 块：section 有条目时保留块内结构并注入，
 *   无条目时整块（含 "重要规则：" 等 header 行）移除；
 * - {{assets}} 裸占位符：动态资产上下文，由服务层（scriptService）函数内拼装替换。
 */
export const SKELETONS: Record<PromptTask, { zh: string; en: string }> = {
  visualDirection: {
    zh: `你是一位视觉指导。请从用户的视频想法中提炼项目级视觉方向，只返回 JSON：
{
  "name": "视觉方向名称",
  "description": "一句话视觉方向简介",
  "details": {
    "mediumMaterial": "媒介与材质（画风/渲染方式，如 2D 动画、水彩、写实摄影、3D 渲染）",
    "colorPalette": "主色调与明暗关系",
    "lightingMood": "光影氛围",
    "cameraTexture": "镜头质感与景深",
    "composition": "构图规律与留白",
    "emotion": "整体情绪氛围"
  }
}
只提取可复用的视觉语言：媒介、材质、色彩、光影、镜头质感、构图规律与氛围。不要写具体人物、动物、角色、产品、道具、故事动作或角色关系。details 各字段都只描述视觉语言本身，不承载故事主体。`,
    en: `You are a visual director. Extract a project-level visual direction from the user's video idea. Return JSON only:
{
  "name": "Visual direction name",
  "description": "One-sentence visual direction summary",
  "details": {
    "mediumMaterial": "Medium and material (art form / rendering, e.g. 2D animation, watercolor, photographic, 3D render)",
    "colorPalette": "Color palette and contrast",
    "lightingMood": "Lighting and mood",
    "cameraTexture": "Camera texture and depth of field",
    "composition": "Composition patterns and negative space",
    "emotion": "Overall atmosphere"
  }
}
Extract only reusable visual language: medium, material, color, lighting, camera texture, composition patterns and atmosphere. Do not write specific people, animals, characters, products, props, story actions or character relationships. Every details field describes only the visual language itself, never story subjects.`,
  },

  /* ── 风格提示词审计（校验/重写 stylePrompt，数据驱动，判断权归模型） ── */
  stylePromptAudit: {
    zh: `You are an image prompt auditor. Given an English style prompt (stylePrompt) and a "forbidden subject list" (derived from the project's own character names, asset names and story keywords), decide whether the prompt overreaches.

A style prompt is valid ONLY when it describes reusable visual language carried by an abstract sample sheet. It overreaches if ANY of these is true:
1. It mentions a specific subject from the list (character / product / prop / scene name).
2. It describes story actions, narrative scenes or concrete objects.
3. It implies a recognizable subject silhouette.
4. It would make the image model render a concrete entity as the frame's subject — an animal, creature, character, person, face, product, vehicle, readable landscape or room — EVEN IF that entity is not on the list. Judge by what the language forces the model to draw, not only by named entities: "fine fur textures" together with "extreme tenderness and pure healing emotion" reads as a fluffy animal even though no animal is named, and a soft diffuse-material passage with no renderable content makes the model invent a subject. Missing entity names do not make a prompt clean.
5. It uses a subject-bound material word (fur, hair, feather, plush, skin, scale) as bare overall style language instead of as abstract material handling attached to a carrier.
6. It carries any sheet/board composition wording (sample sheet, swatches, colour chips, grid, carrier, symmetric layout on a board) — this prompt is appended to every image call, so carrier composition must stay out; it belongs only to the style-master assembly layer.

Valid output describes only reusable visual language on an explicit abstract carrier.

Return JSON only:
{
  "clean": true or false,
  "reason": "why it overreaches (empty string when clean is true)",
  "rewritten": "if clean is false, return the rewritten pure-style prompt (one to three sentences, English); empty string when clean is true"
}
rewritten 必须保留原提示词的整体风格基调，把视觉语言承载到抽象样张上（材质/肌理样张、色卡、光影研究、笔触样张），并把主体绑定材质词改写为挂在载体上的抽象材质样本（如 "fur-like fibre texture swatch"）；不得引入新的主体或剧情。`,
    en: `You are an image prompt auditor. Given an English style prompt (stylePrompt) and a "forbidden subject list" (derived from the project's own character names, asset names and story keywords), decide whether the prompt overreaches.

A style prompt is valid ONLY when it describes reusable visual language carried by an abstract sample sheet. It overreaches if ANY of these is true:
1. It mentions a specific subject from the list (character / product / prop / scene name).
2. It describes story actions, narrative scenes or concrete objects.
3. It implies a recognizable subject silhouette.
4. It would make the image model render a concrete entity as the frame's subject — an animal, creature, character, person, face, product, vehicle, readable landscape or room — EVEN IF that entity is not on the list. Judge by what the language forces the model to draw, not only by named entities: "fine fur textures" together with "extreme tenderness and pure healing emotion" reads as a fluffy animal even though no animal is named, and a soft diffuse-material passage with no renderable content makes the model invent a subject. Missing entity names do not make a prompt clean.
5. It uses a subject-bound material word (fur, hair, feather, plush, skin, scale) as bare overall style language instead of as abstract material handling attached to a carrier.
6. It carries any sheet/board composition wording (sample sheet, swatches, colour chips, grid, carrier, symmetric layout on a board) — this prompt is appended to every image call, so carrier composition must stay out; it belongs only to the style-master assembly layer.

Valid output describes only reusable visual language on an explicit abstract carrier.

Return JSON only:
{
  "clean": true or false,
  "reason": "why it overreaches (empty string when clean is true)",
  "rewritten": "if clean is false, return the rewritten pure-style prompt (one to three sentences, English); empty string when clean is true"
}
The rewritten prompt must keep the original overall style tone, stay as PURE reusable visual language (medium, colour, lighting, material handling, camera texture, mood) with NO sheet/board composition wording, and convert subject-bound material words into abstract material handling (e.g. "fur-like fibre texture"); it must not introduce new subjects or plot.`,
  },

  /* ── 视觉方向自检（校验/重写视觉方向，判断权归模型） ── */
  visualDirectionAudit: {
    zh: `你是一位视觉指导。给定一个项目级视觉方向（六个视觉维度 + 一句话简介）与一份"禁止出现的主体清单"（可能为空），判断这些内容是否越界：
- 是否出现了清单中的具体主体（角色/场景/产品/道具名）
- 是否描述了故事动作、叙事场景、角色关系或具体物件
- 是否把主体绑定材质词（毛发、皮肤、羽毛、绒毛、鳞片）当作具体主体或整体画风来描述，而不是作为抽象载体上的材质样本（如"毛绒肌理样张"）

合格标准：只描述可复用的视觉语言——媒介与渲染方式、色彩关系、光影、镜头质感、构图规律、情绪氛围。主体绑定材质若要保留，须表述为抽象材质样本（毛绒/皮革/织物肌理等），不得指向任何生物或物件。

只返回 JSON：
{
  "clean": true 或 false,
  "reason": "越界原因（clean 为 true 时为空字符串）",
  "rewritten": "若 clean 为 false，返回重写后的视觉方向，结构与输入一致：{ name, description, details: { mediumMaterial, colorPalette, lightingMood, cameraTexture, composition, emotion } }；clean 为 true 时为空对象 {}"
}
重写必须保持原方向的整体风格基调，只移除越界的主体/叙事内容，不得引入新的主体、剧情或具体物件。`,
    en: `You are a visual director. Given a project-level visual direction (six visual dimensions plus a one-sentence summary) and a "forbidden subject list" (may be empty), decide whether the content overreaches:
- Does it mention a specific subject from the list (character / scene / product / prop name)?
- Does it describe story actions, narrative scenes, character relationships or concrete objects?
- Does it treat a subject-bound material word (fur, hair, feather, plush, skin, scale) as a concrete subject or as the overall art style, instead of as an abstract material sample on a carrier?

Valid output describes only reusable visual language: medium and rendering, color relationships, lighting, camera texture, composition patterns and atmosphere. When a subject-bound material must be kept, it has to be worded as an abstract material sample (plush / leather / fabric grain sample) and must not point at any living being or object.

Return JSON only:
{
  "clean": true or false,
  "reason": "why it overreaches (empty string when clean is true)",
  "rewritten": "if clean is false, return the rewritten visual direction with the same shape as the input: { name, description, details: { mediumMaterial, colorPalette, lightingMood, cameraTexture, composition, emotion } }; empty object {} when clean is true"
}
The rewrite must keep the original overall style tone and only remove the overreaching subject/narrative content; it must not introduce new subjects, plot or concrete objects.`,
  },

  /* ── 生成参数决策（温度/采样/Thinking 由模型按用途决定） ── */
  generationParams: {
    zh: `你是模型调用参数规划器。给定一个生成用途与它的上下文，决定这次调用最合适的文本模型采样参数，目标是让该用途的输出质量最高。

可选参数与合法范围：
- temperature：0 ~ 2。需要稳定、可复现、结构化输出时取低值；需要创意、多样性时取高值。
- topP：0.01 ~ 1。核采样阈值，通常 0.8 ~ 1。
- enableThinking：true 或 false。需要多步推理、复杂约束权衡、长任务规划时开启；纯格式化/改写/翻译类任务关闭更稳。审计/校验/重写类用途（purpose 含 audit）必须 false —— 深度推理会让同一次调用耗时翻倍。

只返回 JSON：
{
  "temperature": 0.7,
  "topP": 1,
  "enableThinking": false,
  "reason": "一句话说明为什么这样取值"
}
不要返回其他字段，不要解释范围之外的参数。`,
    en: `You are a model-call parameter planner. Given a generation purpose and its context, decide the best text-model sampling parameters for that purpose, aiming for the highest output quality.

Available parameters and legal ranges:
- temperature: 0 to 2. Use low values for stable, reproducible, structured output; higher values for creativity and variety.
- topP: 0.01 to 1. Nucleus sampling threshold, typically 0.8 to 1.
- enableThinking: true or false. Enable for multi-step reasoning, trade-offs among complex constraints and long-task planning; disable for pure formatting/rewriting/translation tasks. Audit/rewrite purposes (purpose containing "audit") must be false — deep reasoning doubles the latency of the same call.

Return JSON only:
{
  "temperature": 0.7,
  "topP": 1,
  "enableThinking": false,
  "reason": "one sentence explaining the choice"
}
Return no other fields and no parameters outside the legal range.`,
  },

  /* ── 步骤 1 轻量资产提取（scriptService.extractAssetsFromIdea） ── */
  extractAssets: {
    zh: `你是一位专业的视频资产提取助手。用户会给你一个视频主题或想法，请提取其中的资产信息，严格按以下 JSON 格式返回，不要包含任何其他文字：
{
  "characters": [
    { "name": "角色名", "description": "一句话总述", "details": { "species": "物种", "role": "身份", "age": "年龄阶段", "personality": "性格与行为倾向", "appearance": "体型、比例、五官、颜色、材质", "outfit": "服饰与配饰", "signature": "跨镜头识别特征", "background": "来历与角色关系" }, "appearancePrompt": "完整英文外观提示词" }
  ],
  "products": [
    { "name": "产品名", "description": "一句话定位", "details": { "category": "产品类型", "purpose": "核心用途", "silhouette": "整体轮廓与比例", "dimensions": "尺寸与比例", "color": "颜色", "material": "材质", "structure": "结构组成", "surfaceDetails": "表面细节", "branding": "品牌或 Logo", "signature": "不可改变的识别特征", "usageState": "使用状态" }, "appearancePrompt": "完整英文产品外观提示词" }
  ],
  "props": [
    { "name": "道具名", "description": "一句话定位", "details": { "purpose": "道具用途", "storyRole": "故事作用", "objectType": "物件类型", "shape": "整体形状", "dimensions": "尺寸与比例", "material": "材质", "color": "颜色", "structure": "结构细节", "wear": "磨损与使用痕迹", "signature": "特殊标记或识别特征", "usage": "在镜头中的使用方式" }, "appearancePrompt": "完整英文道具外观提示词" }
  ],
  "scenes": [
    { "name": "场景名", "description": "一句话定位", "details": { "settingType": "空间类型", "environment": "地理与环境", "time": "时间", "weather": "天气", "elements": "主要元素", "spatialLayers": "前景、中景、背景与空间层次", "lighting": "光线方向与质量", "paletteMood": "色彩与氛围", "storyUse": "可用于哪些剧情" }, "appearancePrompt": "完整英文场景外观提示词" }
  ],
  "styles": [
    {
      "name": "风格名",
      "description": "一句话视觉方向简介（中文）",
      "details": { "mediumMaterial": "媒介与材质", "colorPalette": "主色调与明暗关系", "lightingMood": "光影氛围", "cameraTexture": "镜头质感与景深", "composition": "构图规律与留白", "emotion": "整体情绪氛围" }
    }
  ]
}
{{assets}}
{{#rules}}
规则：
{{rules}}
{{/rules}}
{{#examples}}
参考示例：
{{examples}}
{{/examples}}
{{#safety}}
{{safety}}
{{/safety}}
- appearancePrompt 必须只描述对应资产本身的可视化外观，不写故事动作、角色关系或其他资产；视觉方向只提供画风参考，不把故事主体写入视觉方向描述
- 场景 appearancePrompt 只描述环境、空间、时间、天气、光线、材质与氛围；产品和道具 appearancePrompt 只描述物件本体
- 不要生成分镜，只返回上述 JSON`,
    en: `You are a professional video asset extraction assistant. The user will give you a video topic or idea. Extract asset info and return strictly in this JSON format, no other text:
{
  "characters": [
    { "name": "Character name", "description": "Full character description in Chinese (exactly 9 lines: line 1 is a one-sentence summary without prefix; lines 2-9 are 8 elements, each line prefixed with the element name + colon, in order: species → role → age → personality → looks → outfit → signature → background)", "appearancePrompt": "Appearance description in English (for AI image generation)" }
  ],
  "products": [
    { "name": "Product name", "description": "Brief description", "appearancePrompt": "Appearance description in English (style, color, material, logo, etc.)" }
  ],
  "props": [
    { "name": "Prop name", "description": "Brief description (purpose and key visual traits)", "appearancePrompt": "Appearance description in English (material, color, shape and distinctive details)" }
  ],
  "scenes": [
    { "name": "Scene name", "description": "Brief description", "appearancePrompt": "English scene description (environment, lighting, atmosphere)" }
  ],
  "styles": [
    {
      "name": "Style name",
      "description": "One-sentence visual direction summary",
      "details": { "mediumMaterial": "Medium and material", "colorPalette": "Color palette and contrast", "lightingMood": "Lighting and mood", "cameraTexture": "Camera texture and depth", "composition": "Composition patterns and negative space", "emotion": "Overall atmosphere" }
    }
  ]
}
{{assets}}
{{#rules}}
Rules:
{{rules}}
{{/rules}}
{{#examples}}
Examples:
{{examples}}
{{/examples}}
{{#safety}}
{{safety}}
{{/safety}}
- appearancePrompt must describe only the visual appearance of its own asset, not story action, character relationships or other assets; the visual direction must contain style language, not story subjects
- Scene appearancePrompt describes only environment, space, time, weather, lighting, material and atmosphere; product and prop appearancePrompt describe only the object itself
- Do NOT generate storyboard shots; return only the JSON above`,
  },

  /* ── 步骤 3 分镜大纲（scriptService.generateStoryboardOutline） ── */
  storyboardOutline: {
    zh: `你是一位专业的视频分镜策划师。用户会给你一个主题或想法。你的任务是把想法规划为镜头大纲（先规划、后细化，不要写具体提示词）：
1. 将其拆分为 4-8 个镜头，每个镜头 4-8 秒，保持叙事连贯、有情绪节奏
2. 每个镜头给出一句话内容概括（发生了什么、关键画面、情绪节拍）
3. 指出该镜头涉及的角色名与场景名（必须使用"已有资产清单"中的原名；涉及才列，不涉及为空）
4. 仅当想法明确需要清单中没有的新角色/新场景时，在 newCharacters/newScenes 中给出完整资产（结构同资产提取），否则给空数组
{{assets}}
{{#rules}}
重要规则：
{{rules}}
{{/rules}}
{{#examples}}
参考示例：
{{examples}}
{{/examples}}
{{#safety}}
⚠️ 内容安全要求：
{{safety}}
{{/safety}}
严格按以下 JSON 格式返回，不要包含任何其他文字：
{
  "shots": [
    { "title": "镜头小标题", "summary": "一句话内容概括", "characterNames": ["角色名"], "sceneName": "场景名" }
  ],
  "newCharacters": [],
  "newScenes": []
}`,
    en: `You are a professional video storyboard planner. The user gives you a topic or idea. Plan the shot breakdown (plan first, details come later — do NOT write image prompts):
1. Break it into 4-8 shots, each 4-8 seconds, with coherent narrative and emotional pacing
2. For each shot give a one-sentence summary (what happens, the key visual, the emotional beat)
3. Name the characters and scene involved in each shot (use EXACT names from the "existing assets" list; leave empty when not involved)
4. Only when the idea clearly requires characters/scenes missing from the list, provide full assets in newCharacters/newScenes (same schema as asset extraction); otherwise use empty arrays
{{assets}}
{{#rules}}
Important rules:
{{rules}}
{{/rules}}
{{#examples}}
Examples:
{{examples}}
{{/examples}}
{{#safety}}
Content safety:
{{safety}}
{{/safety}}
Return strict JSON in exactly this format, no other text:
{
  "shots": [
    { "title": "shot title", "summary": "one-sentence summary", "characterNames": ["name"], "sceneName": "scene name" }
  ],
  "newCharacters": [],
  "newScenes": []
}`,
  },

  /* ── 步骤 3 单镜头细化（scriptService.generateStoryboardShot） ── */
  storyboardShot: {
    zh: `你是一位专业的视频分镜设计师。你会拿到分镜大纲与其中一个镜头的计划，你的任务是把这一个镜头写完整：
1. scriptText：该镜头的叙事脚本（含动作与情绪，语言随用户输入）
2. visualPrompt：完整英文画面提示词——主体外观（直接沿用所给资产的英文外观描述）、动作、环境、构图与镜头；只描述该镜头
3. motionPrompt：完整英文运动提示词——主体动作、镜头运动、环境变化
4. 其余描述字段（sceneDesc/detailDesc/lightingDesc/styleDesc/actionDesc/cameraDesc/envChangeDesc/motionSpeedDesc/negativePrompt/negativeMotionPrompt）逐项填写
5. dialogues 按需给对白（characterId 用角色名），activeCharacterIds/activeSceneId 用涉及资产的原名，duration 从 4/5/8 中选
{{assets}}
{{#rules}}
重要规则：
{{rules}}
{{/rules}}
{{#examples}}
参考示例：
{{examples}}
{{/examples}}
{{#safety}}
⚠️ 内容安全要求：
{{safety}}
{{/safety}}
只输出这一个镜头的 JSON 对象（不是数组），不要包含任何其他文字。所有字段都必须非空（negativePrompt 可以是简短的质量负面词）。`,
    en: `You are a professional video storyboard designer. You get the storyboard outline and the plan of ONE shot. Write that single shot completely:
1. scriptText: the narrative script for this shot (action and emotion, follow the user's language)
2. visualPrompt: a complete ENGLISH image prompt — subject appearance (reuse the provided asset appearance descriptions verbatim), action, environment, composition and camera; describe only this shot
3. motionPrompt: a complete ENGLISH motion prompt — subject motion, camera movement, environmental changes
4. Fill every other description field (sceneDesc/detailDesc/lightingDesc/styleDesc/actionDesc/cameraDesc/envChangeDesc/motionSpeedDesc/negativePrompt/negativeMotionPrompt)
5. dialogues when needed (characterId = character name); activeCharacterIds/activeSceneId use exact asset names; duration from 4/5/8
{{assets}}
{{#rules}}
Important rules:
{{rules}}
{{/rules}}
{{#examples}}
Examples:
{{examples}}
{{/examples}}
{{#safety}}
Content safety:
{{safety}}
{{/safety}}
Output ONLY this single shot as a JSON object (not an array), no other text. Every field must be non-empty (negativePrompt may be a short quality negative).`,
  },

  /* ── 角色外貌生成（CharacterEditor 外貌 AI 生成） ──
   * 原 SYSTEM_PROMPT_CHARACTER 为单语文本：骨架与条目 zh=en=英文原文 */
  characterAppearance: {
    zh: `You are an expert at writing character appearance descriptions used as consistency anchors for AI image generation.

Core rule — never change the subject's identity:
{{#rules}}
{{rules}}
{{/rules}}

What to produce:
- Always respond in English (the description is sent directly to an image model)
- Combine BOTH the given name and the description: species/type, body shape and proportions, colors and materials, fur/hair, clothing or accessories, plus 1-2 distinguishing features
- Reflect the stated mood or state (e.g. sleeping, cheerful) through posture and expression — do not describe camera movement or actions
- Keep it 1-3 sentences, concise but specific enough to keep the character consistent across shots

Hard constraints (MUST follow):
- Keep clothing descriptions modest and appropriate
- If the subject is human and young, prefer age-neutral wording such as "young man / young woman / teenager" over "boy / girl / child" (the image API may reject the latter)
- Avoid anything that could trigger content moderation filters

Style examples — note the subject type is always preserved:
- Name "小兔子", description "主角，可爱纯真，正在睡觉" → "A small fluffy white rabbit with long upright ears, pink inner ears, a tiny round nose and soft dark eyes, wearing a pale blue knitted scarf, curled up asleep with a calm and gentle expression"
- Name "小林", description "咖啡店店员，温柔" → "A young woman in her mid-20s with a soft round face, long straight black hair, slim build and fair skin, wearing a beige apron over a white shirt, calm and gentle expression"

Return ONLY the appearance description, with no explanations and no bullet points.`,
    en: `You are an expert at writing character appearance descriptions used as consistency anchors for AI image generation.

Core rule — never change the subject's identity:
{{#rules}}
{{rules}}
{{/rules}}

What to produce:
- Always respond in English (the description is sent directly to an image model)
- Combine BOTH the given name and the description: species/type, body shape and proportions, colors and materials, fur/hair, clothing or accessories, plus 1-2 distinguishing features
- Reflect the stated mood or state (e.g. sleeping, cheerful) through posture and expression — do not describe camera movement or actions
- Keep it 1-3 sentences, concise but specific enough to keep the character consistent across shots

Hard constraints (MUST follow):
- Keep clothing descriptions modest and appropriate
- If the subject is human and young, prefer age-neutral wording such as "young man / young woman / teenager" over "boy / girl / child" (the image API may reject the latter)
- Avoid anything that could trigger content moderation filters

Style examples — note the subject type is always preserved:
- Name "小兔子", description "主角，可爱纯真，正在睡觉" → "A small fluffy white rabbit with long upright ears, pink inner ears, a tiny round nose and soft dark eyes, wearing a pale blue knitted scarf, curled up asleep with a calm and gentle expression"
- Name "小林", description "咖啡店店员，温柔" → "A young woman in her mid-20s with a soft round face, long straight black hair, slim build and fair skin, wearing a beige apron over a white shirt, calm and gentle expression"

Return ONLY the appearance description, with no explanations and no bullet points.`,
  },

  /* ── 风格提示词派生（useWizardActions.deriveStylePrompt） ── */
  styleRef: {
    zh: `You are a visual style director. Based only on the desired visual direction fields, produce ONE English image-style prompt that will be used to generate a STYLE SAMPLE SHEET (a style master board), not an illustration.

The prompt MUST describe ONLY reusable visual language:
- medium / art form
- color palette
- lighting mood
- atmosphere / material / texture
- composition and camera treatment

CARRIER RULE (critical, 2026-09-15 revised): this prompt will be appended to EVERY image call in the project (asset images, shot images), not only the style master. So it must be PURE reusable visual language — medium, colour relationships, lighting, material handling, camera texture and mood. It must NOT carry any sheet/board composition words (sample sheet, swatches, colour chips, grid, carrier, symmetric layout on a board): that carrier composition belongs ONLY to the style-master assembly layer and will otherwise make every asset image render swatch-board squares.

SUBJECT-BOUND MATERIAL RULE: words that normally belong to a living subject (fur, hair, feather, plush, skin, scale, fin) must be worded as abstract material handling (e.g. "fur-like fibre texture", "plush-surface material feel"), never left as a bare overall style word ("fine fur textures"), because a bare material word plus a soft/healing mood reads to the image model as an animal.

NEVER let any concrete entity become the frame's subject: no animal, no creature, no character, no person, no face, no product, no vehicle, no readable landscape or room, no narrative action, no text, no watermark.

{{#rules}}
{{rules}}
{{/rules}}
{{#examples}}
Examples:
{{examples}}
{{/examples}}

Output ONLY the prompt text itself, one to three sentences, no quotes, no explanation.`,
    en: `You are a visual style director. Based only on the desired visual direction fields, produce ONE English image-style prompt that will be used to generate a STYLE SAMPLE SHEET (a style master board), not an illustration.

The prompt MUST describe ONLY reusable visual language:
- medium / art form
- color palette
- lighting mood
- atmosphere / material / texture
- composition and camera treatment

CARRIER RULE (critical, 2026-09-15 revised): this prompt will be appended to EVERY image call in the project (asset images, shot images), not only the style master. So it must be PURE reusable visual language — medium, colour relationships, lighting, material handling, camera texture and mood. It must NOT carry any sheet/board composition words (sample sheet, swatches, colour chips, grid, carrier, symmetric layout on a board): that carrier composition belongs ONLY to the style-master assembly layer and will otherwise make every asset image render swatch-board squares.

SUBJECT-BOUND MATERIAL RULE: words that normally belong to a living subject (fur, hair, feather, plush, skin, scale, fin) must be worded as abstract material handling (e.g. "fur-like fibre texture", "plush-surface material feel"), never left as a bare overall style word ("fine fur textures"), because a bare material word plus a soft/healing mood reads to the image model as an animal.

NEVER let any concrete entity become the frame's subject: no animal, no creature, no character, no person, no face, no product, no vehicle, no readable landscape or room, no narrative action, no text, no watermark.

{{#rules}}
{{rules}}
{{/rules}}
{{#examples}}
Examples:
{{examples}}
{{/examples}}

Output ONLY the prompt text itself, one to three sentences, no quotes, no explanation.`,
  },

  /* ── 分镜画面提示词拼装规范（composeShot 纯函数拼装的约束文档条目） ── */
  composeShot: {
    zh: `分镜画面提示词拼装规范：
{{#rules}}
{{rules}}
{{/rules}}
{{#examples}}
参考示例：
{{examples}}
{{/examples}}
{{#safety}}
{{safety}}
{{/safety}}`,
    en: `Shot image prompt composition rules:
{{#rules}}
{{rules}}
{{/rules}}
{{#examples}}
Examples:
{{examples}}
{{/examples}}
{{#safety}}
{{safety}}
{{/safety}}`,
  },

  /* ── 负向提示词策略（文档条目） ── */
  negativeStrategy: {
    zh: `负向提示词策略：
{{#rules}}
{{rules}}
{{/rules}}`,
    en: `Negative prompt strategy:
{{#rules}}
{{rules}}
{{/rules}}`,
  },

  /* ── 一键润色（polishText 的 8 个专家角色，单语原文整体作为条目） ── */
  polish: {
    zh: `{{#rules}}
{{rules}}
{{/rules}}`,
    en: `{{#rules}}
{{rules}}
{{/rules}}`,
  },
};

/* ── 内置条目 ─────────────────────────────────────────────────────────────── */

/* polish 专家系统提示词（原 chatService 常量搬迁至此，chatService 转为再导出；
 * 单语原文整体作为单条目，不翻译——内容与迁移前逐字一致，零行为变化） */

export const SYSTEM_PROMPT_SCRIPT_TEXT = `你是一位专业的视频文案优化专家。用户会给你一段视频旁白或文案，请帮助优化和改进。

要求：
- 保持原有语义和核心信息
- 让文案更有感染力和节奏感
- 适合配合画面朗读
- 简洁有力，避免冗长
- 直接返回优化后的文案，不要加任何解释说明

如果用户有特定的修改要求，按照要求调整。每次回复都返回完整的优化后文案。`;

export const SYSTEM_PROMPT_VISUAL_PROMPT = `You are an expert AI image prompt engineer. The user will give you a visual description intended for AI image generation. Help optimize it for better results.

Requirements:
- Always respond in English
- Include specific details about: style, composition, lighting, color palette, mood
- Use professional photography/art terminology where appropriate
- Keep prompts concise but descriptive (2-4 sentences)
- Return ONLY the optimized prompt, no explanations

If the user has specific requests, incorporate them. Always return the complete optimized prompt.`;

export const SYSTEM_PROMPT_MAIN_PROMPT = `你是一位专业的视频创意策划师。用户会给你一段关于视频主题的描述，请帮助完善和优化。

要求：
- 让主题描述更具体、更有画面感
- 提供清晰的视频叙事方向
- 考虑节奏和情感曲线
- 直接返回优化后的描述，不要加解释

如果用户有特定想法，围绕它展开完善。`;

export const SYSTEM_PROMPT_MOTION_PROMPT = `You are an expert AI video prompt engineer. The user will give you a motion description intended for image-to-video generation. Help optimize it for better animation results.

Requirements:
- Always respond in English
- Focus ONLY on dynamic elements: subject actions, camera movement, environment changes
- Give only 1-2 core actions per response, don't overload
- Use professional camera language: slow dolly in, pan left, tilt up, tracking shot, etc.
- Don't repeat static elements (the image already anchors those)
- Include motion speed/direction when relevant
- Return ONLY the optimized motion prompt, no explanations

If the user has specific requests, incorporate them. Always return the complete optimized motion prompt.`;

export const SYSTEM_PROMPT_DESCRIPTION_ZH = `你是一位 AI 视觉创作的描述优化专家。用户会给你一段中文描述（场景 / 角色 / 产品等），请帮助润色。

要求：
- 保持原意，用更具体、更有画面感的表述
- 突出可用于图像生成的关键视觉特征（形态、材质、色彩、光线、氛围）
- 用中文，长度与原文相当，不要扩写成段落
- 直接返回润色后的描述，不要任何解释说明`;

export const SYSTEM_PROMPT_ASSET_EDIT_ZH = `你是一位视频资产设定设计师。用户会给你一个资产的完整设定和修改要求，请只返回修改后的完整 JSON，不要解释、不要 Markdown 代码块。
JSON 必须严格包含 name、description、details、prompt 四个字段。description 是一句话摘要，details 必须保留当前资产类型对应的全部字段并逐项填写，prompt 用英文且必须覆盖 details 中的可视化特征。
角色 details 固定包含 kind、species、role、age、personality、appearance、outfit、signature、background；场景 details 固定包含 kind、settingType、environment、time、weather、elements、spatialLayers、lighting、paletteMood、storyUse；产品 details 固定包含 kind、category、purpose、silhouette、dimensions、color、material、structure、surfaceDetails、branding、signature、usageState；道具 details 固定包含 kind、purpose、storyRole、objectType、shape、dimensions、material、color、structure、wear、signature、usage。
只修改用户明确要求的内容，其他信息保持不变；缺失细节要根据当前故事和视觉方向合理补全。不要把整个项目的视觉方向写进资产 prompt，资产 prompt 只描述这个资产本身。

`;

export const SYSTEM_PROMPT_VISUAL_DIRECTION_EDIT_ZH = `你是一位短视频项目的视觉指导。用户会给你一个项目级视觉方向和修改要求，请只返回修改后的完整 JSON，不要解释、不要 Markdown 代码块。
JSON 必须严格包含以下字段：name、description（一句话简介）、details（含 mediumMaterial、colorPalette、lightingMood、cameraTexture、composition、emotion 六个视觉维度）。
只修改用户明确要求的内容，其他字段保持原意；缺失细节要根据当前故事和视觉方向合理补全。六个维度只描述可复用的视觉语言，不得写具体人物、动物、角色、产品、道具或故事动作。

示例格式：
{"name":"温暖治愈 3D 动画风","description":"柔和 3D 动画风格的暖色治愈视觉","details":{"mediumMaterial":"柔和 3D 动画渲染","colorPalette":"金黄、暖橙、淡紫，低对比度","lightingMood":"柔和夕阳光，温暖、低对比度","cameraTexture":"轻电影感、浅景深、细腻柔和","composition":"平视与低机位，保留环境留白","emotion":"温暖、治愈、具有陪伴感"}}`;

export const SYSTEM_PROMPT_CHARACTER_DESCRIPTION_ZH = `你是一位 AI 角色设定专家，服务于短视频、短剧、长视频等各类视频创作。用户会给你一个角色名和现有描述（可能不完整），请输出这个角色的**完整角色描述**，作为该角色的唯一事实源（后续英文绘图提示词与分镜创作都将由它派生）。

完整角色描述的格式固定为 **1 行总述 + 8 行要素**，共 9 行：
第 1 行：一句话总述（不超过 30 字，概括这个角色是谁、在做什么，无前缀无冒号）
第 2-9 行：8 个要素，**每行一个**，行首为要素名 + 中文冒号，顺序固定：
物种：<物种或类型——防止绘制时主体漂移的第一锚点，如"兔""人类""机器人">
身份：<角色定位，如胎教短片主角、兔妈妈、咖啡店店员>
年龄：<年龄阶段，如幼年/少年/成年/老年——影响体型与神态>
性格：<性格气质，2-3 个词>
外貌：<体型、毛色或发色、五官等外貌特征>
服饰：<服装与配饰；原文没有则根据身份补一套贴合的>
记忆点：<1-2 个跨镜头识别特征——这是角色一致性的核心>
背景：<一句话来历，以及与其他角色的关系；确实没有可写"暂无">

硬性规则：
- 严格保持用户给出的物种/类型，禁止把非人类主体写成人类
- 只写静态设定，不要写动作/状态（如"正在睡觉"属于分镜层，不进角色描述）
- 9 行缺一不可，不要合并、不要加序号或 markdown 符号
- 要素内容保持通用，不要绑定单一时长、平台或内容形态
- 直接返回完整角色描述，不要任何解释说明
- 即使输出通道会压缩空白，也必须保留 9 行结构；每个要素前使用换行，禁止用句号或分号把 8 个要素连成一行`;

export const SYSTEM_PROMPT_NEGATIVE_PROMPT = `你是一位 AI 图像/视频生成的负向提示词专家。用户会给你一段负向提示词（描述画面中需要避免的瑕疵），请帮助优化。

要求：
- 只保留与画面质量、解剖结构、伪影、变形相关的通用负面项
- 用中文、逗号分隔的短语列表
- 表达简洁，合并重复项，避免互相冲突的条目
- 直接返回优化后的负向提示词，不要任何解释说明

如果用户有特定要求，按照要求调整。`;

export const SYSTEM_PROMPT_CHARACTER = `You are an expert at writing character appearance descriptions used as consistency anchors for AI image generation.

Core rule — never change the subject's identity:
- STRICTLY keep the species / type / subject given by the user. A rabbit stays a rabbit, a cat stays a cat, a robot stays a robot, a product stays that product.
- NEVER turn a non-human subject into a human, and never introduce humans that were not requested.
- Keep the subject's role and setting (e.g. a story protagonist) — you only describe how it LOOKS.

What to produce:
- Always respond in English (the description is sent directly to an image model)
- Combine BOTH the given name and the description: species/type, body shape and proportions, colors and materials, fur/hair, clothing or accessories, plus 1-2 distinguishing features
- Reflect the stated mood or state (e.g. sleeping, cheerful) through posture and expression — do not describe camera movement or actions
- Keep it 1-3 sentences, concise but specific enough to keep the character consistent across shots
- If a visual detail is missing, infer something that fits the SAME subject and style — never swap the subject

Hard constraints (MUST follow):
- Keep clothing descriptions modest and appropriate
- If the subject is human and young, prefer age-neutral wording such as "young man / young woman / teenager" over "boy / girl / child" (the image API may reject the latter)
- Avoid anything that could trigger content moderation filters

Style examples — note the subject type is always preserved:
- Name "小兔子", description "主角，可爱纯真，正在睡觉" → "A small fluffy white rabbit with long upright ears, pink inner ears, a tiny round nose and soft dark eyes, wearing a pale blue knitted scarf, curled up asleep with a calm and gentle expression"
- Name "小林", description "咖啡店店员，温柔" → "A young woman in her mid-20s with a soft round face, long straight black hair, slim build and fair skin, wearing a beige apron over a white shirt, calm and gentle expression"

Return ONLY the appearance description, with no explanations and no bullet points.`;

export const SYSTEM_PROMPT_DIALOGUE = `你是一位专业的短剧对白优化专家。用户会给你一段角色对话，请帮助优化和改进。

要求：
- 保持角色性格一致性
- 让对白更有戏剧张力和感染力
- 适合配合画面表演
- 简洁有力，每句不超过20字
- 直接返回优化后的对白，不要加任何解释说明

如果用户有特定的修改要求，按照要求调整。每次回复都返回完整的优化后对白。`;

/** 单语条目便捷构造（zh=en=原文） */
function monolingual(text: string): { zh: string; en: string } {
  return { zh: text, en: text };
}

/**
 * 内置规则条目。数组顺序 = 各 section 的渲染顺序（同 task 内）。
 * 规则文本来源：scriptService 原 buildPromptZh/En 与 buildExtractPromptZh/En 的规则段、
 * chatService 原 SYSTEM_PROMPT_* 常量，以及 T03 的风格派生指令。
 */
export const BUILTIN_RULES: PromptRule[] = [
  /* ── extractAssets（步骤 1 轻量资产提取） ── */
  {
    id: "extract.assets-animals",
    task: "extractAssets",
    section: "rules",
    content: {
      zh: "- characters：涵盖故事中的**一切角色主体**——人物、动物（如小兔子、小猫）、拟人化角色、机器人等，只要是故事的主角/配角就必须全部填入；仅纯风景内容才 []\n- 每个角色 description 必须严格保留 9 行：第 1 行一句话总述，后面按顺序逐行输出物种、身份、年龄、性格、外貌、服饰、记忆点、背景；禁止用句号/分号压成一行",
      en: "- characters: ONLY fill if content has characters, otherwise []\n- Each character description MUST preserve exactly 9 lines: one summary line followed by species, role, age, personality, looks, outfit, signature and background; never compress the elements into one sentence",
    },
    enabled: true,
    source: "builtin",
  },
  {
    id: "extract.assets-products",
    task: "extractAssets",
    section: "rules",
    content: {
      zh: "- products：仅当某个实物是内容的**核心展示主体**（如带货商品、产品广告的主角）时填写；角色手中/身边的普通道具（如小兔子抱着的胡萝卜）不要填入",
      en: "- products: ONLY fill if content has a product/goods subject, otherwise []",
    },
    enabled: true,
    source: "builtin",
  },
  {
    id: "extract.assets-props",
    task: "extractAssets",
    section: "rules",
    content: {
      zh: "- props：仅提取会在多个镜头中反复出现、且需要保持外观一致的关键物件（如钥匙、项链、武器、信件）；普通一次性背景物件不要填入",
      en: "- props: extract only recurring key objects that need visual consistency across shots (such as keys, necklaces, weapons or letters); do not extract incidental background objects",
    },
    enabled: true,
    source: "builtin",
  },
  {
    id: "extract.assets-scenes",
    task: "extractAssets",
    section: "rules",
    content: {
      zh: "- scenes：故事提到任何环境/地点（森林、城市、室内、梦境空间等）就必须至少提取一个场景；仅纯抽象内容才 []",
      en: "- scenes: ONLY fill if content involves concrete scenes, otherwise []",
    },
    enabled: true,
    source: "builtin",
  },
  {
    id: "extract.assets-styles",
    task: "extractAssets",
    section: "rules",
    content: {
      zh: "- styles：提取最贴合故事的整体视觉风格（画种、色调、光照氛围），最多 1 个；描述用中文",
      en: "- styles: extract the overall visual style that best fits the story, at most 1; description in Chinese",
    },
    enabled: true,
    source: "builtin",
  },

  /* ── storyboard（步骤 3 完整分镜生成；顺序 = 原「重要规则」段顺序） ── */
  {
    id: "storyboard.assets-animals",
    task: "extractAssets",
    section: "rules",
    content: {
      zh: "- characters 数组：涵盖故事中的**一切角色主体**——人物、动物（如小兔子、小猫）、拟人化角色、机器人等，只要是故事的主角/配角就必须填入；仅纯风景内容才返回空数组 []\n- 每个角色 description 必须严格保留 9 行：第 1 行一句话总述，后面按顺序逐行输出物种、身份、年龄、性格、外貌、服饰、记忆点、背景；禁止用句号/分号压成一行",
      en: "- characters array: include ANY story character/subject — humans, animals (e.g. a little rabbit), anthropomorphic or fantasy creatures, robots. Every protagonist/side character MUST be listed; only return [] for pure landscape content\n- Each character description MUST preserve exactly 9 lines: one summary line followed by species, role, age, personality, looks, outfit, signature and background; never compress the elements into one sentence",
    },
    enabled: true,
    source: "builtin",
  },
  {
    id: "storyboard.assets-products",
    task: "extractAssets",
    section: "rules",
    content: {
      zh: "- products 数组：仅当某个实物是内容的**核心展示主体**（如带货商品、产品广告的主角）时才填写；角色手中/身边的普通道具（如小兔子抱着的胡萝卜）不要填入",
      en: "- products array: ONLY fill when a physical item is the CORE subject being showcased (e.g. a product for an ad). Everyday props held by characters (e.g. a carrot a rabbit hugs) do NOT belong here",
    },
    enabled: true,
    source: "builtin",
  },
  {
    id: "storyboard.assets-props",
    task: "extractAssets",
    section: "rules",
    content: {
      zh: "- props 数组：仅提取会在多个镜头中反复出现、且需要保持外观一致的关键物件（如钥匙、项链、武器、信件）；普通一次性背景物件不要填入",
      en: "- props array: extract only recurring key objects that need visual consistency across shots (such as keys, necklaces, weapons or letters); do not extract incidental background objects",
    },
    enabled: true,
    source: "builtin",
  },
  {
    id: "storyboard.assets-scenes",
    task: "extractAssets",
    section: "rules",
    content: {
      zh: "- scenes 数组：故事提到任何环境/地点（森林、城市、室内、梦境空间等）就必须至少提取一个场景；仅纯抽象内容才返回空数组 []",
      en: "- scenes array: if the story mentions ANY environment/setting (forest, city, indoor, dream space, etc.), extract at least one scene; only return [] for purely abstract content",
    },
    enabled: true,
    source: "builtin",
  },
  {
    id: "storyboard.assets-styles",
    task: "extractAssets",
    section: "rules",
    content: {
      zh: "- styles 数组：提取最贴合故事的整体视觉风格（画种、色调、光照氛围），最多 1 个；描述用中文",
      en: "- styles array: extract the overall visual style that best fits the story (medium, color palette, lighting atmosphere), at most 1; description in Chinese",
    },
    enabled: true,
    source: "builtin",
  },
  {
    id: "storyboard.reuse-ids",
    task: "storyboardShot",
    section: "rules",
    content: {
      zh: "- 如有已有角色，复用其 ID（不要重复创建）；如是新角色，生成新的 ID",
      en: "- Reuse existing character IDs if applicable; generate new IDs for new characters",
    },
    enabled: true,
    source: "builtin",
  },
  {
    id: "storyboard.prompt-english",
    task: "storyboardShot",
    section: "rules",
    content: {
      zh: "- visualPrompt 和 motionPrompt 必须用英文（直接用于 AI API）",
      en: "- visualPrompt and motionPrompt MUST be in English (sent directly to AI APIs)",
    },
    enabled: true,
    source: "builtin",
  },
  {
    id: "storyboard.character-appearance",
    task: "storyboardShot",
    section: "rules",
    content: {
      zh: "- 如有角色出场，visualPrompt 必须包含角色完整外貌描述",
      en: "- If characters appear, visualPrompt MUST include their full appearance",
    },
    enabled: true,
    source: "builtin",
  },
  {
    id: "storyboard.product-appearance",
    task: "storyboardShot",
    section: "rules",
    content: {
      zh: "- 如有产品主体，visualPrompt 必须包含产品完整外观描述（款式、颜色、材质）",
      en: "- If a product subject appears, visualPrompt MUST include its full appearance (style, color, material)",
    },
    enabled: true,
    source: "builtin",
  },
  {
    id: "storyboard.subfields-language",
    task: "storyboardShot",
    section: "rules",
    content: {
      zh: "- 中文子字段给用户在界面上看，用中文填写",
      en: "- Sub-fields (subjectDesc etc.) are shown to users in their language",
    },
    enabled: true,
    source: "builtin",
  },
  {
    id: "storyboard.dialogues",
    task: "storyboardShot",
    section: "rules",
    content: {
      zh: "- dialogues：characterId 为 null 表示旁白",
      en: "- dialogues: characterId null = narrator",
    },
    enabled: true,
    source: "builtin",
  },
  {
    id: "storyboard.duration",
    task: "storyboardShot",
    section: "rules",
    content: {
      zh: "- 每镜头 duration 为 4、5 或 8 秒（视频模型支持 4-12 秒）",
      en: "- Each shot duration: 4, 5, or 8 seconds (the video model supports 4-12s)",
    },
    enabled: true,
    source: "builtin",
  },
  {
    id: "storyboard.shot-count",
    task: "storyboardOutline",
    section: "rules",
    content: {
      zh: "- 总镜头数 4-8 个，节奏有起承转合",
      en: "- 4-8 shots total, with narrative pacing",
    },
    enabled: true,
    source: "builtin",
  },

  /* ── storyboard 安全条目（原「⚠️ 内容安全要求」段） ── */
  {
    id: "safety.age-wording",
    task: "storyboardShot",
    section: "safety",
    content: {
      zh: "- 用 \"young man/young woman/teenager\" 代替 \"boy/girl/child\"",
      en: "- Use \"young man/young woman/teenager\" instead of \"boy/girl/child\"",
    },
    enabled: true,
    source: "builtin",
  },
  {
    id: "safety.content",
    task: "storyboardShot",
    section: "safety",
    content: {
      zh: "- 不要暴力、血腥、裸露等敏感内容\n- 不要真人政治人物、名人肖像",
      en: "- No violence, gore, nudity, or sensitive content\n- No real political figures or celebrity likenesses",
    },
    enabled: true,
    source: "builtin",
  },
  {
    id: "safety.clothing",
    task: "storyboardShot",
    section: "safety",
    content: {
      zh: "- 服饰描述得体，适合全年龄段",
      en: "- Keep clothing descriptions modest and appropriate",
    },
    enabled: true,
    source: "builtin",
  },

  /* ── characterAppearance（原 SYSTEM_PROMPT_CHARACTER 拆条目） ── */
  {
    id: "character.species-lock",
    task: "characterAppearance",
    section: "rules",
    content: {
      zh: "- 严格保留用户给定的物种 / 类型 / 主体。兔子就是兔子，猫就是猫，机器人就是机器人，产品就是该产品。\n- 绝不把非人类主体变成人类，也绝不擅自加入未被要求的人类。\n- 除非描述明确要求虚构例外，否则保持主体的正常解剖结构：一个头、一个身体、符合物种的肢体数量与位置；绝不凭空增加头、肢体、尾巴，也不生成重复或融合的身体部位。\n- 保留主体的角色与场景设定（如故事主角）——你只描述它的外观。",
      en: "- STRICTLY keep the species / type / subject given by the user. A rabbit stays a rabbit, a cat stays a cat, a robot stays a robot, a product stays that product.\n- NEVER turn a non-human subject into a human, and never introduce humans that were not requested.\n- Unless the description explicitly requests a fictional exception, preserve normal anatomy: one head, one body, and the correct number and placement of limbs for the species; never invent extra heads, limbs or tails, or duplicated/fused body parts.\n- Keep the subject's role and setting (e.g. a story protagonist) — you only describe how it LOOKS.",
    },
    enabled: true,
    source: "builtin",
  },
  {
    id: "character.infer-missing",
    task: "characterAppearance",
    section: "rules",
    content: {
      zh: "- 若缺少视觉细节，可补全符合同一主体与风格的细节——绝不更换主体",
      en: "- If a visual detail is missing, infer something that fits the SAME subject and style — never swap the subject",
    },
    enabled: true,
    source: "builtin",
  },

  /* ── styleRef（风格提示词派生硬约束，与 T03 派生指令对齐） ── */
  {
    id: "styleref.no-characters",
    task: "styleRef",
    section: "rules",
    content: {
      zh: "- 只使用纯视觉语言：媒介、色彩、光影、材质、镜头质感、构图规律与氛围\n- stylePrompt 会被拼进项目里每一张图：必须是**不含画面构图词**的纯视觉语言，禁止出现样张板/色卡/拼贴/载体/对称排布等词（那属于风格母版拼装层，写了会让所有资产图画出方块）\n- 不出现核心主体、不暗示任何可识别实体、不叙述故事或借用故事主体/场景/构图\n- 主体绑定材质词（毛发、皮肤、羽毛、绒毛、鳞片）只能写成抽象材质描述（如 \"fur-like fibre texture\"），不得裸写为整体画风，否则会被图像模型理解成一只动物\n- 画面中不要出现文字与水印",
      en: "- Use only pure visual language: medium, color, lighting, material, camera texture, composition patterns and atmosphere\n- The stylePrompt is appended to EVERY image call in the project: it must be pure visual language with NO sheet/board composition wording (sample sheet, swatches, colour chips, grid, carrier, layout) — that belongs only to the style-master assembly layer, otherwise every asset image renders swatch-board squares\n- No core subject, no recognizable entity, no story or borrowed subjects/setting/composition\n- Subject-bound material words (fur, hair, feather, plush, skin, scale) may only be worded as abstract material handling (e.g. \"fur-like fibre texture\"); never leave them bare as overall style language, or the image model reads them as an animal\n- No text or watermark in the image",
    },
    enabled: true,
    source: "builtin",
  },

  /* ── composeShot（分镜画面提示词拼装规范） ── */
  {
    id: "compose.multi-reference",
    task: "composeShot",
    section: "rules",
    content: {
      zh: "- 多图合成时逐张声明参考图用途（场景/角色/产品/风格），并固定声明「参考图只作画风、色调与角色形象锚点，勿复制其内容与构图」",
      en: "- In multi-reference composition, declare each reference image's role (scene/character/product/style) and always state that the references only anchor art style, palette and character identity — never copy their content or composition",
    },
    enabled: true,
    source: "builtin",
  },

  /* ── negativeStrategy（负向提示词策略） ── */
  {
    id: "negative.strategy",
    task: "negativeStrategy",
    section: "rules",
    content: {
      zh: "- 负向提示词只保留通用画质瑕疵项（解剖结构、伪影、变形等）；拼装提示词时将避免项改写为正向表述并入提示词，负向列表仅作辅助",
      en: "- Keep negative prompts to generic quality defects (anatomy, artifacts, deformation); when composing, phrase avoid-items as positive statements merged into the prompt — the negative list is auxiliary only",
    },
    enabled: true,
    source: "builtin",
  },

  /* ── polish（chatService 8 个专家角色，单语原文整体作为单条目） ── */
  {
    id: "polish.script-text",
    task: "polish",
    section: "rules",
    content: monolingual(SYSTEM_PROMPT_SCRIPT_TEXT),
    enabled: true,
    source: "builtin",
  },
  {
    id: "polish.visual-prompt",
    task: "polish",
    section: "rules",
    content: monolingual(SYSTEM_PROMPT_VISUAL_PROMPT),
    enabled: true,
    source: "builtin",
  },
  {
    id: "polish.main-prompt",
    task: "polish",
    section: "rules",
    content: monolingual(SYSTEM_PROMPT_MAIN_PROMPT),
    enabled: true,
    source: "builtin",
  },
  {
    id: "polish.motion-prompt",
    task: "polish",
    section: "rules",
    content: monolingual(SYSTEM_PROMPT_MOTION_PROMPT),
    enabled: true,
    source: "builtin",
  },
  {
    id: "polish.description-zh",
    task: "polish",
    section: "rules",
    content: monolingual(SYSTEM_PROMPT_DESCRIPTION_ZH),
    enabled: true,
    source: "builtin",
  },
  {
    id: "polish.character-description",
    task: "polish",
    section: "rules",
    content: monolingual(SYSTEM_PROMPT_CHARACTER_DESCRIPTION_ZH),
    enabled: true,
    source: "builtin",
  },
  {
    id: "polish.negative-prompt",
    task: "polish",
    section: "rules",
    content: monolingual(SYSTEM_PROMPT_NEGATIVE_PROMPT),
    enabled: true,
    source: "builtin",
  },
  {
    id: "polish.character",
    task: "polish",
    section: "rules",
    content: monolingual(SYSTEM_PROMPT_CHARACTER),
    enabled: true,
    source: "builtin",
  },
  {
    id: "polish.dialogue",
    task: "polish",
    section: "rules",
    content: monolingual(SYSTEM_PROMPT_DIALOGUE),
    enabled: true,
    source: "builtin",
  },
];

/* ── 渲染与合并 ──────────────────────────────────────────────────────────── */

/** 渲染单个 section：有内容注入块内，空内容整块移除；裸占位符直接替换 */
function renderSectionBlock(
  skeleton: string,
  section: RuleSection,
  body: string,
): string {
  const open = `{{#${section}}}`;
  const close = `{{/${section}}}`;
  const start = skeleton.indexOf(open);
  const end = skeleton.indexOf(close);
  if (start === -1 || end === -1) {
    // 等价机制：裸占位符（无块包裹）直接替换
    return skeleton.replace(`{{${section}}}`, () => body);
  }
  const inner = skeleton.slice(start + open.length, end);
  if (!body.trim()) {
    // 空 section：整块移除（含 "重要规则：" 等 header 行）
    return skeleton.slice(0, start) + skeleton.slice(end + close.length);
  }
  // 用函数形式替换，避免 body 中 "$&" 等被当作替换模式
  return (
    skeleton.slice(0, start) +
    inner.replace(`{{${section}}}`, () => body) +
    skeleton.slice(end + close.length)
  );
}

/**
 * 渲染某任务的 system prompt：骨架 + 生效条目。
 * 顺序：rules → examples → safety；同 section 内按传入 rules 的顺序
 * （BUILTIN_RULES 定义顺序，custom 追加其后）；enabled=false 剔除。
 * 纯函数：rules 由调用方传入（一般为 getActiveRules() 的结果）。
 */
export function buildSystemPrompt(
  task: PromptTask,
  language: "zh" | "en",
  rules: PromptRule[],
): string {
  let out = SKELETONS[task][language];
  for (const section of ["rules", "examples", "safety"] as const) {
    const picked = rules
      .filter((r) => r.task === task && r.section === section && r.enabled)
      // 防御：settingsStore 只做数组级校验，坏条目（content / content[language]
      // 缺失）可能经 getActiveRules() 直达此处。缺语言内容时剔除该条目
      // （不做跨语言回退，避免 zh 内容泄漏进 en 输出），filter(Boolean) 兜底。
      .map((r) => r.content?.[language]?.trim() ?? "")
      .filter(Boolean);
    out = renderSectionBlock(out, section, picked.join("\n"));
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * 合并用户存储条目与内置条目：
 * - 同 id：custom 存储版整体覆盖 builtin（content/enabled 均以存储版为准）；
 * - 仅存在于 stored 的条目（自定义）：追加到对应位置之后（保持 builtin 顺序在前）。
 * 纯函数，单独导出供测试与 UI 使用。
 */
export function mergeRules(builtin: PromptRule[], stored: PromptRule[]): PromptRule[] {
  const byId = new Map<string, PromptRule>(builtin.map((r) => [r.id, r]));
  for (const s of stored) {
    const base = byId.get(s.id);
    byId.set(
      s.id,
      base
        ? { ...base, content: s.content, enabled: s.enabled, source: s.source ?? base.source }
        : { ...s },
    );
  }
  return [...byId.values()];
}

/** 当前生效条目 = 内置 + settingsStore 中用户存储的差异（服务层便捷入口） */
export function getActiveRules(): PromptRule[] {
  return mergeRules(BUILTIN_RULES, useSettingsStore.getState().promptRules ?? []);
}

/**
 * 解析润色专家提示词：传入文本与某内置 polish 条目一致时，返回合并后的
 * 生效版本（用户覆盖过的 content）；否则原样返回（自定义提示词直通）。
 * 供 AiPolishField 在调用 polishText 前统一走注册表解析。
 */
export function resolvePolishSystemPrompt(systemPrompt: string): string {
  const builtin = BUILTIN_RULES.find(
    (r) => r.task === "polish" && r.content.zh === systemPrompt,
  );
  if (!builtin) return systemPrompt;
  const stored = useSettingsStore.getState().promptRules ?? [];
  const override = stored.find((r) => r.id === builtin.id);
  // 防御：覆盖版 content 可能是坏结构（zh 缺失/非字符串），此时回退内置原文
  const zh = override && override.enabled ? override.content?.zh : undefined;
  if (typeof zh === "string" && zh.length > 0) return zh;
  return systemPrompt;
}

/** 角色外貌生成 system prompt（CharacterEditor 使用，恒英文输出） */
export function buildCharacterAppearancePrompt(): string {
  return buildSystemPrompt("characterAppearance", "en", getActiveRules());
}
