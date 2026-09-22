# 执行流程 ASCII 数据流图集（源码快照 2026-09-21 · 中文注释版）

配套文字版：`docs/execution-flow.md`。本图集只讲一件事：**每个环节吃什么参数、吐什么参数、往 store 写什么**。

写法约定：所有代码标识符一律写成 `英文标识符(中文含义)`，英文名保持不变以便回源码 `Ctrl+F` 定位；看不懂时只看括号。

---

## 图 A　术语对照总表（先读这张，后面 10 张图都在用它）

### A1 项目级字段 `Project`

```
id                  项目唯一标识
title               项目名（取自想法前 30 字）        下载时当文件名
wizardStep          当前向导步骤 1..6
automationMode      自动化模式：auto 全自动 / semi-auto 半自动
aspectRatio         画幅比例：16:9 横 / 9:16 竖 / 1:1 方
language            界面语言：zh 中 / en 英
prompt 一词的三种指向   ① 提交给文本模型的想法原文 ② 提交给生图模型的画面描述
                      ③ 提交给视频模型的动态描述；图中一律由所在行的函数名限定
status              项目状态：idle 空闲 | scripting 出脚本中 | imaging 出图中
                    | videoing 出视频中 | rendering 拼接中 | done 完成 | failed 失败
error               项目级失败原因（展示用）
ideaPrompt          用户输入的想法原文
style               中文风格描述（旧字段，仍作为风格派生输入）
visualDirection     视觉方向（结构化，见 A2）
styleReferenceUrl   风格母版图地址（URL 字符串）
styleReferenceError 风格母版图失败原因
assetsReviewed      「资产已通过审核」标记   ┐
storyboardReviewed  「分镜已通过审核」标记   ├ 半自动下一步门禁；会被级联重置为 false
imagesReviewed      「图片已通过审核」标记   ┘
assetGenerationStarted / imageGenerationStarted / videoGenerationStarted
                    三个「批量已启动」标记（防止切页后重复启动）
createdAt/updatedAt 创建与最后修改时间戳
```

### A2 视觉方向 `VisualDirection` 与六维设定 `StyleDetails`

```
name                视觉方向名称
description         一句话简介
revision            版本号（每次修改 +1）
status              draft 草稿 | confirmed 已确认 | stale 已过期
details{6 维}       mediumMaterial 媒介材质 | colorPalette 色彩基调
                    lightingMood 光影氛围 | cameraTexture 镜头质感
                    composition 构图 | emotion 情绪
```

### A3 资产 `Asset`（角色 / 场景 / 主体 / 道具 / 风格共用一套结构）

```
type                类型：character 角色 | scene 场景 | product 核心主体
                    | prop 关键道具 | style 整体风格
source              来源：extracted AI 提取（重提取会被替换） | manual 手动添加（保留）
name                资产名（去重键 = 去空格 + 转小写）
description         一句话简介
prompt              英文生图提示词；style 资产上 = 英文风格提示词 stylePrompt
appearancePrompt    英文外貌提示词（仅角色，与 prompt 同值）
assetNamespace      角色命名空间标记，如 [RabbitGirl]
fullPrompt          角色完整提示词（名称 + 外貌）
details             结构化设定（角色 8 项 / 场景 9 项 / 主体 11 项 / 道具 11 项）
imageUrl            已生成的参考图地址（角色 = 定妆照）
avatarUrl           手动上传的头像地址（imageUrl 缺失时兜底）
multiViewUrl        多视角矩阵图地址（当前链路未使用）
error               该资产生图失败原因
derivation          派生元数据 {locked 已锁定禁止自动覆盖, dirty 需重新派生}
renderRevision      输入版本号（异步写回用它丢弃过期结果）
```

### A4 分镜 `Shot` 与对白 `DialogueLine`

```
id / index          镜头标识 / 序号（0 起）
status              idle 空 | scripting 文案生成中 | scripted 文案已就绪
                    | imaging 出图中 | imaged 图已就绪 | videoing 出视频中
                    | videoed 视频已就绪 | failed 失败
scriptText          镜头文案（中文叙事文本）
visualPrompt        画面提示词（英文，喂给生图，SSOT）
motionPrompt        动态提示词（英文，喂给视频，SSOT）
画面 4 子字段        sceneDesc 场景 | detailDesc 细节服饰 | lightingDesc 光影
                    | styleDesc 画风              （供人审/编辑，反写 visualPrompt）
动态 4 子字段        actionDesc 动作 | cameraDesc 运镜 | envChangeDesc 环境变化
                    | motionSpeedDesc 运动速度     （反写 motionPrompt）
duration            镜头时长（秒；规范化后只可能是 4 / 5 / 8）
dialogues[]         对白行：id 对白标识 | characterId 说话角色（null = 旁白）
                    | text 台词 | delivery 演绎方式（预留 TTS）
activeCharacterIds  本镜出场角色 ID 列表
activeSceneId       本镜主场景 ID
activeProductIds    本镜涉及主体 ID 列表
activePropIds       本镜涉及道具 ID 列表
imageUrl            本镜画面图地址（= 视频首帧）
videoUrl            本镜视频地址
videoProgress       本镜视频生成进度 0..100
videoRetryCount     本镜视频重试次数
useDualFrame        首尾帧开关（勾选后视频带 last_frame）
lastFrameUrl        尾帧地址（可点选其他镜头图，也可手输 URL）
firstFrameUrl       首帧地址 —— **无消费者的死字段**，首帧实际用 imageUrl
error               本镜失败原因
renderRevision      输入版本号
```

