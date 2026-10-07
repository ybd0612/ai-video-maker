# 一个想法进来，会被拆成什么（想法拆解视图）

配套：`docs/execution-flow.md`（文字版流程）、`docs/execution-flow-diagrams.md`（执行时序图集）、`docs/flow-map.html`（**交互式引用图**：本文图 4 的可点版本，把每一次调用与拼装都画成独立「动作」节点，因此点「想法原文」就能直接看到它喂给了哪 6 个动作）。
本文只回答三件事：**拆成哪些东西 → 每样东西有哪些参数、提示词长什么样 → 之后在哪里被引用**。
所有提示词均为 `src/lib/promptRules.ts` / `src/services/scriptService.ts` 的现行原文（标注行号），示例值是为讲解虚构的，不代表真实模型输出。

⚠️ 读提示词原文前先看这条前提：文中引的是**代码内置默认版**。实际发出去的提示词 = 骨架 + 所有已启用的规则条目按 `rules → examples → safety` 三段注入；条目可以在设置对话框「提示词规则」里编辑/关闭/新增，**同 id 的用户条目会整体覆盖内置条目**，用户新增的条目追加在末尾。骨架本身（JSON 结构与那几句硬约束）不能在界面改。所以如果你改过规则，真实请求会比本文更长，请用设置里的「导出」拿生效版对照。

---

## 一句话结论

```
一句想法  ──拆成──>  1 个故事骨架  +  1 个视觉方向  +  4 类资产（角色/场景/主体/道具）  +  N 个镜头
                         │                    │                    │
                     管"讲什么"          只管"画风"           只管"长什么样"
                     主题/节奏/一致性      不含任何主体        不含动作与剧情
                         └────────────────────┴────────────────────┘
                              ↓ 复用外观 ID 与英文外观描述
                            N 个镜头（故事层 = 排镜的唯一口径）
```

三条硬规矩（都由提示词显式约束，不是代码校验）：

1. 视觉方向**只准写视觉语言**，不准写人物/动物/产品/道具/剧情。
2. 每类资产的英文外观描述**只准写自己本体**，不准写动作和别的资产。
3. 镜头里的主体外观**必须原样复用**资产的英文描述，不许另编一套。

---

## 图 1　拆解树（缩进 = 从属，行末 = 代码里的真实字段名）

```
用户想法 ideaPrompt
│
├─[C] 故事骨架 storyBrief             （1 份，项目级，2026-10-07 新增）
│   ├─ 一句话梗概        logline
│   ├─ 核心主题          theme
│   ├─ 情绪曲线          emotionArc
│   ├─ 目标受众          audience
│   ├─ 时长规划          durationPlan
│   ├─ 关键节拍          beats
│   └─ 一致性约束        consistencyNotes  ← 全片不变量
│
├─[A] 视觉方向 visualDirection            （1 份，项目级）
│   ├─ 名称                name
│   ├─ 一句话简介          description
│   └─ 六维设定            details
│       ├─ 媒介与材质      mediumMaterial    例："2D 手绘水彩，纸纹可见"
│       ├─ 主色调与明暗    colorPalette      例："暖橘 + 墨蓝，中高对比"
│       ├─ 光影氛围        lightingMood      例："黄昏逆光，柔和高光"
│       ├─ 镜头质感        cameraTexture     例："浅景深，轻微胶片颗粒"
│       ├─ 构图规律留白    composition       例："主体偏右下，上方大留白"
│       └─ 整体情绪        emotion           例："安静、治愈"
│
└─[B] 资产 assets                          （N 份，四类各一次请求）
    │
    ├─ 角色 character ──┬─ 名称 name
    │                   ├─ 一句话总述 description
    │                   ├─ 八项设定 details
    │                   │   ├─ 物种 species          例："垂耳兔"
    │                   │   ├─ 身份 role             例："主角"
    │                   │   ├─ 年龄阶段 age          例："幼年"
    │                   │   ├─ 性格与行为倾向 personality
    │                   │   ├─ 体型/五官/颜色/材质 appearance
    │                   │   ├─ 服饰与配饰 outfit
    │                   │   ├─ 跨镜头识别特征 signature   ← 一致性关键
    │                   │   └─ 来历与角色关系 background
    │                   └─ 英文外观提示词 appearancePrompt   ← 全项目最关键的字段
    │
    ├─ 场景 scene ──────┬─ 名称 / 一句话定位 / 英文外观提示词
    │                   └─ 九项设定 details：空间类型 settingType、地理环境 environment、
    │                       时间 time、天气 weather、主要元素 elements、
    │                       空间层次 spatialLayers、光线 lighting、
    │                       色彩氛围 paletteMood、可用于哪些剧情 storyUse
    │
    ├─ 核心主体 product ┬─ 名称 / 一句话定位 / 英文外观提示词
    │                   └─ 十一项设定 details：产品类型 category、核心用途 purpose、
    │                       轮廓比例 silhouette、尺寸 dimensions、颜色 color、材质 material、
    │                       结构 structure、表面细节 surfaceDetails、品牌 Logo branding、
    │                       不可变识别特征 signature、使用状态 usageState
    │
    └─ 关键道具 prop ───┬─ 名称 / 一句话定位 / 英文外观提示词
                        └─ 十一项设定 details：道具用途 purpose、故事作用 storyRole、
                            物件类型 objectType、形状 shape、尺寸 dimensions、材质 material、
                            颜色 color、结构 structure、磨损 wear、
                            识别特征 signature、镜头中用法 usage
```

