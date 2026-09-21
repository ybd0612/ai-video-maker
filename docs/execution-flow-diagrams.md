# 执行流程 ASCII 数据流图集（源码快照 2026-09-21）

配套文字版：`docs/execution-flow.md`。本图集只讲一件事：**每个环节吃什么参数、吐什么参数、往 store 写什么**。用于逐行审计。

## 图例

```
[UI]     步骤组件        [编排]  useXxxActions      [store]  Zustand 写回
[srv]    services/*      [lib]   纯函数拼装/解析
in:      入参            out:     返回值/产出
req:     实际发出去的 HTTP 请求体  槽位: rateLimiter.acquire 占用
-->      顺序            <|>      互斥分支          !!       会中断整条链
"pid"    = targetProjectId（异步开始前捕获，所有写回只认它）
```

---

## 图 0　全链路总览：一份想法如何变成 MP4

```
 ideaPrompt (str)
    |
    v  Step1 提取
 +----------------------+     +----------------------------+
 | visualDirection      |     | assets[] (character/scene/  |
 |  name description    |     |  product/prop/style)        |
 |  details{6 维}       |     |  .name .description .prompt |
 +----------+-----------+     +--------------+-------------+
            |                                |
            | stylePrompt(英文) <- 派生+审计  | 参考图 URL
            v                                v
      styleReferenceUrl (str)          assets[].imageUrl (str)
            |                                |
            +----------------+---------------+
                             v  Step3 分镜（大纲 -> 逐镜头）
                   shots[]: scriptText / visualPrompt / motionPrompt
                             8 个结构化子字段 / dialogues / active*Ids
                             |
              +--------------+---------------+
              v  Step4 图片                    v (依赖 imageUrl)
      shots[].imageUrl  (吃 visualPrompt + 角色/产品/道具参考图)
              |
              v  Step5 视频（吃 motionPrompt + imageUrl 作首帧）
      shots[].videoUrl
              |
              v  Step6 本地拼接（零 AI 调用）
      blob:objectURL -> 下载 <title>.mp4
```

关键：`assets[].imageUrl` 与 `shots[].imageUrl` 都是**远端 URL 字符串**，项目里不存在任何 base64/二进制；只有成片是本地 blob。

---

## 图 1　步骤 1：想法 → 两链并行提取