### A5 服务层参数名

```
apiKey              接口密钥        baseUrl   接口地址（默认 https://api.agnes-ai.cn/v1）
plan                套餐档位        pid       项目 ID（异步开始前捕获，写回只认它）
prompt              提交给模型的文本/画面描述
sizeTier            图片尺寸档位（1K/2K/3K/4K）  cost  本次计费量（文本 1、图片 1、视频=秒数）
extra_body.image    参考图数组（放请求体顶层会被服务端 403 拒绝）
seed                随机种子（合法域 -1..999，同 seed 同 prompt 结果一致）
mode                视频模式：keyframe 关键帧 | text 纯文本
aspect_ratio        视频画幅       seconds   视频时长（字符串，4..12）
first_frame/last_frame  视频首帧/尾帧地址
video_id            服务端视频任务号（兼容 task_id / id 字段）
model_name          轮询必带的模型名
expectedRevision    发起时记录的输入版本号
stillRunning        服务端任务是否仍在运行（决定要不要重建任务）
```

---

## 图例

```
[UI]     界面组件         [编排]  useXxxActions（动作编排）
[srv]    services/* 服务层 [lib]  纯函数（拼装/解析）    [store] Zustand 状态写回
in:      吃进的参数        out:   吐出的结果            req:   真正发出的 HTTP 请求体
槽位:    rateLimiter.acquire 占用（= 消耗多少用量限额）
-->      顺序             <|>    互斥分支              !!     会中断整条链
补充：图 1 用 `+== 链A / 链B ==+` 围出的两块表示**两条链并行**，其中的行首 `!` 只是续行缩进符，
      不代表中断；真正的中断标记是行首的 `!!`。
```

---

## 图 0　全链路总览：一份想法如何变成 MP4

```
 ideaPrompt(想法原文)
    |
    v  步骤1 提取
 +----------------------+     +----------------------------+
 | visualDirection      |     | assets[](资产表)            |
 |  (视觉方向)           |     |  角色/场景/主体/道具/风格     |
 |  name 名称           |     |  name 名称                  |
 |  description 简介    |     |  description 简介           |
 |  details{6 维设定}    |     |  prompt(英文生图提示词)      |
 +----------+-----------+     +--------------+-------------+
            |                                |
            | stylePrompt(英文风格提示词)      | imageUrl(参考图地址)
            |  <- 派生 + 越界审计              |
            v                                v
      styleReferenceUrl(风格母版图地址)   assets[].imageUrl
            |                                |
            +----------------+---------------+
                             v  步骤3 分镜（先大纲 -> 再逐镜头）
                   shots[](分镜表)：scriptText 镜头文案
                             visualPrompt 画面提示词 / motionPrompt 动态提示词
                             8 个结构化子字段 / dialogues 对白 / active*Ids 引用
                             |
              +--------------+---------------+
              v  步骤4 图片                    v（依赖 imageUrl）
      shots[].imageUrl(镜头画面图)  吃 visualPrompt + 角色/主体/道具参考图
              |
              v  步骤5 视频（吃 motionPrompt + imageUrl 作首帧）
      shots[].videoUrl(镜头视频地址)
              |
              v  步骤6 本地拼接（零 AI 调用）
      blob objectURL(浏览器临时播放地址) -> 下载 <title 项目名>.mp4
```

关键：`assets[].imageUrl` 与 `shots[].imageUrl` 都是**模型返回的远端 URL 字符串**，项目里不存在任何 base64/二进制；只有成片是本地 blob。

---

## 图 1　步骤 1：想法 → 两链并行提取

> 导读：本图是**执行时序版**（守卫、重试、槽位、写回顺序）。想知道"一句想法被拆成什么、每样东西有哪些字段、提示词原文长什么样、之后在哪里被引用"，看 `docs/idea-breakdown.md`。

