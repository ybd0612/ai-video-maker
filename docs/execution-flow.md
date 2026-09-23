# 执行流程全拆解（源码快照 2026-09-21；§1/§2/§3/§5/§9.3/§12 于 2026-09-22 随步骤 1 提取修复重排行号并更新口径）

> 用途：供主理人核对「程序实际怎么跑」是否与预期一致。
> 全部结论来自当前源码，关键处标 `文件:行`。与 AGENTS.md/README 不一致的地方集中在第 11 节，代码可疑点在第 12 节。
> 本文不描述界面外观，只描述：谁触发 → 调什么 → 发什么请求 → 写回什么 → 门禁如何放行。
> 配套的 ASCII 数据流图集（每一步吃什么参数、吐什么参数）：`docs/execution-flow-diagrams.md`。
> 文中英文字段名的中文含义统一查该图集开头的「图 A 术语对照总表」。
> 交互式引用图：`docs/flow-map.html`（双击浏览器打开，无需启动服务）。56 个节点含 20 个「动作」节点，点任一方块按跳数分层高亮、与它相连的线上直接写出用途；支持聚光灯、只看失效级联、按引用类型筛选与中英搜索。

---

## 1. 全局骨架

三层，单向依赖，UI 不直连 API：

- 步骤组件 `src/features/wizard/Step*.tsx` — 只负责交互、自动触发 effect、门禁展示
- 编排层 `src/features/wizard/use{Script,Asset,Image,Video}Actions.ts` — 捕获 `targetProjectId`、幂等守卫、批量并发、状态写回
- 服务层 `src/services/*` — 构造请求、解析响应、限流、重试。运行期依赖 store 的只有 `services/rateLimit.ts:16`（自己读 plan），其余服务只 import 类型
- `src/lib/*` 大部分是无副作用纯函数（提示词拼装、引用解析、参数决策），**例外**：`lib/logger.ts:23`、`lib/devDump.ts:14-15` 运行期读 store，`lib/logStorage.ts` 读写 localStorage

配置来源唯一：`useSettingsStore.getState().providerConfig`（apiKey / baseUrl / plan），由编排层在每次动作开始时读出后**显式传参**给服务层；服务层内部不读 apiKey/baseUrl，也不读当前活动项目。

步骤容器：`CreationWizard.tsx:21` 固定 6 步；`:89-94` 按 `project.wizardStep` 路由组件；`:44-59` 是「下一步」的唯一门禁表；`:31-42` 挂载时一次性复位残留的 `scripting`（注册表已随页面销毁清空）。

三种推进动力，必须分清：

1. 用户点底部「下一步」→ 受 `canAdvance` 门禁表约束（`CreationWizard.tsx:44-59`）；步骤 1 额外要求 `status !== "scripting"`，想法提取全程不放行
2. 步骤内专用按钮（如「提取并继续」「确认这批资产」「审核通过」）→ 直接 `setWizardStep`，绕过底部门禁
3. `automationMode === "auto"` → 各步骤挂载的条件 effect 自动推进（半自动模式下这些 effect 全部不触发）

状态枚举（`stores/projectTypes.ts`）：

- `ProjectStatus` = `idle | scripting | imaging | videoing | rendering | done | failed`（:9-16）
- `ShotStatus` = `idle | scripting | scripted | imaging | imaged | videoing | videoed | failed`（:18-26）
- `AssetType` = `character | scene | product | prop | style`（:59）
- `asset.source` = `extracted | manual`，缺省按 extracted 处理（:159）
- `WizardStep` = 1..6，`AspectRatio` 只有 `9:16 | 16:9 | 1:1`（:28-30）

---

## 2. 步骤 0：前置配置（不进步骤条，但缺它整条链第一步就抛错）

`settingsStore`（persist key `wxhb-settings`，**version 4**，`settingsStore.ts:142-143`）默认值：`baseUrl = https://api.agnes-ai.cn/v1`、`plan = default`、`language = zh`、`theme = light`、`apiKey = ""`、`autoRegeneratePortrait = true`、`autoRegenerateAssetImages = true`、`videoConsistency = "chain"`（2026-09-21 新增，靠 persist 浅合并回退默认，未升版本、无迁移）、`promptRules = []`（只存用户差异条目）。

缺 Key 时的行为分两类，不一致：

- 静默 return：`generateStyleReference` / `generateAssetImages` / 图片视频批量（`useAssetActions.ts:174`、`useImageActions.ts:199`、`useVideoActions.ts:192`）——按钮像没反应
- 抛错上屏：步骤 1 的 `extractCharactersFromIdea`（`useScriptActions.ts:143-145`）与 `generateStoryboard`（`useScriptActions.ts:316-318`）都抛 `API key is not configured.`

---

## 3. 步骤 1：想法 → 提取

入口 `StepIdea.tsx:87-118`。

1. 输入框内容 500ms 防抖写回 `project.ideaPrompt`（`StepIdea.tsx:71-78`），画幅按钮立即写 `aspectRatio`（:173-176）
2. 点「提取角色与资产并继续」/ Enter → 无项目则 `createProject(title=前 30 字)` 并补写 ideaPrompt + 画幅（:95-103）
3. `await extractCharactersFromIdea(prompt)`，返回 `false` = 用户在确认弹窗取消，**留在步骤 1 不推进**（:105-106）
   - 注意：切页**不**由 `onGenerated` 负责——`CreationWizard.tsx:89` 渲染的是无 props 的 `<StepIdea />`，该回调恒为空操作；实际切页在 `extractCharactersFromIdea` 内部写回 `wizardStep: 2`（见下）
4. 错误与 loading 态都带 `activeProjectId === targetId` 守卫，防止旧项目的失败污染切换后的新项目（:109-117）
5. 「提取中」判定 = `本地 isGenerating || project.status === "scripting"`（`:45`），输入框禁用 / 遮罩 / 按钮禁用 / Enter 全部吃这个合并态（:122、:149、:154、:192）。**只看本地态不够**：组件随切页卸载，返回步骤 1 时按钮又可点

`extractCharactersFromIdea` 内部（`useScriptActions.ts:142-305`）：

1. 已有 auto 资产 → `confirmDialog` 列出将被替换的名字（角色附带现有物种/品种，让"主体会被重新判断"在确认前就可见），取消返回 false（:159-171）
2. 幂等守卫：`activeIdeaTasks` 命中该项目 → 直接 `return true`（在飞那轮稍后会写回；`false` 专指用户取消），紧接同步登记，**守卫与登记之间不得有 await**（:170-173）
3. 发起即清空：只保留 `source === "manual"` 资产，清 `styleReferenceUrl` / `styleReferenceError`，`assetsReviewed = false`，`status = "scripting"`（:175-185）
4. **两条链并行**（`Promise.allSettled`，:269）：
   - 链 A 视觉方向：`extractVisualDirectionFromIdea` → `refineWithAudit`（配 `auditVisualDirection` 自检，最多 1 轮，`VISUAL_DIRECTION_MAX_ROUNDS = 1` :34）→ 写 `visualDirection`（`revision+1`、`status="draft"`）+ **`wizardStep: 2`**（:201-228）。即「切页时机 = 视觉方向完成」，早于资产提取；**不复位 `project.status`**
   - 链 B 资产：`character / scene / product / prop` **4 个独立小请求并发**（:237,241），每类完成立刻追加写回 → 卡片逐类出现；**角色类写回前先过一次主体忠实自检**（`auditCharacterFidelity`，把想法原文与角色身份交给模型核对，越界则按名字改回 description / appearancePrompt，审计失败一律保留原提取结果）；提取提示词另含内置条目 `extract.paintable-features` —— 外观/识别特征字段（含摘要行）只写可画的**部件型**特征，想法给出的**状态型**事实（失明、疤痕、跛行等）改写成等效部件并把原状态留在 `personality` / `background`，`auditCharacterFidelity` 对这种转写**不判越界**（实测：新增部件可画、改状态六组全失败，属模型能力边界）；单类失败不影响其他类，全部失败才算失败（:283-286）。**请求条数不变**