```
[UI] StepIdea.tsx:83 handleGenerate()
  in : prompt:str（textarea 本地态，500ms 防抖写 project.ideaPrompt）
       selectedAspectRatio: "16:9"|"9:16"|"1:1"
  act: 无项目 -> createProject(title = prompt.slice(0,30))
                     updateProject({ideaPrompt, aspectRatio})
  |
  v
[编排] useScriptActions.extractCharactersFromIdea(prompt)          :128
  in : prompt:str
  !! : apiKey/baseUrl 缺失 -> throw "API key is not configured."
  out: Promise<boolean>   false = 用户在替换确认弹窗取消 -> StepIdea 不推进
       （切页不由 onGenerated 负责，CreationWizard.tsx:73 传的是无 props 的 <StepIdea/>）
  |
  |-- [store] :159  assets = 只留 source=="manual"
  |                 styleReferenceUrl/styleReferenceError = undefined
  |                 assetsReviewed=false   status="scripting"
  |
  |-- baseOpts = {apiKey, baseUrl, prompt, language, aspectRatio, assets}   :171
  |
  +== 链A 视觉方向 =========================================================+
  !  [srv] scriptService.extractVisualDirectionFromIdea(baseOpts)   :759
  !        req: POST {baseUrl}/chat/completions   槽位: text x1
  !            {model:"agnes-3.0-flash", messages:[system(骨架 visualDirection), user],
  !             temperature, top_p?, max_tokens:65536,
  !             chat_template_kwargs:{enable_thinking}}
  !        out: RawVisualDirection {name, description, details{6}}
  !  [lib] refineWithAudit(produce, audit, maxRounds=1)             :183
  !        in : current:RawVisualDirection
  !            forbiddenSubjects = collectSubjectVocabulary(project)  <- 项目资产名
  !        [srv] auditVisualDirection(...)                  purpose=visualDirectionAudit
  !             out: AuditOutcome{clean:bool, value:RawVisualDirection}
  !             审计抛错 -> 保留原文并结束（不阻塞）
  !  [store] :203  visualDirection{revision+1, status:"draft"}
  !                 status="idle"   wizardStep=2      <== 切页就发生在这里
  +==========================================================================+
  +== 链B 资产（4 路并发 Promise.all）=======================================+
  !  for type in [character, scene, product, prop]:
  !    [srv] extractAssetsByType(baseOpts, type)              :796  purpose=assetExtraction
  !          out: {characters[], scenes[], products[], props[], styles[]}
  !               类型过滤兜底(:924-930)：只留本次 type 的数组，其余恒 []
  !               styles 需 type=="style" 才有值（内部 slice(0,1)）
  !               当前向导只请求 4 类 => styles 恒 []（风格归链A）
  !          !! 目标类数组为空 -> throw error.assetsParseFailed
  !    [lib] extractNewAssets(existing, list, type, dedupeAgainst=manual)
  !          去重键 = name.trim().toLocaleLowerCase()
  !          character 额外生成 appearancePrompt/assetNamespace/fullPrompt
  !          out: {assets:Asset[], idByName:Map}
  !    [store] :234  assets = [...p.assets, ...新增]   <== 每类完成立刻写回
  !  单类失败只记录，added==0 且全部失败才 throw                     :243
  +==========================================================================+
  |
  v
Promise.allSettled([链A, 链B])                                      :251
  任一 rejected -> [store] status="failed"+error -> throw 给 [UI] 上屏
  全部 fulfilled -> fire-and-forget:
        await generateStyleReference(pid)   ->  见 图2
        await generateAssetImages(undefined, pid) ->  见 图3
```

---

## 图 2　风格母版链（步骤 1 尾部后台触发，界面在步骤 2）

```
[编排] useAssetActions.generateStyleReference(pid?, force=false)    :172
  in : force:boolean（手动「重新生成风格图」传 true）
  守卫: 无 key -> return | 已有风格图且 !force -> return | hasActiveTask -> return
  out: void —— 错误只写 project.styleReferenceError，**不 throw**
  |
  +-- [store] 无 style 资产则懒建 :194
  |      Asset{type:"style", source:"extracted", name:"整体风格",
  |            description:project.style, prompt:""}
  |
  +-- 派生条件 (force || prompt=="") && (!derivation.locked || force)  :212
  |     [srv] deriveStylePrompt(zhStyle, apiKey, baseUrl, visualDirection)  :63
  |        in : **只有** 中文风格描述 + visualDirection.details{6}
  |             （刻意不含 ideaPrompt/故事主体）
  |        req: POST /chat/completions   purpose=styleRef  槽位: text
  |        out: stylePrompt:str(英文)   失败/空 -> fallbackStylePrompt(project.style)
  |     [srv] auditStylePrompt({stylePrompt, subjects, apiKey, baseUrl})   :122
  |        req: POST /chat/completions   purpose=stylePromptAudit
  |        out: {clean:bool, rewritten?:str}    轮数上限 1
  |     [store] updateAssetByProjectIdIfRevision(pid, styleId, rev, {prompt})
  |             返回 false -> 整条链直接 return（结果已过期）
  |
  +-- [srv] imageService.generateImage({apiKey,baseUrl,prompt,size,ratio})  :258
         prompt = composeStyleReferencePrompt(stylePrompt)
         {size,ratio} = aspectRatioToImageParams(project.aspectRatio) -> {size:"1K", ratio}
         out: url:str
         [store] asset.imageUrl = url   然后 project.styleReferenceUrl = url
```

---

## 图 3　步骤 2：资产参考图批量