```
[UI] StepIdea.tsx:87 handleGenerate()
  in : prompt(想法原文, str)（textarea 本地态，500ms 防抖写回 ideaPrompt）
       selectedAspectRatio(所选画幅): "16:9" 横 | "9:16" 竖 | "1:1" 方
  门禁: 输入框/按钮/Enter 都看 generating = 本地 isGenerating || project.status=="scripting" (:45)
       底部「下一步」同样被 status=="scripting" 挡住（CreationWizard.tsx:47）
  act: 无项目 -> createProject(title 项目名 = prompt 前 30 字)
                     updateProject({ideaPrompt, aspectRatio})
  |
  v
[编排] useScriptActions.extractCharactersFromIdea(prompt)          :142
  in : prompt(想法原文, str)
  !! : apiKey(密钥)/baseUrl(接口地址) 缺失 -> throw "API key is not configured."
  out: Promise<boolean>   false = 用户在替换确认弹窗点了取消 -> 界面留在步骤 1
       （切页不由 onGenerated 负责，CreationWizard.tsx:89 传的是无 props 的 <StepIdea/>）
  |
  |-- 守卫 :172  activeIdeaTasks(想法提取注册表) 命中该 projectId -> return true（不抛错）
  |              紧接同步 set 登记 AbortController；守卫与登记之间不得有 await
  |              （2026-09-22 前无任何守卫：提取中切页再返回重点提取 -> 并发两轮、资产重复）
  |
  |-- [store] :178  assets = 只留 source(来源)=="manual"(手动)
  |                 styleReferenceUrl / styleReferenceError = undefined
  |                 assetsReviewed(资产已审核)=false   status="scripting 出脚本中"
  |
  |-- baseOpts = {apiKey 密钥, baseUrl 接口地址, prompt 想法原文,
  |               language 界面语言, aspectRatio 画幅, assets 资产表}       :190
  |
  +== 链A 视觉方向 =========================================================+
  !  [srv] scriptService.extractVisualDirectionFromIdea(baseOpts)   :759
  !        req: POST {baseUrl}/chat/completions   槽位: text 文本 x1
  !            {model:"agnes-3.0-flash",
  !             messages:[system(骨架 visualDirection), user(baseOpts 摘要)],
  !             temperature 温度, top_p?, max_tokens:65536,
  !             chat_template_kwargs:{enable_thinking 思考开关}}
  !        out: RawVisualDirection(模型原始视觉方向)
  !             {name 名称, description 简介, details 六维设定}
  !  [lib] refineWithAudit(produce 产出, audit 审计, maxRounds 轮数=1)  :202
  !        in : current 当前版:RawVisualDirection
  !            forbiddenSubjects(禁止清单) = collectSubjectVocabulary(project)
  !                                          <- 本项目自身的资产名列表
  !        [srv] auditVisualDirection(...)              槽位: purpose=visualDirectionAudit
  !             out: AuditOutcome{clean 是否干净:bool, value 采用版:RawVisualDirection}
  !             审计自身抛错 -> 保留原文并结束（不阻塞主链）
  !  [store] :222  visualDirection{revision 版本号 +1, status:"draft 草稿"}
  !                wizardStep=2   <== 切页就发生在这里
  !                注意：**不再复位 project.status**（提取全程保持 "scripting"，见下方收尾）
  +==========================================================================+
  +== 链B 资产（4 路并发 Promise.all）=======================================+
  !  for type(类型) in [character 角色, scene 场景, product 主体, prop 道具]:
  !    [srv] extractAssetsByType(baseOpts, type)              :796
  !          req: POST /chat/completions   purpose=assetExtraction 资产提取
  !          out: {characters[]角色, scenes[]场景, products[]主体,
  !               props[]道具, styles[]风格}
  !               类型过滤兜底(:924-930)：只留本次 type 的数组，其余恒 []
  !               styles 需 type=="style" 才有值（内部只取第 1 条）
  !               当前向导只请求 4 类 => styles 恒 []（风格归链A）
  !          !! 目标类数组为空 -> throw error.assetsParseFailed(解析失败)
  !    [lib] extractNewAssets(existing 现有资产, list 模型返回, type,
  !                           dedupeAgainst=手动资产)
  !          去重键 = name(名称).trim().toLocaleLowerCase()
  !          角色额外生成 appearancePrompt(英文外貌提示词)/assetNamespace(命名空间)
  !                  /fullPrompt(完整提示词)
  !          out: {assets:Asset[], idByName 名称->ID 映射}
  !    [store] :252  assets = [...旧, ...新增]   <== 每类完成立刻写回（卡片逐类出现）
  !          写回基准 = 函数入口捕获的 project.assets 快照（两轮并发会各自基于旧快照追加 -> 重复入库）
  !  单类失败只记录进 failures；added==0 且全部失败才 throw            :261
  +==========================================================================+
  |
  v
Promise.allSettled([链A, 链B])                                      :269
  任一 rejected -> [store] status="failed 失败" + error -> throw 给 [UI] 上屏
  全部 fulfilled -> [store] :285 status="idle 空闲"   <== 步骤 1 门禁到此才放开
        finally :302  activeIdeaTasks.delete(pid)  (注销单飞守卫)
        后台异步（不等、不阻塞界面）：
        await generateStyleReference(pid 项目ID)          -> 见 图2
        await generateAssetImages(undefined, pid)         -> 见 图3
```

---

## 图 2　风格母版链（步骤 1 尾部后台触发，界面在步骤 2）