5. 任一链失败 → 项目 `status="failed"` + `error`，抛给 StepIdea 上屏（:273-282）
6. 两链都完成才 `status="idle"`（:285），`finally` 注销注册表（:302-304）。即 **`scripting` 精确覆盖"提取未收尾"**：步骤 1 的「AI 提取」与底部「下一步」、侧栏转圈都以它为准
7. 两链都成功后 fire-and-forget 后台链：`generateStyleReference(targetProjectId)` → `generateAssetImages(undefined, targetProjectId)`（:288-291，顺序不可颠倒，风格图先行）

> **2026-09-22 修复（此前无任何单飞保护）**：旧 `canAdvance` 步骤 1 只看 `ideaPrompt` 非空，加载态又只在组件本地。实测误操作路径「提取中点下一步 → 返回上一步 → 再点提取」会并发跑两轮提取：两轮各自清空旧资产、并按**各自启动时的 `project.assets` 快照**追加写回，模型对同一故事命名不稳定 → 同类资产重复入库（一次实测 13 个资产，含 `奇幻冒险的客厅` / `客厅奇幻冒险场景` 两同一异），并连带把风格母版与资产图请求翻倍（同一次实测 12 次生图）。

资产去重（`lib/extractAssets.ts`）：按 `name.trim().toLocaleLowerCase()` 去重，`dedupeAgainst` 只传 manual 资产；character 附带 `appearancePrompt` + `assetNamespace` + `fullPrompt`，`prompt = appearancePrompt`。

---

## 4. 步骤 2：资产工作台

`StepAssets.tsx`。资产分组：角色 / 场景 / 核心主体(product) / 关键物件(prop) + 顶部「视觉方向」卡（style 资产 + 风格母版图）。

### 4.1 风格母版链 `generateStyleReference`（`useAssetActions.ts:172-287`）

1. 幂等：已有风格图且非 `force` → 直接返回；本项目已有资产任务在飞 → 直接返回（:183-184）
2. 懒建 style 资产（`source:"extracted"`，`description = project.style`）（:194-208）
3. 派生 + 自检（`force` 或 prompt 为空且未被 `derivation.locked` 时）：
   - `deriveStylePrompt`：输入刻意**只有中文风格描述 + 视觉方向六维**，不含故事主体 → 英文 stylePrompt（:63-114，purpose `styleRef`）
   - `auditStylePrompt`：禁止清单来自 `collectSubjectVocabulary(project)`（项目自身资产名，数据驱动），越界则由模型重写（purpose `stylePromptAudit`，Thinking 恒关）（:122-162）
   - 轮数上限 1（`STYLE_PROMPT_MAX_ROUNDS` :165）；审计抛错只 warn 并保留原文，不阻塞
4. `composeStyleReferencePrompt(stylePrompt)` → 生图 → 先写 style 资产 `imageUrl`，再写 `project.styleReferenceUrl`（:254-276），两次写回都带 `renderRevision` 校验
5. 失败 → 写 `project.styleReferenceError`，**不抛出**（:277-282）

### 4.2 资产图批量 `generateAssetImages`（`useAssetActions.ts:290-495`）

1. 阶段 1：`generateStyle && 无风格图` → 先 `await generateStyleReference`（:315-317），风格失败不阻塞
2. 阶段 2：`createBatchRunner`，**并发 3**（:489），任务筛选 = 该类型且 `!imageUrl`
   - ⚠️ 批量**只按 `!imageUrl` 过滤，不检查 `prompt` 是否为空**；只有手动「补全缺失资产」在算 options 时额外要求 `prompt.trim()`（`StepAssets.tsx:204-208`）。所以步骤 1 尾部的自动批量会对空提示词资产（如用户早先手动加的场景）发一次只有边界句的无效生图请求，白扣一档图片配额
   - 角色 → `composePortraitPrompt({ appearancePrompt, species, stylePrompt })`（中文控制语；`appearancePrompt` 由 `composeAssetAppearance` 从中文 `details` + 摘要行拼装、非模型产出；物种锁定吃 `details.species`，无 `photorealistic`、无人像语汇）
   - 场景 / 产品 / 道具 → `composeTextToImagePrompt({ subject: assetImageBoundary(kind) + prompt, style: stylePrompt })`
   - ⚠️ **风格母版不作为 i2i 参考图**（2026-09-15 事故决策，代码注释 :322-325 与 :239-240 双处说明）：参考图内容会被整体复制，风格一致性只由 stylePrompt 文本承载
3. 每个任务写回前都用 `expectedRevision`，失败写 `asset.error`；`onBeforeRun/onFinally` 维护 `assetGenerationStarted`
4. 单资产重生成走 `StepAssets.tsx:228-268`（`generateSingleAssetImage`）：同一套 prompt 拼装 + revision 写回，但**不登记到 activeAssetTasks**

### 4.3 手动编辑入口（三条，全在步骤 2）

- 角色：`CharacterEditor` + `useCharacterEditorActions.ts`。描述只由 AI 维护（指令 → `chatCompletion`，**该调用不声明 `purpose`**，故不经参数决策层，用服务层默认 `temperature: 0.7`；系统提示词 `SYSTEM_PROMPT_CHARACTER_DESCRIPTION_ZH`），改成功后**立刻**重派生英文 appearancePrompt（竞态守卫 `descriptionRef`，:71-75,229）；勾选「自动重生成定妆照」则链路尾部自动生图（:251-253）；定妆照用 `randomSeed()`（seed ∈ 0..999，:36-40）
- 场景/产品/道具：`AssetEditor.tsx`，draft + 保存模型；指令 → `purpose:"fieldAssist"` + `SYSTEM_PROMPT_ASSET_EDIT_ZH`，返回 JSON 解析失败就地报错；勾选自动重生成则立刻生图（:117-119）
- 视觉方向：`VisualDirectionEditor.tsx`，`purpose:"visualDirection"` + `SYSTEM_PROMPT_VISUAL_DIRECTION_EDIT_ZH`；**保存走 `updateVisualDirection`**

⚠️ `updateVisualDirection` 是全屏级联失效（`projectStore.ts:97-120`）：`revision+1`、`status="stale"`、清 `styleReferenceUrl`、`assetsReviewed=false`、**所有资产 `imageUrl` 清空**、style 资产 prompt 清空且 `dirty:true`。即改一次视觉方向 → 步骤 2 所有图需重跑。

### 4.4 推进与门禁