```
[编排] generateAssetImages(opts?, projectIdOverride?)               :290
  opts: {generatePortraits, generateScenes, generateProducts, generateProps, generateStyle}
        判定写法是 "!== false" -> 不传即全 true
  阶段1  generateStyle && !getStyleReferenceUrl(project)
            -> await generateStyleReference(pid)      （失败不阻塞，退化为文生图）
  阶段2  createBatchRunner{registry:activeAssetTasks}.run({pid, concurrency:3})
  |
  +-- buildTasks 读最新 store，算一次 stylePrompt = getStylePrompt(project)
  |   ⚠ 风格只以**文本**注入，不作为 i2i 参考图（2026-09-15 事故决策）
  |
  +-- character 且 !imageUrl:
  |     prompt = composePortraitPrompt({appearancePrompt || prompt, stylePrompt})
  |               -> 内含物种锁定句 + 解剖约束，无人像语汇
  +-- scene|product|prop 且 !imageUrl:
  |     prompt = composeTextToImagePrompt({subject: assetImageBoundary(kind)+" "+asset.prompt,
  |                                        style: stylePrompt})
  |     ⚠ 批量只按 !imageUrl 过滤，**不检查 prompt 是否为空**
  |        （手动「补全缺失资产」在 StepAssets.tsx:204-208 才算 prompt.trim()）
  |
  +-- [srv] generateImage(...)  -> 请求体见 图5 的同一段
  +-- [store] 成功 updateAssetByProjectIdIfRevision({imageUrl, error:undefined})
              失败 updateAssetByProjectIdIfRevision({error:msg})
              两条都走 applyAssetUpdate -> 见 图9 的级联（会清镜头产物 + 重置 3 个 reviewed）
  标记: onBeforeRun assetGenerationStarted=true / onFinally false
```

---

## 图 4　步骤 3：分镜（大纲 → 占位 → 逐镜头）

```
[编排] generateStoryboard(prompt, {onProgress})                    :289
  in : prompt = project.ideaPrompt.trim()
  守卫: hasActiveTask(activeScriptTasks, pid) -> **静默 return（不抛错、不 await）**
  [store] resetStuckShots(pid)  残留 scripting -> idle              :307
  |
  1) [srv] generateStoryboardOutline({apiKey,baseUrl,prompt,language,aspectRatio,assets})
          req POST /chat/completions  purpose=storyboardOutline  槽位: text x1
          out {shots:[{title, summary, characterNames:[str], sceneName?:str}],
               newCharacters[], newScenes[]}
          !! 解析不出非空 shots 数组 -> throw error.shotsInvalid（**此调用无重试**）
  2) [store] assets += extractNewAssets(current, newCharacters, "character", manual)
                                + extractNewAssets(current, newScenes, "scene", manual)
  3) [store] setShotsByProjectId(pid, N x Shot{status:"scripting", scriptText:"",
                     visualPrompt:"", motionPrompt:"", duration:5, dialogues:[], ...})
  4) runWithConcurrency(N 个 task, SHOT_CONCURRENCY=3)              :394
       |
       +-- [srv] generateStoryboardShot({apiKey,baseUrl,prompt,language,aspectRatio,
       |            assets, outline:JSON.stringify(outline.shots), item, index, total})
       |          req purpose=storyboard / 骨架 storyboardShot
       |          out RawShot -> normalizeRawShot: duration∈{4,5,8} 否则 5
       |          内部重试 attempt<=2（<=3 次，无退避）
       |          !! visualPrompt 或 motionPrompt 为空 = 该次尝试判失败并重试
       +-- [lib] buildShotUpdate(raw, latestAssets)                 :58
                 in : RawShot + Asset[]
                 解析: resolveAssetId/resolveAssetIds —— 先按 ID，再按名称
                 out: Partial<Shot>{
                   scriptText, visualPrompt, motionPrompt, duration, firstFrameUrl,
                   sceneDesc, detailDesc, lightingDesc, styleDesc,
                   actionDesc, cameraDesc, envChangeDesc, motionSpeedDesc,
                   activeSceneId, activeProductIds, activePropIds,
                   activeCharacterIds,
                   dialogues:[{id:"dlg_<ts>_<rand>", characterId: str|null, text, delivery}]}
                 引用未命中只降级为 null/[]，**绝不抛错**
       +-- [store] updateShotByProjectId(pid, shot.id, {..., status:"scripted"})
                   单镜头异常 -> {status:"failed", error:msg}，其他镜头不受影响
       +-- finally: completed++ -> onProgress(completed, N)  <== StepAssets 收到即 setWizardStep(3)
  5) [store] setProjectStatusById(pid, "idle")
     大纲阶段异常 -> resetStuckShots + status="failed" + throw      :397
```