```
[编排] useAssetActions.generateStyleReference(pid? 项目ID, force 强制=false)  :172
  in : force(强制重生成 bool)（手动点「重新生成风格图」时传 true）
  守卫: 无密钥 -> return | 已有风格母版图且 !force -> return | 该项目有资产任务在跑 -> return
  out: void —— 错误只写 project.styleReferenceError(风格图失败原因)，**不 throw**
  |
  +-- [store] 没有 style(风格) 资产则懒建 :194
  |      Asset{type:"style", source:"extracted AI 提取", name:"整体风格",
  |            description=project.style(中文风格描述), prompt(英文风格提示词)=""}
  |
  +-- 派生条件：(force || prompt 为空) && (未被 derivation.locked 锁定 || force)   :212
  |     [srv] deriveStylePrompt(zhStyle 中文风格, apiKey, baseUrl, visualDirection)  :63
  |        in : **只有** 中文风格描述 + visualDirection.details(六维设定)
  |             （刻意不含想法原文/故事主体，避免把角色画进母版）
  |        req: POST /chat/completions   purpose=styleRef   槽位: text
  |        out: stylePrompt(英文风格提示词, str)
  |             失败或空 -> fallbackStylePrompt(兜底句：有中文风格则模板化，否则 cinematic)
  |     [srv] auditStylePrompt({stylePrompt, subjects 禁止清单, apiKey, baseUrl})  :122
  |        req: POST /chat/completions   purpose=stylePromptAudit（思考恒关闭）
  |        out: {clean 是否干净:bool, rewritten 重写后:str}      轮数上限 1
  |     [store] updateAssetByProjectIdIfRevision(pid, 风格资产ID, revision 版本号,
  |                                               {prompt=审计后文本})
  |             返回 false（期间用户改过）-> 整条链直接 return，结果丢弃
  |
  +-- [srv] imageService.generateImage({apiKey, baseUrl, prompt, size, ratio})   :258
         prompt = composeStyleReferencePrompt(stylePrompt)
                   // 把风格词包装成"抽象样张"：材质纹理色板 / 色彩色卡 /
                   // 光影与渐变研究 / 笔触样本；并显式声明不含角色、动物、
                   // 人物、产品、场景与叙事情节
         {size 档位, ratio 画幅} = aspectRatioToImageParams(project.aspectRatio)
                                    -> 恒定 size:"1K"，ratio 白名单外回落 "1:1"
         out: url(图片地址, str)
         [store] asset.imageUrl = url   然后 project.styleReferenceUrl = url
```

---

## 图 3　步骤 2：资产参考图批量

```
[编排] generateAssetImages(opts 开关组?, projectIdOverride 指定项目?)   :290
  opts: {generatePortraits 出角色图, generateScenes 出场景图,
         generateProducts 出主体图, generateProps 出道具图,
         generateStyle 出风格图}
        判定写法是 "!== false" -> 不传即全部为 true
  阶段1  generateStyle && 还没有风格母版图
            -> await generateStyleReference(pid)   （失败不阻塞，退化为纯文生图）
  阶段2  createBatchRunner{registry:activeAssetTasks 在跑任务表}.run({pid, concurrency 并发=3})
  |
  +-- buildTasks 读最新 store，先算一次 stylePrompt(英文风格提示词)
  |   ⚠ 风格只以**文本**注入提示词，不作为图生图的参考图（2026-09-15 事故决策）
  |
  +-- 角色 且 无 imageUrl：
  |     prompt = composePortraitPrompt({appearancePrompt 英文外貌提示词 || prompt,
  |                                     stylePrompt 风格提示词})
  |            -> 内含物种锁定句 + 解剖约束，无人像语汇
  +-- 场景|主体|道具 且 无 imageUrl：
  |     prompt = composeTextToImagePrompt({subject: assetImageBoundary(主体边界句)
  |                                              + " " + asset.prompt,
  |                                        style: stylePrompt})
  |     ⚠ 批量只按「无 imageUrl」过滤，**不检查 prompt 是否为空**
  |        （手动「补全缺失资产」才在 StepAssets.tsx:204-208 额外要求 prompt 非空）
  |
  +-- [srv] generateImage(...)  -> 请求体见 图5 同一段
  +-- [store] 成功 updateAssetByProjectIdIfRevision({imageUrl:url, error:undefined})
              失败 updateAssetByProjectIdIfRevision({error:失败原因})
              两条都走 applyAssetUpdate -> 见 图9 级联（会清镜头产物 + 重置 3 个审核标记）
  标记: onBeforeRun 置 assetGenerationStarted=true / onFinally 置 false
```

---

## 图 4　步骤 3：分镜（大纲 → 占位 → 逐镜头）

```
[编排] generateStoryboard(prompt 想法原文, {onProgress 进度回调})      :312
  in : prompt = project.ideaPrompt.trim()
  守卫: hasActiveTask(activeScriptTasks, pid) -> **静默 return（不抛错、也不等）**
  [store] resetStuckShots(pid) 把残留 status="scripting" 复位为 idle      :330
  |
  1) [srv] generateStoryboardOutline(大纲请求)
      in : {apiKey, baseUrl, prompt 想法原文, language 界面语言,
            aspectRatio 画幅, assets 资产表}
      req: POST /chat/completions   purpose=storyboardOutline   槽位: text x1
      out: {shots:[{title 镜头标题, summary 镜头梗概,
                    characterNames[出场角色名], sceneName? 场景名}],
            newCharacters[] 新角色, newScenes[] 新场景}
      !! 拿不到非空 shots 数组 -> throw error.shotsInvalid（**这一步没有重试**）
  2) [store] assets += extractNewAssets(现有, newCharacters, "character", 手动资产)
                                  + extractNewAssets(现有, newScenes, "scene", 手动资产)
  3) [store] setShotsByProjectId(pid, N x Shot{status:"scripting",
                     scriptText:"", visualPrompt:"", motionPrompt:"",
                     duration 时长:5, dialogues:[], active*Ids:[]})   <== 卡片全部亮起
  4) runWithConcurrency(N 个任务, SHOT_CONCURRENCY 并发=3)             :417
       |
       +-- [srv] generateStoryboardShot(单镜头)
       |      in : {apiKey, baseUrl, prompt 想法原文, language, aspectRatio, assets,
       |            outline 大纲全文:JSON.stringify(outline.shots),
       |            item 本镜头计划, index 序号, total 总数}
       |      req: POST /chat/completions  purpose=storyboard / 骨架 storyboardShot
       |      out: RawShot(模型原始镜头数据)
       |           -> normalizeRawShot 规范化：duration 只接受 {4,5,8} 否则回落 5
       |      内部重试 attempt<=2（最多 3 次尝试，无退避等待）
       |      !! visualPrompt 或 motionPrompt 为空 = 该次尝试判失败并重试
       +-- [lib] buildShotUpdate(raw, latestAssets 最新资产表)          :72
                 in : RawShot + Asset[]
                 引用解析: resolveAssetId/resolveAssetIds —— 先按 ID，再按名称匹配
                 out: Partial<Shot>{
                   scriptText 镜头文案, visualPrompt 画面提示词, motionPrompt 动态提示词,
                   duration 时长, firstFrameUrl 首帧(死字段),
                   sceneDesc 场景, detailDesc 细节, lightingDesc 光影, styleDesc 画风,
                   actionDesc 动作, cameraDesc 运镜, envChangeDesc 环境变化,
                   motionSpeedDesc 运动速度,
                   activeSceneId 主场景, activeProductIds 主体, activePropIds 道具,
                   activeCharacterIds 出场角色,
                   dialogues 对白:[{id:"dlg_时间戳_随机", characterId 说话角色(str|null
                     空=旁白), text 台词, delivery 演绎方式}]}
                 引用没匹配上只降级为 null/[]，**绝不抛错**（否则镜头内容会整条丢）
       +-- [store] updateShotByProjectId(pid, 镜头ID, {..., status:"scripted 文案就绪"})
                   单镜头异常 -> {status:"failed 失败", error 原因}，其他镜头不受影响
       +-- finally: completed 完成数++ -> onProgress(completed, total)
                     <== StepAssets 收到首个回调就 setWizardStep(3) 切页
  5) [store] setProjectStatusById(pid, "idle 空闲")
     大纲阶段异常 -> resetStuckShots + status="failed" + throw              :420
```