- 半自动：底部「确认这批资产并生成分镜」→ `assetsReviewed = true` → `enterStoryboard()`（`StepAssets.tsx:131-136`）
- `enterStoryboard` 关键行为（:101-128）：**已有分镜内容则直接切页不覆盖**；否则在**本页** `await generateStoryboard(idea, { onProgress })`，首个镜头写回（成功或失败都算）即 `setWizardStep(3)`，其余镜头继续在后台填充
- auto：`allAssetsImaged` 由 false→true 时才自动进入分镜（:142-153），且要求**每个资产都有图**——任一资产失败会永久卡住自动推进（代码注释已承认，:141）
- 底部「下一步」门禁：`case 2 = automationMode==="auto" || assetsReviewed===true`（`CreationWizard.tsx:50`）
- 刷新恢复：`assetGenerationStarted === true` 且 `hasActiveAssetTask(project.id)` 为假 → 复位 false，避免按钮永久转圈（:88-93）

---

## 5. 步骤 3：分镜

### 5.1 生成 `generateStoryboard`（`useScriptActions.ts:312-432`，两阶段）

1. 幂等：`activeScriptTasks` 命中该项目 → **直接 return（不抛错）**（:327）
2. `resetStuckShots` 复位上一轮残留 `scripting` 占位（:330），登记 AbortController，`project.status = "scripting"`
3. 阶段 1 大纲：`generateStoryboardOutline`（`scriptService.ts:287`，purpose `storyboardOutline`）→ 校验 `Array.isArray(shots) && length>0`，否则 `error.shotsInvalid`；返回 `shots[{title,summary,characterNames,sceneName?}]` + `newCharacters` / `newScenes`
4. 大纲发现的新资产先补建入库（`extractNewAssets`，:349-357）
5. 阶段 1.5 占位：按大纲长度写入 N 个 `status:"scripting"` 空镜头 → 卡片全部立刻出现并显示生成中（:362-376）
6. 阶段 2 逐镜头：`runWithConcurrency(tasks, SHOT_CONCURRENCY = 3)`（:37,417），每镜头一次 `generateStoryboardShot`（purpose `storyboard`，骨架 `storyboardShot`，≤3 次尝试 `MAX_SCRIPT_RETRIES=2` 无退避，`scriptService.ts:122,432`）
   - 单镜头失败 → 只把该镜头置 `failed` + `error`，不影响其他镜头（:402-406）
   - 写回前 `buildShotUpdate`（:72-102）统一解析引用：`resolveAssetId/Ids` 先按 ID 后按名称，对白生成 `dlg_*` 实体 ID，匹配不到置 `null`（归旁白）；引用未命中只降级为空，**绝不阻断内容写回**（:67-70 注释记录了 2026-09-16 事故）
   - `normalizeRawShot`（`scriptService.ts:345`）：`duration` 只接受 `{4,5,8}` 否则回落 5；`visualPrompt` / `motionPrompt` 为空则该次尝试判失败并重试
7. 全部返回 → `project.status = "idle"`；大纲阶段异常 → 复位占位 + `status="failed"` + 抛错（:420-428）

### 5.2 触发时机（三处，都收敛到同一个幂等函数）

- 从步骤 2 点确认（`StepAssets.enterStoryboard`）
- 步骤 3 挂载 effect 自动补生成（`StepStoryboard.tsx:103-129`）：仅当「没有任何镜头带内容」+ `hasActiveScriptTask` 为假 + 有 ideaPrompt；依赖只放 `[shots.length, ideaPromptTrimmed]`，`autoStoryboardRef` 挡 StrictMode 双挂载
- 顶部「重新生成」按钮：已有镜头时先 `confirmDialog`（覆盖会丢手改 + 白耗配额，:44-52）

### 5.3 唯一的修改入口 = 详情页一句话指令

步骤 3 内容**全只读**（列表卡 `ShotListSection` → 整卡点击进 `ShotDetail`）。改写走 `reviseShot`（`useScriptActions.ts:497-549`）→ `reviseShotWithInstruction`（`scriptService.ts:515`，purpose `shotEdit`，≤3 次尝试）→ 同一套 `buildShotUpdate` 写回，`status` 回 `scripted`。撤销栈在组件本地（`ShotDetail.tsx:95-113`，只含内容字段快照）。生成中（`scripting|imaging|videoing`）改写入口整体禁用（:64-66）。单镜头重摇 = `rerollShot`（:435-490，同阶段 2 单请求，带 `variationOf`）。

### 5.4 推进与门禁

- 半自动：底部审核卡点要求「所有镜头 scriptText 非空 且 visualPrompt 非空」（`StepStoryboard.tsx:249`）→ `storyboardReviewed=true` + 切步骤 4
- auto：`generateStoryboard` 成功后立刻 `setWizardStep(4)`（:57-61 与 :117-121 两处）
- 底部门禁：`case 3 = 有镜头 && 全部 scriptText 非空 && (auto || storyboardReviewed)`（`CreationWizard.tsx:51-52`）

---

## 6. 步骤 4：镜头图片

`useImageActions.ts`，模块级 `runImageBatch`（:111-189，**并发 3**，:205）。

1. `recoverStuck`：注册表空时把残留 `imaging` 复位成 `scripted`（:113-122）
2. 筛选待生成：`!imageUrl && status !== "imaging" && visualPrompt.trim()`（:127-129）——缺 visualPrompt 的镜头**静默不参与**，UI 用 `missingPromptCount` 横幅提示（`StepImages.tsx:116-120`）
3. 提示词组装 `buildImageGenerationInput`（:73-109）：
   - 参考图 `pickShotReferences`：**只有角色定妆照 → 产品图 → 道具图**（显式引用，`promptComposer.ts:282` 起）；场景图与风格母版都不进参考图（各自注释都写明是 2026-09-15 事故决策）
   - 有参考图 → `composeMultiReferencePrompt`；无参考图 → `composeTextToImagePrompt` 六段式 + `quality: "high quality, 8k"`
   - 正向约束从注册表取 `composeShot` + `negativeStrategy` 生效文本注入（:57-63），**不新增 API negative 字段**
4. 请求：`generateImage({apiKey,baseUrl,prompt,size,ratio,referenceImageUrls?})`；`aspectRatioToImageParams` 归一化（size 恒 `"1K"`，ratio 白名单外回落 `"1:1"`，`imageService.ts:72-78`）
5. 写回 `imageUrl` + `status:"imaged"`，带 revision 校验；失败置 `failed` + error
6. `onFinally`：全部有图 → `project.status="idle"`；否则 `failed` + **硬编码中文**「图片生成失败 N 个镜头，请重试失败项。」（:184-186）

自动触发与计数口径：唯一的待生成定义在 `src/lib/shotQueue.ts:pendingImageShots`（无 `imageUrl` && `status !== "imaging"` && `visualPrompt` 非空，**含 `failed`**）—— 批量 `buildTasks`、挂载 effect（只依赖 `[shots.length]`，刻意不含 `imageGenerationStarted`）、界面计数三处共用同一函数。顶部按钮不再只在有失败时出现：只要 `pendingCount > 0` 就常驻「补做缺失 (N)」（含失败时文案为「重试失败」），非生成中时另有横幅提示这些镜头可能因失效规则被清空、可只补这些。auto 模式在全图 false→true 时 `setWizardStep(5)`；半自动由 `ReviewCheckpoint` 确认 → `imagesReviewed=true` + 切 5，且**存在失败镜头时确认按钮禁用**（`ReviewCheckpoint.tsx:85`）。