落库时每条资产还会被代码补上：`source`(来源=AI 提取)、`prompt`(=上面那份英文外观提示词的副本)、角色额外的 `assetNamespace`(命名空间标记) 与 `fullPrompt`(名称+外观拼好的完整提示词)。见 `src/lib/extractAssets.ts`。

---

## 图 2　[ A ] 视觉方向：提示词原文

`promptRules.ts:60-89`（任务名 `visualDirection`，中文界面用 zh 版）

```
你是一位视觉指导。请从用户的视频想法中提炼项目级视觉方向，只返回 JSON：
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
只提取可复用的视觉语言：媒介、材质、色彩、光影、镜头质感、构图规律与氛围。
不要写具体人物、动物、角色、产品、道具、故事动作或角色关系。
details 各字段都只描述视觉语言本身，不承载故事主体。
```

紧接着还有一道**自检**（不重写就不放行，最多 1 轮，`promptRules.ts:134` 的 `visualDirectionAudit`）：把上面这份 JSON 和「本项目资产名清单」一起交给模型，问它有没有越界写了故事主体；越界则由它自己重写。

---

## 图 3　[ B ] 四类资产：提示词原文与出参

系统提示词 = `promptRules.ts:200-275`（任务名 `extractAssets`，四类**共用同一份**），要求严格返回：

```
{
  "characters": [ { "name", "description",
      "details": { species, role, age, personality, appearance, outfit, signature, background },
      "appearancePrompt": "完整英文外观提示词" } ],
  "products":   [ { ..., details 11 项, "appearancePrompt" } ],
  "props":      [ { ..., details 11 项, "appearancePrompt" } ],
  "scenes":     [ { ..., details 9  项, "appearancePrompt" } ],
  "styles":     [ { name, description, details 6 项 } ]
}
```

骨架末尾固定三句硬约束（`promptRules.ts:235-237`）：

```
- appearancePrompt 必须只描述对应资产本身的可视化外观，不写故事动作、角色关系或其他资产；
  视觉方向只提供画风参考，不把故事主体写入视觉方向描述
- 场景 appearancePrompt 只描述环境、空间、时间、天气、光线、材质与氛围；
  产品和道具 appearancePrompt 只描述物件本体
- 不要生成分镜，只返回上述 JSON
```

用户消息实际长这样（`scriptService.ts` 的 `extractAssetsByType`）：

```
<用户的想法原文>

THIS CALL EXTRACTS ONLY "character": the "characters" array carries the assets for
this call, and every other array MUST be an empty array.
```

四类各发一次请求、并行跑，靠最后这句「只提取 X 类」区分；代码还会做兜底过滤——**即使模型越界输出了别的类数组，也只保留本次目标类**，其余置空。

> **2026-10-07 修正**：原文此前还有一句 `Design assets according to the confirmed visual direction.`，而 `extractAssetsByType` 的第 3 参 `visualDirection` 从未被调用方传入（链 A 与链 B 并行发出，资产提取时视觉方向还没产出）。模型被告知了一个它拿不到的上下文。**该句已删除**，`visualDirection` 形参一并移除。**结论：资产提取阶段看不到画风，画风是在后面生图时才注入的**（风格全由 `stylePrompt` 文本承载）。