单镜头改写走同一套出参：`reviseShot` -> `reviseShotWithInstruction({shot 当前镜头, instruction 用户一句话要求, assets, language, aspectRatio})`（purpose=shotEdit，<=3 次）-> 同一个 `buildShotUpdate` 写回。`rerollShot` 复用阶段 2 的单请求并额外带 `variationOf{scriptText, visualPrompt}`（要求出不同版本）。

---

## 图 5　步骤 4：镜头图片（提示词组装分支 + 真实请求体）

```
[编排] runImageBatch({projectId, concurrency 并发=3})                :111
  recoverStuck 恢复: status=="imaging 出图中" -> {status:"scripted", error:undefined}
  筛选待生成: 无 imageUrl && status!="imaging" && visualPrompt(画面提示词) 非空
  |
  +-- [lib] buildImageGenerationInput(shot, project, rules 规则文本)  :73
  |      refs(参考图地址列表) = pickShotReferences(shot, project)
  |        in : shot.activeCharacterIds 出场角色 / activeProductIds 主体
  |            / activePropIds 道具
  |        out: [url]  角色定妆照 -> 主体图 -> 道具图，按 URL 去重，上限 4
  |             ⚠ 场景图与风格母版**都不进参考图**（会被整体复制进结果）
  |      subject(画面主体) = composeVisualPrompt(shot) -> 就是 shot.visualPrompt
  |      style(风格) = getStylePrompt(project) -> 风格资产的 prompt(英文风格提示词)
  |      rules = {composeShot 拼装规则, negativeStrategy 负向策略} 取注册表生效文本(英文)
  |      <|> 有参考图（refs.length > 0）
  |      |     prompt = composeMultiReferencePrompt({
  |      |               references:[{index 第几张, role 该图角色=资产类型, note 资产名}],
  |      |               scene 画面主体, style 风格, rules})
  |      |     referenceImageUrls = refs
  |      <|> 无参考图
  |            prompt = composeTextToImagePrompt({subject, style||project.style,
  |                     quality:"high quality, 8k", rules})   // 六段式
  |            referenceImageUrls 不传
  |
  +-- [srv] imageService.generateImage({apiKey, baseUrl, prompt,
  |                                    size 档位:"1K", ratio 画幅, referenceImageUrls?})
  |          -> 透传给 ai/openai.generateImage
  |
  +-- [srv] OpenAIService.generateImage                     openai.ts:169
             槽位: acquire("image", {sizeTier 尺寸档位: imageSizeToTier("1K")})
             url  : POST {baseUrl}/images/generations   (fetchWithRetry 最多 4 次 x 60s)
             body : {model:"agnes-image-2.5-flash",
                     prompt(画面描述),
                     size:"1K",                     // 档位串，不是像素值
                     ratio(画幅):"16:9"|...|白名单外 "1:1",
                     extra_body:{response_format:"url",
                                 image?:[url...],   // ⚠ 参考图只能放这里，放顶层 -> 403
                                 seed?:随机种子}}    // 合法域 -1..999
             out  : json.data[0].url -> 无协议则补 "https://" -> 为空 -> throw error.imageApiNoUrl
             特判 : error.code=="content_policy_violation"(内容安全过滤)
                     -> ImageSafetyFilterError
  |
  +-- [store] 发请求前 setShotStatusByProjectId(pid, 镜头ID, "imaging 出图中")
              成功 updateShotByProjectIdIfRevision({imageUrl, status:"imaged 图已就绪"})
              失败 setShotStatusByProjectIdIfRevision("failed", 失败原因)
  onFinally 收尾: 全部有图 -> project.status "idle 空闲"
                  否则 "failed" + **硬编码中文**「图片生成失败 N 个镜头，请重试失败项。」
```