单项 reroll `rerollImage`（:208-259）不登记注册表。

---

## 7. 步骤 5：镜头视频

`useVideoActions.ts`，`runVideoBatch`（:29-182）。并发按套餐：`tokenplan → 3`，`rpm.video <= 1 → 1`，否则 `2`（:198-202）。

1. `recoverStuck`：残留 `videoing` → 回 `imaged`，`videoProgress=0`（:31-41）
2. 筛选：`src/lib/shotQueue.ts:pendingVideoShots` = `!videoUrl && imageUrl && status !== "videoing" && (motionPrompt || actionDesc)`；排队数、待消耗秒数与顶部「补做缺失 (N)」按钮全部基于同一函数（含 `failed`）
3. 提示词：`composeMotionPrompt(shot)`（恒直接返回 `shot.motionPrompt`，子字段不二次拼装，`lib/promptUtils.ts:21`）+ `appendRegistryRules(negativeStrategy)`
4. 单镜头内部自带重试环：`MAX_TASK_RETRIES = 2`、退避 `8s * (attempt+1)`（:63-64,140-152），退避等待监听 abort 事件；但**当前没有任何入口会触发这个 abort**（见 9.3）
5. `generateVideo`（`videoService.ts`）—— 素材由 `src/lib/videoPlan.ts:planShotVideoMedia` 按设置项 `videoConsistency` 决策，批量与单项重摇共用同一函数（`useVideoActions.ts` 不再自己拼素材）：
   - **先限流**：`rateLimiter.acquire("video", { cost: duration || 1, signal })`（:135），配额按秒计、在 HTTP 之前扣
   - 创建体：`size 恒 "720P"`（:71）、`aspect_ratio` 白名单、`seconds = clamp(round(duration), 4, 12)` 转字符串（:139-143）、`n:1`
   - **`mode` 三选一，帧素材与参考图绝不同时出现**：
     - `keyframe`：优先级 用户手动双帧 > 同场景自动衔接尾帧 > 仅本镜画面图作首帧；
     - `reference` + `images`（≤5）：`videoConsistency === "identity"` 且同场景衔接取不到尾帧时（换场景、末镜），改送 `[出场角色定妆照…, 风格母版]` 锚身份与画风；
     - `text`：无素材（当前筛选要求有 `imageUrl`，实际不可达）。
   - ⚠️ 实测依据见 `docs/roadmap/competitive-gap-2026-09-21.md` §6：`reference` 与 `first_frame`/`last_frame` 同时传，服务端 400「首尾帧素材与参考素材不能同时使用」。
   - 创建 POST `{baseUrl}/videos`（`videoService.ts`），通用重试 `maxRetries 0`（非幂等，2026-09-23 起超时/5xx 不自动重发）+ 单次超时 180s；**429 例外**，走独立冷却通道（`rateLimitRetries = RATE_LIMIT_RETRY_BUDGET` + `onRateLimited → notifyRateLimited("video", { signal })`，见 9.1）；`video_id ?? task_id ?? id`
   - 轮询 `GET {origin}/agnesapi?video_id=...&model_name=agnes-video-2.5-flash`，间隔 5s、超时 30 分钟、`task_not_exist` 最多容忍 24 轮。轮询请求经 `pollVideoTask` 包装：**任何请求级失败（含 429 重试耗尽后抛出的 `HttpError`、网络错误、超时）一律转成带 `videoId` 的 `VideoTaskCreatedError`**（2026-09-23 修）。此前 `fetchWithRetry` 耗尽重试是抛错而非返回响应，普通 Error 会被 `useVideoActions` 判成「创建阶段失败」而走自动重发分支，于是对同一个镜头再发一次 `POST /videos` —— 服务端多出已计费的重复任务，一次被限流卡住的 GET 就能触发
   - 完成 URL 顺序（:288-294）：`url → metadata.url → video_url → output.url → output.video_url → remixed_from_video_id`；函数返回 `{ videoUrl, coverImageUrl, duration }`（:64-68,342），但**两个调用点只取 `result.videoUrl`**，cover 与实际时长被丢弃
   - **创建后失败的错误类型是 `VideoTaskCreatedError{videoId, stillRunning}`**（`videoService.ts:35-48`）；上层 `useVideoActions.ts:100-122` 对 `stillRunning=true` **只等待不再创建新任务**（避免双倍消耗），false 才判失败
6. 写回 `videoUrl` + `status:"videoed"`（revision 校验）；`onFinally`：全有视频 → `idle`；全落定（有视频或失败）→ 复位 started + `failed`（`useVideoActions.ts:174-180`，硬编码中文文案）

尾帧来源有两个：**用户手动**（`DualFrameToggle` 勾选后点选其他镜头图或手输 URL，`DualFrameToggle.tsx:82-90`）与**同场景自动衔接**（`shotContinuity` 把下一镜的画面图当本镜尾帧，受设置项 `videoConsistency` 控制，手动值永远优先）。自动衔接**不写 store** —— `useDualFrame` / `lastFrameUrl` 属于 MOTION 字段，写回会清空已生成视频（见 9.4），所以只在发请求那一刻派生。另：`shot.firstFrameUrl` 只被 `normalizeRawShot` / `pickShotFields` 搬运，请求侧从不读取它（`first_frame` 用的是 `shot.imageUrl`），当前是**无消费者的死字段**。

推进：步骤 5 没有审核卡点，auto 模式全视频 false→true 时 `setWizardStep(6)`（`StepVideos.tsx:67-76`）；半自动靠底部「下一步」，门禁 `case 5 = 每个镜头都有 videoUrl`（`CreationWizard.tsx:55`）。

---

## 8. 步骤 6：成片拼接（零 AI 调用）

`StepAssembly.tsx:68-110` → `renderService.concatenateVideos({videoUrls, onProgress, signal})`，顺序即 `shots` 数组顺序。

1. `project.status = "rendering"`
2. **只有 1 个视频时直接短路**：不走 FFmpeg，只下载并包成 `Blob(type:"video/mp4")` 的 objectURL，进度直接 100（`renderService.ts:191-198`）
3. 多视频：FFmpeg.wasm 单例 load（CDN 三级兜底）→ DEV 下把 `cos-platform-outputs.agnes-ai.cn` 改写成 `/cdn-proxy<path?query>` 保留 COS 签名，代理失败回落直连 → 逐个 fetch（120s 超时并与外部 signal 合并）写虚拟文件，进度 0→50 → 写 `concat_list.txt` → `-c copy` 拼接（50→80），失败则删产物改重编码 `libx264 ultrafast crf23 + aac` 重跑 → 读回 Blob → objectURL（85→100），`finally` 删全部虚拟文件
4. 取消：下载阶段 abort fetch，FFmpeg 阶段 `ffmpeg.terminate()` 并清实例（:204-212）；用户取消**不算失败**，状态复位 `idle`（`StepAssembly.tsx:98-101`）
5. 错误信息尾部附最近 **20 行** FFmpeg 日志（`renderService.ts:146-147,262`），界面用 `<pre>` 展示
6. 产物只存组件内 state（blob URL 不入 store），项目切换与组件卸载都 `revokeObjectURL`（:31-53）
7. 完成 → `project.status = "done"`；下载走临时 `<a download="${project.title}.mp4">`