另外还有 4 条按类追加的内置规则条目（可在设置里改）：`extract.assets-animals` 角色/动物类、`extract.assets-scenes` 场景类、`extract.assets-products` 产品类、`extract.assets-props` 道具类，外加 `safety.extract-scope` 内容安全边界。

---

## 图 3·5　[C] 故事骨架 StoryBrief（2026-10-07 新增）

**它补的是什么缺口**：此前第一步的产出只有「画风」与「长什么样」两类，用户想法里的**主题、情绪曲线、时长与节奏规划、跨镜头一致性要求没有任何容器承载** —— 下游分镜只能拿着资产清单 + 原始散文重新猜一遍剧情。StoryBrief 是故事层的 SSOT。

骨架 `promptRules.ts` 任务名 `storyBrief`，出参七字段：

```json
{
  "logline": "一句话梗概：主角是谁、想做什么、遇到什么阻力、最后如何收束",
  "theme": "核心主题与情绪基调",
  "emotionArc": "情绪曲线（孤寂→紧张→释然）",
  "audience": "目标受众与投放场景认知",
  "durationPlan": "目标时长与节奏规划",
  "beats": "关键节拍骨架（起承转合）",
  "consistencyNotes": "全片一致性硬约束（同一张脸 / 同一套服装 / 同一物件的颜色形状）"
}
```

内置条目：`storyBrief.no-style-leak`（只规划故事不碰画面，画风归视觉方向）、`storyBrief.fidelity`（原文写明的情节必须照抄）、`safety.storyBrief-scope`。

**编排位置**：与链 A（视觉方向）、链 C（四类资产）**三条并行**发出，完成即写回 store，**失败只记警告不拖垮整体**（缺省时下游按「未设定」降级为直接从想法原文规划，行为与改造前一致）。

**消费点**：注入 `generateStoryboardOutline` 与 `generateStoryboardShot` 的 user 消息（`buildStoryBriefContext`），两个环节都以它为剧情与节奏的唯一口径。

**界面**：步骤 2 顶部「故事骨架」卡片（视觉方向卡片之上，因它更上游）→ 点开为 `StoryBriefEditor.tsx`，复用 `AssetDetailShell` 详情外壳；字段可改，改后 `updateStoryBrief` 重置 `storyboardReviewed`（对齐 `updateVisualDirection` 的级联口径：不删已有镜头）。

**持久化**：`Project.storyBrief`，v19 → v20。刻意不补默认值 —— 故事层只能由模型产出，代码凭空造等于把创作决策塞进下游；旧项目保持 `undefined`。

---

## 图 4　拆完之后，这些东西去哪里被引用（重点看这张）

```
产物                        被谁读                             以什么形式进入下一步
=====================================================================================
故事骨架 7 字段              步骤3 大纲 + 逐镜头                  buildStoryBriefContext
  storyBrief.{7}                                            拼进 user 消息顶部
                                                              「已确认的故事骨架…」
                                                              （缺省则不注入，
                                                                行为与改造前一致）

视觉方向 6 维                风格提示词派生 deriveStylePrompt   作为输入文本（不含故事主体）
  details.{6}                                                     ↓
                                                            英文风格提示词 stylePrompt
                                                              （存到 style 资产的 prompt 上）
                                                                ↓ 被读三处：
                                                                ① 资产图：拼进生图 prompt
                                                                ② 分镜图：拼进生图 prompt
                                                                ③ 风格母版图：整段喂给生图
                                                                ⚠ 三处都只是"文字"，
                                                                   风格母版图本身不再当参考图

角色.英文外观 appearancePrompt  步骤3 资产清单注入              "- 小兔子 (ID: asset_x): <完整设定>
主体.英文外观  (scene/product/     {{assets}} 占位                appearancePrompt: <英文外观>"
道具.英文外观                   (scriptService.ts:126-258)       → 模型被要求原样抄进 visualPrompt

资产 ID asset_*                步骤3 大纲与单镜头              镜头的 activeCharacterIds /
                                  骨架要求"用已有资产的 ID"        activeSceneId /
                                                                  activeProductIds /
                                                                  activePropIds

资产 参考图 imageUrl           步骤4 选参考图                  请求体 extra_body.image 数组
                              pickShotReferences               （只取 角色→主体→道具 三类，
                                                                  场景图与风格母版不进）

镜头 visualPrompt 画面提示词    步骤4 生图                       生图 prompt 的主体段
镜头 motionPrompt 动态提示词    步骤5 生视频                     视频 prompt 全文
镜头 imageUrl                  步骤5 生视频                     请求体 first_frame
镜头 对白/引用/子字段           只用于界面审核与再改写            不进任何 API 请求
=====================================================================================
一句话记忆：**英文外观 → 文字注入，参考图 → 图像注入，ID → 引用绑定**。
```