---

## 图 6　步骤 5：镜头视频（创建 + 轮询 + 错误分叉）

```
[编排] generateVideosForStep()
  并发 = 套餐 accessType=="tokenplan" ? 3 : 视频 RPM<=1 ? 1 : 2          :198
  recoverStuck: status=="videoing 出视频中" -> {status:"imaged", videoProgress:0, error:清}
  筛选待生成: 无 videoUrl && 有 imageUrl && status!="videoing"
              && (motionPrompt 动态提示词 或 actionDesc 动作 非空)
  |
  +-- [lib] planShotVideoMedia({shot, shots 全项目镜头, assets, styleReferenceUrl,
  |          consistency = settings.videoConsistency})            lib/videoPlan.ts
  |        先由 planShotContinuity 派生同场景下一镜画面图作尾帧   lib/shotContinuity.ts
  |        优先级：手动双帧 > 同场景自动衔接尾帧 > (identity 时) 参考图 > 仅首帧
  |        out: media = {imageUrl?, lastFrameUrl?, referenceImageUrls?}
  |             ⚠ 互斥：reference 时不带首尾帧（服务端 400「首尾帧素材与参考素材不能同时使用」）
  +-- prompt = appendRegistryRules(composeMotionPrompt(shot) -> shot.motionPrompt,
  |                                {negativeStrategy 负向策略文本})
  +-- [srv] generateVideo(opts, onProgress 进度回调, signal 取消信号)  videoService.ts:125
  |      in : {apiKey, baseUrl, prompt 动态描述, ...media, aspectRatio 画幅, duration 时长(秒)}
  |      槽位: acquire("video", {cost 计费量: duration||1, signal})  <-- HTTP 之前就扣秒数
  |      req1: POST {baseUrl}/videos   (maxRetries 3, baseDelay 退避基数 10s)
  |            {model:"agnes-video-2.5-flash",
  |             prompt: sanitizePrompt(清洗后的动态描述),
  |             mode: "reference" 有参考图 | "keyframe" 有首/尾帧 | "text" 无素材,
  |             size:"720P",                                      // Flash 固定档位
  |             aspect_ratio(画幅): <白名单，否则 "16:9">,
  |             seconds(时长): String(clamp(round(duration),4,12)),  // 只能是 4..12
  |             n:1,
  |             first_frame(首帧)?:imageUrl,   // 仅 keyframe
  |             last_frame(尾帧)?:lastFrameUrl,// 仅 keyframe
  |             images?(身份/画风参考): [定妆照…, 风格母版]}  // 仅 reference，≤5 张
  |            注：first_frame 取 media.imageUrl（= 镜头画面图），与 shot.firstFrameUrl 无关
  |            out: video_id(任务号) ?? task_id ?? id
  |      req2: 循环 GET {origin}/agnesapi?video_id=..&model_name=agnes-video-2.5-flash
  |            间隔 5s / 上限 30 分钟 / task_not_exist|404 容忍 24 轮（等任务注册）
  |            onProgress(pollJson.progress 服务端进度) -> [store] shot.videoProgress
  |            完成判定 status∈{completed, succeeded} 或 internal_status=="completed"
  |      out : {videoUrl 视频地址, coverImageUrl 封面地址, duration 实际时长}
  |            地址取值顺序: url -> metadata.url -> video_url
  |                          -> output.url -> output.video_url -> remixed_from_video_id
  |            ⚠ 上层只用 videoUrl；封面地址与实际时长被丢弃
  +-- [store] 成功 updateShotByProjectIdIfRevision({videoUrl, status:"videoed 视频就绪"})
  |
  错误分叉（决定会不会重复烧钱）:
    VideoTaskCreatedError 且 stillRunning=true  (任务不存在/轮询 HTTP 失败/非 JSON/超时)
        -> 保留服务端任务：videoProgress=0, videoRetryCount=attempt+1, error 文案
        -> **直接结束，不再创建新任务**
    VideoTaskCreatedError 且 stillRunning=false (已完成但无地址 / 服务端 failed|cancelled)
        -> status="failed"
    其他异常 且 attempt < 2 -> 等 8s*(attempt+1) 后重试创建（最多 3 次创建机会）
    其他异常 且 attempt >= 2 -> status="failed"
  onFinally: 全有视频 -> "idle"；全部落定(有视频或失败) -> 复位 started + "failed" + 中文硬编码
```

首尾帧参数来源：`DualFrameToggle` 勾选后写 `shot.useDualFrame(首尾帧开关)` / `shot.lastFrameUrl(尾帧地址)`（可点选其他镜头图，也可**手输 URL**）；只有 `useDualFrame && lastFrameUrl` 同时成立，请求才带 `last_frame`。

---

## 图 7　步骤 6：本地拼接（零 AI 调用）