单镜头改写在同一套出参上：`reviseShot` -> `reviseShotWithInstruction(shot, instruction, assets, language, aspectRatio)`（purpose=shotEdit，<=3 次）-> 同一个 `buildShotUpdate` 写回。`rerollShot` 复用阶段 2 单请求并带 `variationOf{scriptText, visualPrompt}`。

---

## 图 5　步骤 4：镜头图片（提示词组装的分支 + 真实请求体）

```
[编排] runImageBatch({projectId, concurrency:3})                   :111
  recoverStuck: status=="imaging" -> {status:"scripted", error:undefined}
  筛选: !imageUrl && status!="imaging" && visualPrompt.trim()
  |
  +-- [lib] buildImageGenerationInput(shot, project, rules)         :73
  |      refs   = pickShotReferences(shot, project)
  |               in : shot.activeCharacterIds / activeProductIds / activePropIds
  |               out: [url]  角色 -> 产品 -> 道具，按 URL 去重，上限 4
  |                    ⚠ 场景图与风格母版**都不进参考图**
  |      subject = composeVisualPrompt(shot) -> shot.visualPrompt（不二次拼装）
  |      style   = getStylePrompt(project)
  |      rules   = {composeShot, negativeStrategy} 注册表生效文本(en)   :57
  |      <|> refs.length > 0
  |      |     prompt = composeMultiReferencePrompt({
  |      |                references:[{index:1..n, role:asset.type|"style", note:asset.name}],
  |      |                scene:subject, style, rules})
  |      |     referenceImageUrls = refs
  |      <|> refs.length == 0
  |            prompt = composeTextToImagePrompt({subject, style||project.style,
  |                     quality:"high quality, 8k", rules})
  |            referenceImageUrls = []（请求体里不带）
  |
  +-- [srv] imageService.generateImage({apiKey,baseUrl,prompt,size:"1K",ratio,refs?})
  |          -> 透传到 ai/openai.generateImage
  |
  +-- [srv] OpenAIService.generateImage                     openai.ts:169
             槽位: acquire("image", {sizeTier: imageSizeToTier("1K")})
             url  : POST {baseUrl}/images/generations      (fetchWithRetry <=4 次 x60s)
             body : {model:"agnes-image-2.5-flash",
                     prompt,
                     size:"1K",                       // 档位串，不是像素
                     ratio:"16:9"|...|else "1:1",     // 白名单校验
                     extra_body:{response_format:"url",
                                 image?:[url...],     // ⚠ 参考图必须在这里，放顶层 -> 403
                                 seed?:number}}       // 合法域 -1..999
             out  : json.data[0].url  -> 无协议则补 "https://" -> 空 -> throw error.imageApiNoUrl
             特判 : error.code=="content_policy_violation" -> ImageSafetyFilterError
  |
  +-- [store] setShotStatusByProjectId(pid, id, "imaging")   （发请求前）
              成功 updateShotByProjectIdIfRevision({imageUrl, status:"imaged"})
              失败 setShotStatusByProjectIdIfRevision("failed", msg)
  onFinally: 全部有图 -> project.status "idle" ；否则 "failed" + 硬编码中文文案
```

---

## 图 6　步骤 5：镜头视频（创建 + 轮询 + 错误分叉）