auto 模式：`canRender && !isRendering && !renderedUrl` 且「从未就绪到就绪」时自动拼接一次，失败不自动重试（:58-66）。

---

## 9. 横切机制（跨步骤统一规则）

**9.1 限流与配额（`services/rateLimit.ts`）**

三类真实入口统一 `await rateLimiter.acquire(kind, opts)`：文本 `ai/openai.ts:72`（cost 恒 1）、图片 `:180`（按 `imageSizeToTier(size)` 分档）、视频 `videoService.ts:135`（cost = 秒数）。
`guard` 顺序 = `waitForCooldown → throttleRpm → checkQuota → recordRpm + recordQuota`：**槽位与配额都在发请求之前扣掉**，请求失败不回滚。RPM 60s 滑窗（图片按档位 key），达上限则睡到最早一条滑出 +50ms。配额仅 `accessType === "tokenplan"` 生效，bucket 为 `5h/周（文本）、日（图片张数）、日（视频秒数）`，用尽抛 `RateLimitError{reason:"quota"}`；取消抛 `reason:"aborted"`。用量持久化 localStorage `wxhb-usage`。每种 kind 一条串行队列，保证等待按到达顺序。

⚠️ **RPM 阈值只是开环粗过滤，防不住 429**（2026-09-23 实测 `debug-dump/runtime.log`）：免费档文档值文本 20 RPM，而服务端在 12 请求/38s（步骤 1 资产提取）与 7 请求/37s（步骤 3 逐镜头分镜）就返回 429「您已达到免费用户的 API 速率限制」，`acquire` 的等待分支一次都没触发；同期另有 20 请求/60s 全绿的窗口，说明真实限额不按请求条数计。

**429 闭环冷却**（真正的防线）：入口把 429 回报给 `rateLimiter.notifyRateLimited(kind, { retryAfterMs, signal })`，按模型种类登记分钟级冷却（无 `Retry-After` 时兜底 30s，实测窗口 16-20s 自愈；被夹在 15s～120s 之间），同 kind 后续 `acquire` 一律等到窗口解除。429 的重发走 `fetchWithRetry` 的**独立通道**（`rateLimitRetries` + `onRateLimited`，预算 `RATE_LIMIT_RETRY_BUDGET = 2`），不消耗通用 `maxRetries` 预算 —— 依据是 429 表示服务端在建任务前就拒绝（未建任务、未计张数/秒数），重发安全；而超时 / 5xx 无法证明服务端未处理，非幂等创建仍恒 `maxRetries: 0`。三个生成入口（文本 `ai/openai.ts`、图片同文件、视频创建 `videoService.ts`）均已挂上。

细节：取消时抛出的 `RateLimitError` 的 `kind` 字段恒为 `"text"`（`rateLimit.ts:86,95`），即使等待的是图片/视频档位——按 kind 分类错误时别依赖它。

RPM 与配额表（`lib/plans.ts:73-134`，格式 文本 / 图片1K,2K,3K,4K / 视频；配额 文本5h,文本周,图片日,视频秒日）：

- `default` 免费：20 / 20,10,1,1 / 1，无配额
- `enterprise`：40 / 40,20,1,1 / 2，无配额
- `starter`：1000 / 100,80,1,1 / 5；1500, 15000, 4000, 500
- `plus`：同上 RPM；7500, 75000, 4000, 500
- `pro`：同上 RPM；30000, 300000, 4000, 500

**9.2 采样参数由模型自决（`lib/generationParams.ts`）**

内容调用前 `resolveGenerationParams({purpose, context, cacheKey})` 会**先发一次元请求**让模型决定 `temperature/topP/enableThinking`。缓存 key = `${purpose}:${cacheKey ?? ""}`（`generationParams.ts:131`）——`assetExtraction` 按资产类型分键（四类并发共用一个槽会让彼此决策互相覆盖，实测 topP 逐轮从 0.8 漂到 0.7），其余 purpose 不传即每会话每槽只多付一次文本请求。**同键并发走单飞**（`paramInflight` :129）：N 路同时 miss 只发一次元请求，避免"最后返回者胜出"。决策失败退化为 `{temperature:0.7, enableThinking:false}`；`visualDirectionAudit` / `stylePromptAudit` / `characterFidelityAudit` 的 Thinking 被结构性钉死为 false（:65）。集中管理的只有这三个参数，`max_tokens`（恒 65536）、图片 size/ratio、视频 size/seconds/mode 都在别处固定。

**9.3 批量幂等与恢复（`lib/batchRunner.ts` + 五张模块级注册表）**

`activeScriptTasks` / `activeAssetTasks` / `activeImageTasks` / `activeVideoTasks`（各 `useXxxActions.ts` 顶部，Map<projectId, AbortController>）。`createBatchRunner` 执行序：注册表命中即返回 → `recoverStuck` → 新建独立 AbortController → `buildTasks`（空则 `onEmpty` 且**不登记**）→ 登记 → `onBeforeRun` → `runWithConcurrency`（N 个 worker 共享自增队列，`Promise.allSettled`，abort 后停止领取新任务）→ `finally` 注销 + `onFinally`。
第五张 `activeIdeaTasks`（`useScriptActions.ts:59`）不走 `createBatchRunner`（步骤 1 是两链并行、不是同构批量），但用同一套 `hasActiveTask` 守卫：命中即 `return true`，`finally` 注销。
刷新恢复：注册表天然为空 → `recoverStuck` 把 `imaging→scripted`、`videoing→imaged`、`scripting→idle`；`assetGenerationStarted` 在步骤 2 挂载时按 `hasActiveAssetTask` 复位；残留的项目级 `scripting` 由向导容器挂载时按 `hasActiveIdeaTask / hasActiveScriptTask` 一次性复位（`CreationWizard.tsx:31-42`）。

⚠️ **实测：批量任务实际不可取消。** 全仓 `controller.abort()` 只有 5 处：`StepAssembly.tsx:114`（拼接取消按钮）、`lib/fetchWithRetry.ts:106,115`（单次请求超时 + 外部 signal 转发）、`services/renderService.ts:109,112`（下载超时 + signal 转发）。也就是说，**唯一的用户级取消入口是步骤 6 的「取消拼接」**；各注册表里登记的 AbortController 以及 `generateStyleReference`（`useAssetActions.ts:188`）、`rerollVideo`（`useVideoActions.ts:222`）自建的 controller 没有任何地方 abort。因此 `signal.aborted` 在批量链路里恒为 false：切项目、离开步骤、组件卸载都不会中断在飞请求与视频轮询，任务只在后台跑完并按 projectId 写回。

**9.4 过期结果丢弃（`renderRevision`）**