```
[UI] StepAssembly.handleRender()  :68
  in : videoUrls[] = shots.filter(有 videoUrl).map(s => s.videoUrl)  // 顺序 = 分镜数组顺序
       传给服务层：{videoUrls, onProgress(更新进度条), signal(取消信号)}
  [store] setProjectStatusById(pid, "rendering 拼接中")
  |
  +-- [srv] renderService.concatenateVideos
  |     0 个 -> throw error.noVideoToConcat(没有可拼接的视频)
  |     1 个 -> **完全不过 FFmpeg**：fetch(地址) -> Blob(type:"video/mp4")
  |             -> URL.createObjectURL(浏览器播放地址) -> onProgress(100)
  |     >=2 个 -> FFmpeg.wasm 单例 load（core 0.12.6；DEV 同源代理 -> fastly -> unpkg）
  |               逐个 fetch(视频地址)  120s 超时，与外部 signal 合并
  |                 DEV: cos-platform-outputs.agnes-ai.cn -> /cdn-proxy<path?query>
  |                      （保留 COS 签名；代理失败自动回落直连）
  |               writeFile input{i}.mp4      进度 ((i+1)/(n+1))*50   即 0 -> 50
  |               writeFile concat_list.txt   内容逐行 "file 'input{i}.mp4'"
  |               runConcat(参数 -f concat -safe 0 -i concat_list.txt -c copy)  50 -> 80
  |                 失败 -> deleteFile output.mp4 后改用重编码再跑一次：
  |                          -c:v libx264 -preset ultrafast -crf 23 -c:a aac   50 -> 80
  |               readFile output.mp4 -> Blob -> createObjectURL    85 -> 100
  |               finally: 删除全部虚拟文件（不留内存垃圾）
  out: 浏览器临时播放地址(blobUrl, str)   （只存组件内 state，不写 store）
  [store] 成功 -> "done 完成"；用户取消(controller 已 abort) -> "idle"（**不算失败**）
                  其他异常 -> "failed" + 尾部 20 行 FFmpeg 日志（界面 <pre> 展示）
  取消: handleCancelRender -> renderAbortRef.abort()
        下载阶段 abort fetch；FFmpeg 阶段 ffmpeg.terminate() 且实例缓存置空
  释放: 项目切换 / 组件卸载 -> URL.revokeObjectURL(防止内存泄漏)
```

---

## 图 8　限流器：一次调用的槽位与配额参数流

```
调用方                              rateLimiter.acquire(kind 种类, opts 选项)
  ai/openai.chatCompletion   ->  acquire("text 文本")                 cost 缺省 1
  ai/openai.generateImage    ->  acquire("image 图片", {sizeTier 档位})  cost 缺省 1
  videoService.generateVideo ->  acquire("video 视频", {cost=秒数, signal})
        |
        v
  plan(套餐) = resolvePlan(settingsStore.providerConfig.plan)
               <== 服务层里唯一直接读 store 的地方
  chain[kind] 串行排队（同一种类的等待按到达顺序）
        |
        v  guard()                                        rateLimit.ts:128
  1 throttleRpm 节流   key = 图片 ? "img:"+(档位??1K) : 种类
                       log = 60 秒窗口内的时间戳数组
                       log.length >= rpmFor(套餐, 种类, 档位)   即已达 RPM 上限
                         -> sleep(睡到最早一条滑出窗口 + 50ms, signal) 后重新判定
  2 checkQuota 配额    仅 accessType=="tokenplan"(订阅套餐)
                       bucket 桶 = "tokenplan:<套餐>:<种类>:<5h|week|day>"
                       已用量 + cost > limit 额度
                         -> !! RateLimitError{reason:"quota 超额",
                                              resetMs 多久后重置(>=1000), plan 套餐}
  3 recordRpm + recordQuota 记账   <== **记账发生在发请求之前，请求失败不回滚**
        |
        v
  localStorage["wxhb-usage"] 持久化计数   |  取消 -> RateLimitError{reason:"aborted 已取消"}
                                             ⚠ 该错误的 kind 字段恒为 "text"（:86,95）
文本元调用也各占一槽：resolveGenerationParams(参数决策) 内部又走一次 chatCompletion
（缓存键 = purpose 用途:cacheKey；assetExtraction 按资产类型分键，2026-09-22；
 同键并发单飞只问一次 -> 每个用途每个键每会话只多 1 次）
```

---

## 图 9　写回参数如何作废下游产物（版本号与级联）