```
[编排] generateVideosForStep()  -> 并发 = tokenplan?3 : rpm.video<=1?1 : 2   :198
  recoverStuck: status=="videoing" -> {status:"imaged", videoProgress:0, error:undefined}
  筛选: !videoUrl && imageUrl && status!="videoing" && (motionPrompt || actionDesc)
  |
  +-- prompt = appendRegistryRules(composeMotionPrompt(shot) -> shot.motionPrompt,
                                   {negativeStrategy})
  +-- [srv] generateVideo(opts, onProgress, signal)          videoService.ts:125
  |      in : {apiKey, baseUrl, prompt, imageUrl, lastFrameUrl?, aspectRatio, duration}
  |      槽位: acquire("video", {cost: duration||1, signal})   <-- HTTP 之前就扣秒数
  |      req1: POST {baseUrl}/videos   (maxRetries 3, baseDelay 10s)
  |            {model:"agnes-video-2.5-flash", prompt:sanitizePrompt(prompt),
  |             mode:(imageUrl||lastFrameUrl)?"keyframe":"text",  // 向导恒 keyframe
  |             size:"720P",                                      // 固定
  |             aspect_ratio:<白名单，否则 "16:9">,
  |             seconds:String(clamp(round(duration),4,12)),      // 4..12
  |             n:1, first_frame?:imageUrl, last_frame?:lastFrameUrl}
  |            注：first_frame 取 opts.imageUrl（= shot.imageUrl），与 shot.firstFrameUrl 无关
  |            out: video_id ?? task_id ?? id
  |      req2: 循环 GET {origin}/agnesapi?video_id=..&model_name=agnes-video-2.5-flash
  |            间隔 5s / 上限 30min / task_not_exist|404 容忍 24 轮
  |            onProgress(pollJson.progress) -> [store] shot.videoProgress
  |            完成 status∈{completed,succeeded} 或 internal_status=="completed"
  |      out : {videoUrl, coverImageUrl, duration}
  |            url 取值顺序: url -> metadata.url -> video_url
  |                          -> output.url -> output.video_url -> remixed_from_video_id
  |            ⚠ 上层只用 videoUrl，coverImageUrl 与实际 duration 被丢弃
  +-- [store] 成功 updateShotByProjectIdIfRevision({videoUrl, status:"videoed"})
  |
  错误分叉（决定会不会重复烧钱）:
    VideoTaskCreatedError stillRunning=true  (任务不存在/轮询 HTTP 失败/非 JSON/超时)
        -> 保留服务端任务：videoProgress=0, videoRetryCount=attempt+1, error 文案
        -> **直接 return，不再创建新任务**
    VideoTaskCreatedError stillRunning=false (完成但无 url / 服务端 failed|cancelled)
        -> status="failed"
    其他异常 且 attempt < 2 -> 等 8s*(attempt+1) 后重试创建（最多 3 次机会）
    其他异常 且 attempt >= 2 -> status="failed"
  onFinally: 全有视频 -> "idle"；全落定(有视频或失败) -> started=false + "failed"
```

首尾帧参数来源：`DualFrameToggle` 勾选后写 `shot.useDualFrame` / `shot.lastFrameUrl`（可从其他镜头图点选，也可**手输 URL**）；`useDualFrame && lastFrameUrl` 同时成立才会带 `last_frame`。

---

## 图 7　步骤 6：本地拼接（零 AI 调用）

```
[UI] StepAssembly.handleRender()  :68
  in : videoUrls = shots.filter(s=>s.videoUrl).map(s=>s.videoUrl!)   // 顺序 = shots 数组顺序
       {videoUrls, onProgress:setRenderProgress, signal}
  [store] setProjectStatusById(pid, "rendering")
  |
  +-- [srv] renderService.concatenateVideos
  |     len==0 -> throw error.noVideoToConcat
  |     len==1 -> **完全不过 FFmpeg**：fetch(url) -> Blob(type:"video/mp4")
  |               -> URL.createObjectURL -> onProgress(100)
  |     len>=2 -> FFmpeg.wasm 单例 load（core 0.12.6，DEV 同源代理 -> fastly -> unpkg）
  |               逐个 fetch(url)  120s 超时，与外部 signal 合并
  |                 DEV: cos-platform-outputs.agnes-ai.cn -> /cdn-proxy<path?query>
  |                 代理失败 -> 回落直连
  |               writeFile input{i}.mp4      进度 ((i+1)/(n+1))*50
  |               writeFile concat_list.txt   内容 "file 'input{i}.mp4'" 逐行
  |               runConcat([-f concat -safe 0 -i concat_list.txt -c copy ...])   50->80
  |                 失败 -> deleteFile output.mp4
  |                          runConcat([..., -c:v libx264 -preset ultrafast -crf 23
  |                                        -c:a aac, ...])                        50->80
  |               readFile output.mp4 -> Blob -> objectURL            85 -> 100
  |               finally: 删除全部虚拟文件
  out: blobUrl:str   （只存组件内 state，不写 store）
  [store] 成功 -> "done" ；controller.aborted -> "idle"（不算失败）
                  其他异常 -> "failed" + 尾部 20 行 FFmpeg 日志（界面 <pre> 展示）
  取消: handleCancelRender -> renderAbortRef.abort()
        下载阶段 abort fetch；FFmpeg 阶段 ffmpeg.terminate() 且实例缓存置空
  释放: 项目切换 / 组件卸载 -> URL.revokeObjectURL
```