所有异步写回先捕获 `expectedRevision`，完成时用 `updateShotByProjectIdIfRevision` / `setShotStatusByProjectIdIfRevision` / `updateAssetByProjectIdIfRevision`（这些路径与普通版共用同一套 `applyShotUpdates` / `applyAssetUpdate`，见 `projectStore.ts:285-300,416-429`）；期间用户改过输入 → revision 已 +1，旧结果被静默丢弃（返回 `false`，写回不发生）。

`applyShotUpdates`（`projectOps.ts:80-145`）的分支**按以下顺序**判定：

| 条件 | 后果 |
|---|---|
| 写入 `imageUrl` 且未同时写 `videoUrl`（图片批量/重摇的正常写回） | 清空 `videoUrl/videoProgress/videoRetryCount`，revision +1 |
| 写入 `videoUrl` | 清空 `videoProgress/videoRetryCount`，revision +1 |
| 命中 VISUAL 字段 | 清空图片与视频全部产物，`status = scriptText 非空 ? scripted : idle`，revision +1 |
| 命中 MOTION 字段 | 只清视频产物，`status = imageUrl ? imaged : (scriptText ? scripted : idle)`，revision +1 |

- `VISUAL_SHOT_FIELDS`（:35-46）= `scriptText, visualPrompt, sceneDesc, detailDesc, lightingDesc, styleDesc, activeCharacterIds, activeSceneId, activeProductIds, activePropIds`
- `MOTION_SHOT_FIELDS`（:48-58）= `motionPrompt, actionDesc, cameraDesc, envChangeDesc, motionSpeedDesc, duration, useDualFrame, firstFrameUrl, lastFrameUrl`
- **推论**：在步骤 4/5 改一个子字段（如 `sceneDesc`）会立即作废该镜头已生成的图片和视频；改时长或首尾帧只作废视频。这就是「改完必须重新生成」的真实机制。
- 前两条里的 `outputChanged` 要求**值确实不同**（`projectOps.ts:83-85`）；写回相同 URL 不会递增 revision。

**9.5 跨项目写回**：四个 `useXxxActions` 的生成链路统一在开始时 `const targetProjectId = project.id`，回写只用 `updateProjectById` / `*ByProjectId` / `setProjectStatusById`。仍有 active-project 版 action 跨异步边界使用的地方集中在角色编辑器与步骤 4/5 子字段（见第 12 节第 2、4 条）。

**9.6 级联失效（两条，都会跨步骤影响已完成产物）**

1. `updateVisualDirection`（`projectStore.ts:97-120`）：清 `styleReferenceUrl`、`assetsReviewed=false`、**所有资产 `imageUrl` 清空**、style 资产 `prompt` 清空且 `dirty:true`、`revision+1`、`status="stale"`。
2. `applyAssetUpdate`（`projectOps.ts:182-213`）：只要资产的渲染字段真的变了 —— 字段集见 `assetRenderFieldsChanged`（:155-167）= `type / name / description / prompt / appearancePrompt / imageUrl / avatarUrl / multiViewUrl` —— 就会：
   - `assetsReviewed` / `imagesReviewed` / `storyboardReviewed` **三个审核标记全部重置为 false**（半自动门禁重新锁上）
   - 对每个引用该资产的镜头执行 `invalidateShotForAsset`（:169-179）：清 `imageUrl` + `videoUrl` + 进度、`status` 回 `scripted|idle`、revision +1
   - `shotUsesAsset`（:147-153）对 **style 资产恒为 true** → 改风格资产等于让全部分镜图片视频作废
   - ⚠️ 生成器自己写资产 `imageUrl` 也走这条路径（`updateAssetByProjectIdIfRevision` 同样调用 `applyAssetUpdate`），所以「步骤 4 出完图后回步骤 2 点『补全缺失资产』或重新生成某个角色图」会连带清掉相关镜头已生成的图片与视频。该行为由单测锁定为期望（`tests/stores/projectStore.test.ts:137-191`），不是意外。

`removeAsset`（`projectStore.ts:430-453`）：重置三个审核标记，并从每个镜头的 `activeCharacterIds / activeSceneId / activeProductIds / activePropIds` 与对白的 `characterId` 中剔除该 ID（对白归旁白）。⚠️ 但**它没有清空受影响镜头的 `imageUrl` / `videoUrl`，也没走 `invalidateShotForAsset`**，与自身注释「受影响镜头的图片/视频也必须失效」不一致（见第 12 节第 5 条）。

**9.7 润色/撤销**：所有输入框内嵌「润色 / 撤销」（`components/ui/AiPolishField.tsx`），走 `chatService.polishText`（purpose `fieldAssist`），系统提示词经 `resolvePolishSystemPrompt` 取注册表生效版；撤销栈组件本地、`resetKey` 变化即清空。

---

## 10. 一次完整跑通要发多少请求（N = 镜头数，A = 需出图的资产数，不含 style 资产）

文本（`acquire("text")`，每次 cost 1）：

- 步骤 1 链 A：视觉方向提取 1 + 自检审计 1
- 步骤 1 链 B：`character / scene / product / prop` 提取 4 + 角色主体忠实自检 1（仅角色类，写回前发；即使返回 `clean=true` 也要占这 1 次）
- 风格链（**由步骤 1 尾部的后台链触发**，界面已在步骤 2）：派生 stylePrompt 1 + 越界审计 1（`style` 资产已有非空 prompt 且未 `locked`/未 `force` 时这两次都跳过）
- 步骤 3：大纲 1 + N（每个镜头 1 次，JSON 无效时同一镜头最多 3 次尝试）
- 元请求：每个「purpose + cacheKey」槽首次出现时 +1（`generationParams`，之后按该槽缓存）——`assetExtraction` 按资产类型分键，故占 4 个槽
- 按需：步骤 2 三类编辑器指令改写、步骤 3 一句话改写、任意输入框润色，各 1 次（+ 该 purpose 未缓存时的元请求）

图片（`acquire("image")`，档位恒 1K）：风格母版 1 + A + N
视频（`acquire("video")`，cost = 秒数）：N 次创建 + 轮询（轮询不占 RPM 与配额）
步骤 6：0 次 AI 调用，纯本地 FFmpeg

默认（免费）档节流下限：文本 20 RPM、图片 1K 20 RPM、**视频 1 RPM** → 5 个镜头的视频阶段仅节流就 ≥ 4 分钟；这也是向导把视频并发按套餐降到 1 的原因（`useVideoActions.ts:198-202`），慢的是配额节流不是前端。

---

## 11. 与 AGENTS.md / README 现有描述的差异（代码为准）

> **2026-09-21 状态更新**：本节逐条列出的 `AGENTS.md` 漂移已全部订正（项目结构与数据模型整节重写、失效函数名替换、取消能力标注为目标态、persist 版本改 v16 等），结案记录见 `docs/index.md` §4-C1…C16。本节正文按快照原则**保留原文不改**，其中的「AGENTS.md 仍写…」表述读作当时状态，勿再作为待修清单使用。