---

## 图 5　步骤 3 再往下拆：镜头是怎么从想法+资产长出来的

两级拆解，不是一步到位（`promptRules.ts:278` 与 `:336`）。

**第一级：大纲**（一次请求，出 N 条镜头计划；下列 1-5 条为 `promptRules.ts:280-284` 原文，"出参"一行是本文件的中文注释）

```
1. 由你根据想法的叙事复杂度与节奏自行判断需要多少个镜头（宁可少而精，不做无意义切分）；每个镜头时长只能从 4 秒、5 秒、8 秒中选择，保持叙事连贯、有情绪节奏
2. 每个镜头给出一句话内容概括（发生了什么、关键画面、情绪节拍）
3. 指出该镜头涉及的角色名与场景名（必须使用"已有资产清单"中的原名；涉及才列，不涉及为空）
4. 仅当想法明确需要清单中没有的新角色/新场景时，在 newCharacters/newScenes 中给出完整资产
   （结构同资产提取），否则给空数组
5. 已列资产一律复用"已有资产清单"中的原名/ID，不得新建或改写资产名称；
   newCharacters/newScenes 只在确有清单外的主体时才填写
出参：{ shots: [ { title 小标题, summary 一句话概括,
                  characterNames[出场角色名], sceneName 场景名 } ],
        newCharacters: [], newScenes: [] }
```

**第二级：逐镜头细化**（每镜头一次请求，3 个并发；原文 + 中文括注）

```
1. scriptText      该镜头的叙事脚本（含动作与情绪，语言随用户输入）
2. visualPrompt    完整英文画面提示词 —— 主体外观（直接沿用所给资产的英文外观描述）、
                   动作、环境、构图与镜头；只描述该镜头
3. motionPrompt    完整英文运动提示词 —— 主体动作、镜头运动、环境变化
4. 其余描述字段（sceneDesc/detailDesc/lightingDesc/styleDesc/actionDesc/cameraDesc/
   envChangeDesc/motionSpeedDesc）逐项填写；主体信息只写入 visualPrompt，
   不再单独生成 subjectDesc
5. dialogues 按需给对白（characterId 用角色名）；activeCharacterIds/activeSceneId/
   activeProductIds/activePropIds 用已有资产的 ID；visualPrompt 或 scriptText 中出现的
   可识别道具/产品必须同步写入对应 active ID；duration 从 4/5/8 中选

只输出这一个镜头的 JSON 对象（不是数组），不要包含任何其他文字。
所有返回字段都必须非空。
```

镜头数口径（2026-09-21 已裁定）：**不写固定区间，数量交给模型判断**（骨架 `:280`、`:307` 与条目 `storyboard.shot-count` 均按此改写，用户可在设置「提示词规则」覆盖）。此前 README/AGENTS 的「4-6」与提示词的「4-8」属真实冲突，结案方式不是挑一个数字，而是取消硬编码。镜头**时长**仍受结构约束：`scriptService.ts:369` 只接受 4 / 5 / 8 秒。

---

## 关于展示形式的建议

不建议用思维导图（放射状）。理由：这里要审的是**字段级的形态 + 引用方向**，放射图放不下一份 JSON 的十余个字段，也只能用箭头表示单对单关系，而实际是「一份视觉方向被三处消费」「四类资产各自被两条链路消费」这种多对多。

本文改用三种形式组合，各有分工：

- **缩进树（图 1）**：看"拆成了什么、每层有什么字段" —— 替代思维导图。
- **提示词原文引用块（图 2/3/5）**：看"怎么拆的" —— 直接给现行文本，不转述。
- **引用去向表（图 4）**：看"后面哪里有引用" —— 一行一个产物，右列写清它以什么形式进入哪个请求字段。

图 4 已有可点版本：`docs/flow-map.html`（交互式引用图，把每次调用与拼装都画成动作节点，点任一产物即按跳数高亮其全部下游）。