---

## 图 8　限流器：一次调用的槽位与配额参数流

```
调用方                              rateLimiter.acquire(kind, opts)
  ai/openai.chatCompletion   ->  acquire("text")                        cost 缺省 1
  ai/openai.generateImage    ->  acquire("image", {sizeTier})            cost 缺省 1
  videoService.generateVideo ->  acquire("video", {cost: 秒数, signal})
        |
        v
  plan = resolvePlan(settingsStore.providerConfig.plan)   <== 服务层唯一直接读 store 的地方
  chain[kind] 串行排队（同 kind 的等待按到达顺序）
        |
        v  guard()                                        rateLimit.ts:128
  1 throttleRpm   key = kind=="image" ? "img:"+(tier??"1K") : kind
                  log = 60s 窗口内时间戳
                  log.length >= rpmFor(plan,kind,tier)
                    -> sleep(MINUTE-(now-log[0])+50, signal) 后重新判定
  2 checkQuota    仅 accessType=="tokenplan"
                  bucket = "tokenplan:<planId>:<kind>:<5h|week|day>"
                  sum(entries)+cost > limit
                    -> !! RateLimitError{reason:"quota", resetMs(>=1000), plan}
  3 recordRpm + recordQuota   <== **记账在 HTTP 之前，请求失败不回滚**
        |
        v
  localStorage["wxhb-usage"] 持久化计数   |   取消 -> RateLimitError{reason:"aborted"}
                                             ⚠ 该错误的 kind 字段恒为 "text"（:86,95）
文本元调用也会各占一槽：resolveGenerationParams 内部又走一次 chatCompletion
（缓存键 = purpose:cacheKey，scriptService 不传 cacheKey -> 每 purpose 每会话只多 1 次）
```

---

## 图 9　写回参数如何作废下游产物（revision 与级联）

```
谁写                     写什么字段                         store 之后发生什么
-----------------------------------------------------------------------------------------------
Step4 图片批量    shot.imageUrl + status        ->  videoUrl/videoProgress/videoRetryCount 清空
                                                    renderRevision +1
Step5 视频批量    shot.videoUrl + status        ->  videoProgress/videoRetryCount 清空  rev +1
步骤4/5 子字段    sceneDesc/detailDesc/          ->  VISUAL 命中：图+视频全清
                  lightingDesc/styleDesc/          status = scriptText 非空 ? scripted : idle
                  scriptText/visualPrompt/         rev +1
                  activeCharacterIds/activeSceneId/
                  activeProductIds/activePropIds
步骤5 时长/尾帧   motionPrompt/duration/         ->  MOTION 命中：只清视频
                  useDualFrame/firstFrameUrl/        status = imageUrl?imaged:(scriptText?scripted:idle)
                  lastFrameUrl 等                  rev +1
-----------------------------------------------------------------------------------------------
Step2 资产生图    asset.imageUrl                ->  !! applyAssetUpdate 认定"渲染字段变化"
   （含生成器自己写回）                                 assetsReviewed/imagesReviewed/
                                                        storyboardReviewed 全部 = false
                                                       + 引用该资产的 shot 图/视频全清 rev+1
                                                       + style 资产 => 命中**全部**镜头
Step2 改设定      asset.name/description/        ->  同上（值真的变了才算）
                  prompt/appearancePrompt/
                  avatarUrl/multiViewUrl/type
Step2 视觉方向    updateVisualDirection          ->  清 styleReferenceUrl + **所有资产 imageUrl**
                                                        + style 资产 prompt="" & dirty=true
                                                        + assetsReviewed=false，revision+1
                                                        ⚠ 不清 shots，镜头图仍是旧的
Step2 删除资产    removeAsset                    ->  三个 reviewed=false + 引用剔除（对白归旁白）
                                                        ⚠ **不清 shot.imageUrl/videoUrl**
                                                        （与代码注释声称的失效行为不一致）
-----------------------------------------------------------------------------------------------
过期结果丢弃：任务开始时记 expectedRevision，写回用 *IfRevision
              期间用户改过输入 => revision 已变 => 写回返回 false，结果静默丢弃
```