1. `useWizardActions.ts` 已拆为 `useScriptActions / useAssetActions / useImageActions / useVideoActions` 四个域，前者只剩 35 行门面；AGENTS.md 仍写「向导操作编排（含模块级幂等守卫注册表）」并标注其为主要实现文件
2. 步骤 2 资产已从 3 类扩为 **4 类 + 风格**：`character / scene / product / prop / style`；AGENTS.md 数据模型仍写 `character / scene / product`
3. 视觉方向（`project.visualDirection` 六维结构化）是新增的一等公民，AGENTS.md 项目结构里完全没有该文件（`VisualDirectionEditor.tsx`）
4. **风格母版已不再作为任何 i2i 参考图**（资产图与分镜图都是），AGENTS.md「阶段 2 的任务经 `referenceImageUrls` 参考风格图」「风格图恒占末位，总数 ≤3」已失效
5. 分镜图参考现在只有 角色定妆照 → 产品 → 道具，**场景图明确不进参考**；AGENTS.md「场景→角色→产品合计 ≤2 张」口径已失效
6. 「轻量资产提取接口 `extractAssetsFromIdea`」已被替换为 `extractVisualDirectionFromIdea` + `extractAssetsByType`（4 路并发）；「完整分镜生成仅在步骤 3 调用 `generateScript`」中的 `generateScript` 已不存在，现为 `generateStoryboardOutline` + `generateStoryboardShot` 两阶段
7. `HistoryEntry` / 操作历史已从 store 删除（persist v15），AGENTS.md 数据模型仍列该实体
8. `CharacterPanel.tsx`、`src/features/history/` 已不存在；AGENTS.md 项目结构仍列出
9. `chatService.ts` 现只 re-export 7 个 `SYSTEM_PROMPT_*`（`SYSTEM_PROMPT_SCRIPT_TEXT / VISUAL_PROMPT / MAIN_PROMPT / MOTION_PROMPT / DESCRIPTION_ZH / CHARACTER / DIALOGUE`），「8 个常量已整体搬迁」的表述与实际不符；角色/资产/视觉方向的编辑提示词实际住在 `lib/promptRules.ts`（`SYSTEM_PROMPT_CHARACTER_DESCRIPTION_ZH` / `SYSTEM_PROMPT_ASSET_EDIT_ZH` / `SYSTEM_PROMPT_VISUAL_DIRECTION_EDIT_ZH`）
10. 负向提示词已无 UI 也无字段（AGENTS.md「存在 UI/模型字段待核实」的 P1 悬案可结案）：负向策略只以 `negativeStrategy` 注册表文本注入正向 prompt
11. `projectStore` persist 现为 **v16**，AGENTS.md 写「v1 → v11 持续存储迁移」
12. `src/lib/logger.ts` + `logStorage.ts` + `components/LogConsoleDock.tsx`（trace/span、localStorage 持久化、底部停靠控制台）与 `lib/generationParams.ts`、`lib/refineContent.ts`、`lib/batchRunner.ts`、`lib/jsonResponse.ts`、`lib/devDump.ts`、`lib/assetDetails.ts`、`lib/shotFields.ts` 均未出现在 AGENTS.md 项目结构中
13. 视频参数体系（`mode/size 720P/seconds/aspect_ratio/first_frame/last_frame`、轮询带 `model_name`）与 AGENTS.md 一致，未漂移
14. `ensureStyleAsset` **函数已不存在**，只在 `projectMigrations.ts:156` 与 `lib/extractAssets.ts:40` 的注释里残留；实际行为是 `generateStyleReference` 内部懒建 style 资产（`useAssetActions.ts:194-208`）。AGENTS.md「风格资产与风格提示词由 AI 派生（`ensureStyleAsset` 懒派生）」引用的是不存在的函数
15. AGENTS.md 写「生图请求 `size` 用档位 `"1K"/"2K"`」，实际 `aspectRatioToImageParams` 恒返回 `"1K"`（`imageService.ts:72-78`），全仓没有任何调用点会产生 2K；`ImageSizeTier` 的 `"2K"` 与 `plans.ts` 里 2K/3K/4K 的 RPM 档位目前是预留未用
16. AGENTS.md 铁律写「批量任务用独立 AbortController…取消、项目切换、组件卸载时不能遗留任务」，实际只有 controller 被创建与登记，**没有任何取消入口**（见 9.3）；切项目与卸载都不会中断在飞请求与轮询

---

## 12. 核对流程时值得你裁决的可疑点（我发现，未改）

按影响排序：