```
谁写                     写什么字段                         写完之后发生什么
-----------------------------------------------------------------------------------------------
步骤4 图片批量    shot.imageUrl 画面图 + status   ->  videoUrl/videoProgress/videoRetryCount
                                                    (视频/进度/重试次数) 全清空
                                                    renderRevision 输入版本号 +1
步骤5 视频批量    shot.videoUrl 视频 + status     ->  videoProgress/videoRetryCount 清空  版本 +1
步骤4/5 子字段    sceneDesc 场景 / detailDesc 细节 /       ->  命中「画面字段」：图 + 视频全清
                  lightingDesc 光影 / styleDesc 画风         status = 有 scriptText ? scripted : idle
                  / scriptText 文案 / visualPrompt 画面词     版本 +1
                  / activeCharacterIds 角色 / activeSceneId
                  / activeProductIds / activePropIds
步骤5 时长/尾帧   motionPrompt 动态词 / duration 时长 /    ->  命中「动态字段」：只清视频
                  useDualFrame 首尾帧开关 /                   status = 有图 ? imaged
                  firstFrameUrl / lastFrameUrl 尾帧 等              : (有文案 ? scripted : idle)
                                                             版本 +1
-----------------------------------------------------------------------------------------------
步骤2 资产生图    asset.imageUrl 参考图           ->  !! applyAssetUpdate 认定为「渲染字段变化」
  （含生成器自己写回）                                    assetsReviewed 资产审核 /
                                                         imagesReviewed 图片审核 /
                                                         storyboardReviewed 分镜审核
                                                         **三个标记全部 = false**（门禁重新锁上）
                                                       + 引用该资产的镜头图/视频全清 版本 +1
                                                       + 风格资产 => 命中**全部**镜头
步骤2 改设定      asset.name 名称 / description 简介 /    ->  同上（值真的变了才算）
                  prompt / appearancePrompt / 参考图地址 /
                  avatarUrl 头像 / multiViewUrl / type
步骤2 视觉方向    updateVisualDirection           ->  清 styleReferenceUrl 风格母版
                                                        + **所有资产 imageUrl 清空**
                                                        + 风格资产 prompt="" 且 dirty=true
                                                        + assetsReviewed=false，revision +1
                                                        ⚠ 不动 shots，镜头图仍是旧的
步骤2 删除资产    removeAsset                     ->  三个审核标记 = false + 引用剔除
                                                        （对白归旁白）
                                                        ⚠ **不清 shot.imageUrl/videoUrl**
                                                        （与代码注释声称的失效行为不一致）
-----------------------------------------------------------------------------------------------
过期结果丢弃：任务开始时记 expectedRevision(期望版本号)，写回用 *IfRevision 版本守卫
              期间用户改过输入 => 版本号已变 => 写回返回 false，新结果静默丢弃
```

---

## 图 10　跨步骤字段契约（谁产生 → 谁消费）

```
字段（中文含义）              产生者                        消费者
------------------------------------------------------------------------------------
ideaPrompt 想法原文           步骤1 输入框防抖写回           视觉方向/资产提取/大纲/逐镜头的请求文本
                                                            步骤2 enterStoryboard 用它判空
aspectRatio 画幅比例          步骤1 画幅按钮                 aspectRatioToImageParams -> 图片 size/ratio
                                                            aspectRatioToVideoAspect -> 视频 aspect_ratio
                                                            文本请求里的画幅上下文
visualDirection 视觉方向      链A 写回 / 步骤2 编辑器保存     deriveStylePrompt 的六维输入
style 中文风格描述            旧字段 / 提取兜底              deriveStylePrompt / 兜底句
assets[style].prompt          deriveStylePrompt + 越界审计    getStylePrompt -> 资产图与分镜图的
  英文风格提示词                                              风格文本注入（不再作参考图）
styleReferenceUrl 风格母版    generateStyleReference 写回    「是否已有风格图」幂等判定
                                                            （图2 / 图3 阶段1）
                                                            步骤2 视觉方向卡缩略图展示
                                                            ⚠ 不再进入任何参考图列表
assets[x].imageUrl 参考图地址  图2 / 图3 写回                pickShotReferences（角色 -> 主体 -> 道具）
                                                                -> 请求体 extra_body.image
                                                            角色编辑器定妆照预览
shot.visualPrompt 画面提示词   generateStoryboardShot        composeVisualPrompt -> 生图 prompt 主体
                                                                （buildImageGenerationInput）
shot.motionPrompt 动态提示词   同上                          composeMotionPrompt -> 视频 prompt
shot.画面4/动态4 子字段        同上                          步骤4/5 PromptSubFields 编辑
                                                                -> rewritePromptFromFields 反写整段
                                                                并触发 图9 的作废级联
shot.imageUrl 镜头画面图       图5                           generateVideo 的 first_frame 首帧
                                                            步骤5 预览 + 尾帧候选列表
shot.firstFrameUrl 首帧地址    仅被 normalizeRawShot/         **无消费者（死字段）**
                              pickShotFields 搬运             首帧实际用 shot.imageUrl
shot.lastFrameUrl 尾帧地址     DualFrameToggle（点选/手输）    generateVideo 的 last_frame 尾帧
shot.videoUrl 镜头视频地址     图6                           concatenateVideos 的 videoUrls + 预览
shot.status 镜头状态           各批量与恢复逻辑               批量筛选条件 / recoverStuck / 按钮禁用
assetsReviewed 资产已审核      步骤2 审核按钮                 底部「下一步」门禁 2 -> 3
storyboardReviewed 分镜已审核  步骤3 审核按钮                 门禁 3 -> 4
imagesReviewed 图片已审核      步骤4 ReviewCheckpoint 确认     门禁 4 -> 5
    （三个标记都会被 图9 的资产级联重置为 false）
automationMode 自动化模式      顶栏「全自动/半自动」开关        各步骤自动推进 effect + canAdvance 放行
                                                          分镜/图片/资产步骤的门禁豁免
```

---

## 审这份图时最该盯的四条

1. `assets[].imageUrl`(资产参考图) 一次写回 => 三个审核门禁 + 引用它的镜头图视频一起没（图9 中段）。
2. `referenceImageUrls`(参考图列表) 只在**分镜图**链路出现；资产图与风格图全是文生图（图2 / 图3 / 图5）。
3. `duration`(时长) 被规范化两次：`normalizeRawShot` 只允许 {4,5,8}，`videoService` 再 clamp 到 4..12（图4 / 图6）。
4. 视频槽位在创建前就按秒扣，且非幂等 POST 仍会自动重试（图6 / 图8）。