---

## 图 10　跨步骤字段契约（谁产生 → 谁消费）

```
字段                          产生者                        消费者
------------------------------------------------------------------------------------
project.ideaPrompt            StepIdea 防抖写回             链A/链B/大纲/逐镜头 prompt
                                                            StepAssets.enterStoryboard 判空
project.aspectRatio           StepIdea 按钮                 aspectRatioToImageParams -> size/ratio
                                                            aspectRatioToVideoAspect -> aspect_ratio
                                                            文本请求的 language/画幅上下文
project.visualDirection       链A 写回 / 步骤2 编辑器保存    deriveStylePrompt 六维输入
project.style (中文)          旧字段/提取兜底                deriveStylePrompt / fallbackStylePrompt
assets[style].prompt          deriveStylePrompt+审计        getStylePrompt -> 资产图/分镜图文本注入
project.styleReferenceUrl     generateStyleReference 写回   "是否已有风格图"幂等判定（图2/图3 阶段1）
                                                            StepAssets 视觉方向卡展示
                                                            ⚠ 不再进入任何参考图列表
assets[x].imageUrl            图2/图3 写回                  pickShotReferences（角色/产品/道具）
                                                                -> extra_body.image
                                                            CharacterEditor 定妆照预览
shot.visualPrompt             generateStoryboardShot        composeVisualPrompt -> 图片 prompt 主体
                                                                （buildImageGenerationInput）
shot.motionPrompt             同上                          composeMotionPrompt -> 视频 prompt
shot.{8 子字段}               同上                          Step4/5 PromptSubFields 编辑
                                                                -> rewritePromptFromFields 反写整段
shot.imageUrl                 图5                           generateVideo.first_frame
                                                                + StepVideos 预览 + lastFrame 候选
shot.firstFrameUrl            仅 normalizeRawShot/pickShotFields 搬运   **无消费者（死字段）**
                                                                首帧实际用 shot.imageUrl
shot.lastFrameUrl             DualFrameToggle(点选/手输)     generateVideo.last_frame
shot.videoUrl                 图6                           concatenateVideos.videoUrls + 预览
shot.status                   各批量                        批量筛选条件 / recoverStuck / 按钮禁用
project.assetsReviewed        步骤2 审核按钮                CreationWizard 步骤2->3 门禁
        /storyboardReviewed   步骤3 审核按钮                门禁 3->4
        /imagesReviewed       ReviewCheckpoint 确认          门禁 4->5
        （三个都会被 9.6 的级联重置为 false）
project.automationMode        顶栏开关                      各步骤自动推进 effect + canAdvance 放行
```

---

## 审这份图时最该盯的四条

1. `assets[].imageUrl` 一次写回 => 三个 reviewed 门禁 + 引用镜头的图视频一起没（图9 中段）。
2. `referenceImageUrls` 只在**分镜图**链路出现；资产图与风格图全是文生图（图2/图3/图5）。
3. `duration` 会被规范化两次：`normalizeRawShot` 只允许 {4,5,8}，`videoService` 再 clamp 到 4..12（图4/图6）。
4. 视频槽位在创建前就按秒扣，且非幂等 POST 仍会自动重试（图6/图8）。