1. ~~**镜头图片被失效后，步骤 4 没有对应的补生成入口**~~ **已修复（2026-09-21）**。现在：待补做集合的唯一口径是 `src/lib/shotQueue.ts`（`pendingImageShots` / `pendingVideoShots`，**含 `failed`**），批量生成、挂载自动触发、界面计数与顶部按钮四处共用；按钮只要有待补做就常驻显示「补做缺失 (N)」（走同一个幂等批量函数），非生成中时另有横幅解释成因；只想补单个镜头仍可展开该镜头卡片用「重新生成」。因此改子字段或重生成资产图导致产物被清空后，不再只能整套重做。
2. **步骤 4/5 的子字段仍可手改**（`PromptSubFields.tsx:41-43` 用 active-project 的 `updateShot`，`onCommit` 再调 `rewritePromptFromFields` 重写整段英文）。与「分镜内容全只读、唯一入口是详情页一句话」相冲：同一段提示词有两个编辑源，且它正是第 1 条的主要触发器。
3. **单项重生成不登记注册表**：`rerollImage`（`useImageActions.ts:208`）、`rerollVideo`（`useVideoActions.ts:205`）、场景/产品/道具单项生图（`StepAssets.tsx:228`）、定妆照生图（`useCharacterEditorActions.ts:134`）都绕过 `activeImageTasks` / `activeVideoTasks` / `activeAssetTasks`（`generateStyleReference` 是例外，它登记了）。批量任务看不见单项任务，两者可同时对同一镜头/资产发起 → 服务端任务重复创建、配额双倍消耗。步骤 2 用 `anyGenerating` 禁按钮做了规避（`StepAssets.tsx:65-66`），步骤 4/5 没有等价守卫。
4. **定妆照写回跨异步边界用 active-project action**：`useCharacterEditorActions.ts:161` 的 `updateAsset(character.id, { imageUrl: url })` 与保存路径的 `updateAsset/addAsset` 都不带 projectId。等图片期间切换项目，结果会写进新项目的同名资产（AGENTS.md P1「多项目写回」尚未收口）。
5. **`removeAsset` 注释与实现不一致**（`projectStore.ts:430-453`）：注释写「受影响镜头的图片/视频也必须失效」，实现只剔除引用与审核标记，**没有**清空 `imageUrl` / `videoUrl`，也没调 `invalidateShotForAsset`。删除一个角色后，用它生成的镜头图/视频仍留在项目里并继续参与拼接。
6. **回步骤 2 重新生成任一资产图会连带清空镜头已完成产物**：`applyAssetUpdate` 把生成器自己的 `imageUrl` 写回也算「渲染字段变化」（9.6），并重置三个审核标记；改 style 资产则全部分镜作废。行为有单测锁定，但「补一个缺失资产 = 重做整套镜头图片」是否是你要的代价，值得确认。
7. **批量任务没有取消入口**（9.3）：注册表里的 controller 从未被 abort，切项目、离开步骤、组件卸载都拦不住在飞请求与 30 分钟视频轮询，钱照扣、结果照写回。
8. **配额在请求前扣、失败不回滚**（`rateLimit.ts:128-136`）。图片 403/内容过滤、视频创建后失败都会白扣一次配额；Token Plan 用户会看到「用量没了但没出片」。
9. **非幂等 POST 的重试收口状态**：**图片与视频创建的服务层均已收口**（2026-09-23，均改为 `maxRetries: 0` + 单次超时 180s，超时 / 5xx 失败交用户手动重试）。实测依据 —— 图片 1K 单张 29-59s 贴着 `fetchWithRetry` 默认 60s 线；视频 `createMs`（包着整次调用）30 次真实创建里 p50 仅 3.6s 却有 3 次越过 60s（62.8s / 140.8s / 142.8s），说明超时重发在生产里真的发生过，而视频按秒计费、重发一次就是再建一个任务再扣一次秒数。~~429 已由 `rateLimiter` 在发请求前按 RPM 节流~~（**该前提已被 2026-09-23 实测否定**，见 9.1）：429 现由服务层独立通道处理 —— 回报限流器登记分钟级冷却、等到窗口解除后重发（预算 2 次），因为 429 表示服务端建任务前就拒绝，重发不会重复计费。**同日一并修掉**：轮询的请求级失败此前以普通 Error 逃出 `generateVideo`，被上层误判为「创建失败」而再发一次 `POST /videos`（已计费的重复任务），现由 `pollVideoTask` 统一包装成带 `videoId` 的 `VideoTaskCreatedError`（`tests/services/videoService.test.ts` 有绊线）。**剩余的非幂等重发点**：编排层创建重试环（`useVideoActions.ts:59-126`，`MAX_TASK_RETRIES = 2`，创建抛错时最多再发 3 次）—— 超时 / 5xx 与「429 通道预算用尽后抛出的 `HttpError`」都仍会落到这个环里；收它要先决定「批量跑中一次网络抖动是否还自动救回」，属产品可见行为，未擅自改。
10. **资产图批量不过滤空提示词**：`generateAssetImages` 的任务只按 `!imageUrl` 筛选，不看 `prompt` 是否为空（`useAssetActions.ts:330-473`）；步骤 1 尾部的自动批量因此会对空 prompt 的资产（例如用户早先手动添加、尚未填设定的场景）发一次只含边界句的生图请求，白扣一档图片配额。手动入口有 `prompt.trim()` 守卫（`StepAssets.tsx:234`），批量没有。
11. `generateStoryboard` 命中幂等守卫时 `return`（不抛错、不 await 在飞任务），`StepAssets.enterStoryboard` 的 `onProgress` 永不触发 → 极端时序下点「进入分镜」无反应也不报错（`useScriptActions.ts:327` + `StepAssets.tsx:113-128`）。
12. ~~`pickShotReferences` 注释写「总上限 3 张」且把场景图列为首位参考，代码实为上限 4 张且排除场景图~~ **已修（2026-09-23）**：`promptComposer.ts` 函数头注释按实现改写（角色定妆照 → 产品 → 道具，≤4 张，场景图与风格母版都不进参考，并写入当日四臂实测否决结论）；同类陈旧注释 `useImageActions.ts:68`（原写「场景 → 角色 → 产品/道具，≤3 张」）一并更正。
13. 步骤 4/5 的 `onFinally` 错误文案硬编码中文（`useImageActions.ts:185`、`useVideoActions.ts:178`），违反「用户可见文本必须进 i18n」；`StepAssembly.tsx:168` 的「缺少镜头：#1、#2」同。
14. 步骤 1 的 `IDEA_POLISH_PROMPT` / `IDEA_POLISH_PROMPT_EN` 长提示词写在组件里（`StepIdea.tsx:14-28`），未进 `promptRules` 注册表，用户不可编辑、设置对话框里也看不到。
15. ~~视觉方向链完成即置 `project.status = "idle"`，此时资产提取链可能仍在跑 → 侧栏状态短暂显示空闲~~ **已修复（2026-09-22）**。现在链 A 只写 `visualDirection` + `wizardStep: 2`，**两链都完成才** `status = "idle"`（`useScriptActions.ts:285`）；该状态同时是步骤 1 的门禁信号（「AI 提取」按钮、输入框、底部「下一步」都以它为准），并在向导容器挂载时按注册表实况复位残留值（见 §3 与 9.3）。
16. auto 模式在资产/图片/视频任一环节出现失败镜头时**永久停住自动推进**（三处 `allXxx` 都要求 100% 成功，代码注释已承认是有意为之）。若期望「失败也继续收尾」，需要产品决策。
17. `generateVideo` 已解析出 `coverImageUrl` 与实际 `duration`，但两个调用点只取 `videoUrl`，封面与真实时长被丢弃（`videoService.ts:342`）—— 镜头卡缩略图与成片时长估算因此只能用请求值/占位。
18. 孤儿组件（无任何引用，属零调用死代码）：`src/features/script/ScriptPanel.tsx`、`src/features/preview/FinalPreview.tsx`、`src/features/preview/ShotPreview.tsx`、`src/features/wizard/ExpandableSection.tsx`。删除前建议再确认一次动态引用。

---

## 13. 数据生命周期（持久化）

`projectStore`：key `wxhb-project`，**version 16**，`migrate: migratePersistedState`（`projectStore.ts:647-651`）。

迁移块按文件顺序串行执行，实测顺序为 **2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 12 → 13 → 11 → 14 → 15 → 16**（`projectMigrations.ts:29-375`）：`version < 11` 的块被放在 `<12`、`<13` 之后（:263），因此 v10 及更早的数据会先跑 v12/v13 再跑 v11。三块作用于互不相交的字段（镜头引用数组 / visualDirection 保留 / 资产 details 物化），当前不影响结果，但顺序与版本号不一致，属可读性风险。

各版内容：

- `<2` v1 单项目 → `projects[]` + `activeProjectId`
- `<3` 加 characters / dialogues / activeXxxIds
- `<4` 加 `wizardStep` 与结构化提示词子字段
- `<5` 删 `mode`、旧步骤映射为 6 步、`automationMode = 'semi-auto'`
- `<6` 加 `sceneReferences` / `styleReferenceUrl`
- `<7` 加三个 `*GenerationStarted`
- `<8` `characters[]` + `sceneReferences[]` 合并进 `assets[]`（**保留原 ID**，否则对白与 `activeCharacterIds` 断裂）
- `<9` 只做结构合法化：非空 `prompt` / `appearancePrompt` → `derivation.locked = true`；**不凭空创建 style 资产**
- `<10` 把被模型压成单行的角色描述恢复为「总述 + 要素行」
- `<11` 规范化镜头的四个引用数组（显式场景/产品/道具契约引入）
- `<12` 仅保留可选的 `visualDirection` 字段，不合成值（旧项目继续用 `style`）
- `<13` 为所有非 style 资产物化结构化 `details`（旧 description 保留为 summary，缺字段按标签回填）
- `<14` `visualDirection` 六个平铺字段收进 `details`，并为 style 资产物化 details
- `<15` 删除 `history` 字段（`HistoryEntry` 就此退出持久化）
- `<16` `repairAssetDetails`：修正被前缀污染的值、补回因缺 `kind` 被整份丢弃的 details，只补空不覆盖正常值

图片/视频产物只存远端 URL（模型返回），不存 base64；仅步骤 6 的成片是本地 blob，不持久化。
