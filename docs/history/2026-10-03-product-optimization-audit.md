# 全项目 UX 与生成质量审计（2026-10-03）

> **范围**：按仓库现行六步向导检查交互链路、生成质量相关规则、实体属性和提示词编排。本文是静态源码审计，不是生成效果评测。
>
> **权威口径**：`docs/index.md:4` 规定文档与代码冲突时以代码为准；`docs/index.md:53-65` 说明 `docs/history/` 是时点快照，后续读取当前实现仍须回到源码。
>
> **证据标记**：
> - **已核实（代码事实）**：可直接由当前仓库实现及引用行确认。
> - **影响假设**：对体验、质量或损耗的合理推测，并非已证实的用户/模型结果。
> - **未实测**：本次没有运行真实生成、用户研究、浏览器/组件测试或输出质量评估；不把源代码意图等同于成片效果。

## 执行摘要

六步结构清晰，形成「想法 → 资产 → 分镜 → 图片 → 视频 → 本地拼接」主链；分镜详情与图片步骤有审核关口，失败镜头可重试，已创建的视频任务可续轮询；最终成片提供 MP4 下载。`src/features/wizard/StepStoryboard.tsx:247-257`、`src/features/wizard/StepImages.tsx:203-214`、`src/features/wizard/ReviewCheckpoint.tsx:60-106`、`src/features/wizard/CreationWizard.tsx:32-45`、`src/features/wizard/StepAssembly.tsx:117-123`

提示词与领域数据也已有较明确的结构：规则注册表与任务骨架（`src/lib/promptRules.ts:21-66`）、六段式生图提示词（`src/lib/promptComposer.ts:98-119`）、分资产类型的属性（`src/stores/projectTypes.ts:75-130`）、镜头级引用 ID（`src/stores/projectTypes.ts:174-190`）和视频素材规划（`src/lib/videoPlan.ts:17-31,43-78`）均能在代码中找到。

源码审计识别出五项优先处理的高置信度契约问题：

1. **分镜大纲的新增资产字段契约不一致**：提示词要求 `newCharacters` / `newScenes`，解析器却读取 `characters` / `scenes`，而调用端仅消费 `newCharacters` / `newScenes`。模型遵循提示格式时，大纲新增的角色/场景可能不会写入资产。（契约差异是代码事实；具体漏项频率未测。）`src/lib/promptRules.ts:353-359`、`src/services/scriptService.ts:321-339`、`src/features/wizard/useScriptActions.ts:368-379`
2. **`renderContent` 渲染设置与可编辑规则正文未接通**：对设置界面真实开放且确实被调用的 `composeShot`、`negativeStrategy` 渲染规则，`getActiveRenderRules` 只取内置 `renderContent`，不检查 enabled，也不使用设置编辑的 `content`；用户可改正文/关规则，但相应最终生成提示可能不变。范围仅限该 `renderContent` 辅助路径，不包括会正确检查 enabled 的 `buildSystemPrompt`/`getActiveRuleText`。（实现差异为代码事实；用户影响未测。）`src/components/SettingsDialog.tsx:58-61,216-280`、`src/lib/promptRules.ts:1243-1248,1251-1267,1276-1313`、`src/features/wizard/useImageActions.ts:61-62`、`src/features/wizard/useVideoActions.ts:31-34`
3. **产品参考图复用角色配额类别**：镜头级产品图调用 `push(..., "character")`，而非独立产品配额；总数上限与景别预算可能因此让产品参考被占位/拒收。（错分是代码事实；实际画面影响是假设。）`src/lib/promptComposer.ts:282-314,340-358`
4. **结构化字段重写与分镜语言契约不一致**：分镜规则要求中文 `visualPrompt` / `motionPrompt`，字段重写服务却明确要求完整英文 API prompt；两个 UI 阶段都允许通过字段提交重写。最终输出语言是否混杂、对模型效果的影响尚未实测。`src/lib/promptRules.ts:392-417`、`src/services/chatService.ts:127-155`、`src/features/wizard/PromptSubFields.tsx:41-59,114-160`
5. **部分 AI HTTP 错误将完整响应体并入展示错误**：文本和图片非 2xx 分支读取 `resp.text()` 并作为 `detail` 放入异常；视频创建失败也附带响应体。这里只确认上述分支，不泛化为所有服务错误。（可读性和信息暴露风险是假设；响应内容及影响未测。）`src/services/ai/openai.ts:120-124,242-256`、`src/services/videoService.ts:262-265`

**取消边界须按界面与任务域精确表述**：向导里可确认的用户操作包括 Step6「取消拼接」和 Step5 对单个已创建视频任务「放弃」；后者只清本地跟踪，不取消服务端任务，且批次实际运行期间会禁用。图像、资产提取/图片与分镜的批处理虽持有内部 `AbortController`/`signal` 并可停止领取新工作，但这轮未找到对应的用户停止控件；文本、图片和资产生成网络请求也未完整接收可中止信号。故不能概称“全应用无中止能力”，也不能把内部 abort 或视频放弃说成用户可停止远端生成。`src/lib/batchRunner.ts:16-20,68-105`、`src/features/wizard/useImageActions.ts:112-171`、`src/features/wizard/useAssetActions.ts:319-348`、`src/features/wizard/useScriptActions.ts:44-58,348-355,400-429`、`src/features/wizard/StepVideos.tsx:300-318`、`src/features/wizard/useVideoActions.ts:462-496`、`src/features/wizard/StepAssembly.tsx:68-115,112-115`

## 交互体验专项发现

以下为源码可见的交互/文案问题；“影响”是待验证假设，不是访谈或可用性实验结论。

1. **首访设置打断主任务**：没有 API Key 时 `ApiKeyBanner` 在挂载后自动打开完整设置对话框，同时背景仍渲染需要配置的页面与横幅。建议默认保留横幅和清晰的“去设置”入口，提供逐步配置，避免把用户一进来就推入所有设置项；若保留自动弹窗，则解释为什么设置是开始生成的前置步骤。`src/components/ApiKeyBanner.tsx:12-35`、`src/components/SettingsDialog.tsx:336-369`
2. **视频衔接选项说明与真实方向相反**：中文/英文帮助文案说“下一镜图片作为本镜尾帧”，但实现的自动衔接是上一镜生成视频尾帧成为后一镜首帧；这可能让用户选项预期反向。建议按真实数据流改写，并配简单两格箭头图，说明条件不满足时如何降级。`src/i18n/index.ts:31-34,516-519`、`src/lib/shotContinuity.ts:62-95`、`src/lib/videoPlan.ts:133-149`
3. **关键概念说明难扫读**：一致性策略控件旁是一整段长解释，样式用 `text-ink-5` 且字号 0.625rem；建议主控件旁放一句默认效果，详细的“首帧/尾帧/角色参考/不兼容时行为”分层到帮助气泡或图示。代码已有 `HelpTooltip` 组件，但截至本次搜索无 UI 引用，可考虑复用。`src/components/SettingsDialog.tsx:600-619`、`src/components/ui/HelpTooltip.tsx:1-20`
4. **限额说明应标成估算/本地防护，不要让用户误当服务端承诺**：设置会展示选择套餐的 RPM 与订阅配额；源码记录免费档实际 7/37、12/38 请求窗口曾触发 429，而另一个 20/60 窗口全绿，说明服务端限制不恒等于界面上的粗过滤值。建议文案强调“本地参考值，服务端可能更严格”，并把 429 冷却/重试状态解释到生成进度中；不承诺显示未知服务端精确剩余额度。`src/components/SettingsDialog.tsx:17-53,532-545`、`src/lib/plans.ts:5-11`
5. **分镜页把复杂结构化提示字段作为只读信息呈现**：当前 9 个视觉/运动子字段在 ShotDetail 中展示，镜头主体字段统一经“交给 AI 修改”指令调整；而图片/视频步骤的 `PromptSubFields` 允许逐字段编辑/润色。`endStateDesc` 也作为独立字段保存在 Shot，但尾态只通过 AI 指令调整，或在媒体提示词处理中合并。建议统一“审核阶段只读、生成阶段逐字段调参”的预期，并给尾态、景别等关键术语增加按需解释；不要把每个底层属性都同时暴露在主编辑表单。`src/features/wizard/ShotDetail.tsx:23-34,172-206`、`src/features/wizard/PromptSubFields.tsx:41-59,64-160`、`src/stores/projectTypes.ts:201-213`

**反馈与恢复应保持现有优势**：镜头轨展示编号、状态和 pending 标记；图片/视频顶部显示本步完成数，视频另显示队列与秒数预估，参考图被拒收时图片详情说明原因；审核卡显示失败原因并提供重试。优先改为失败状态跨镜头聚合/可跳转，以及把不对称的批次等待信息补齐，而非笼统地说“没有进度”或“无法恢复”。`src/features/wizard/WizardRail.tsx:61-105`、`src/features/wizard/StepImages.tsx:37-48,88-156,189-215`、`src/features/wizard/StepVideos.tsx:42-58,125-199`、`src/features/wizard/ReviewCheckpoint.tsx:60-83`

## 保护现有决策与产品优势

- **步骤门禁与阶段节奏**：应用有六步统一向导，前进由 `evaluateWizardAdvance` 得出单一判定，并把阻塞原因显示在「下一步」旁，有助于避免跳过必要状态。`src/features/wizard/CreationWizard.tsx:23-51,89-114`
- **资产阶段不让用户先面对空白分镜页**：首次进入分镜时在资产页启动分镜，首镜头完成或失败后才切页；自动模式也等资产图齐全后推进。`src/features/wizard/StepAssets.tsx:96-128,139-154`
- **分镜逐镜生成有明确的连贯性前提**：后镜请求读入上一镜已生成的脚本、画面提示词和景别；串行是实现镜头承接的设计取舍，不宜只为吞吐量直接并发化。`src/features/wizard/useScriptActions.ts:400-429`
- **图片审核对失败有出路**：所有镜头均已成功或失败才显示审核卡；失败镜头可重试，失败未清除时不能确认推进。它不是“只有全部成功才显示”。`src/features/wizard/StepImages.tsx:46-47,203-214`、`src/features/wizard/ReviewCheckpoint.tsx:60-106`
- **参考图采取受控、可解释策略**：镜头图参考最多 4 张并按景别分配；场景图和风格母版图刻意不作为 i2i 参考，代码记录了此前观察到整图复制/构图压制及实测无法归因的依据。不要在无新实验时建议取消这些排除。`src/lib/promptComposer.ts:282-314,337-358`
- **视频素材策略显式处理 API 互斥**：规划器按手动尾帧、自动衔接、身份参考、本镜首帧、纯文本的顺序决策，并避免首尾帧与参考图同送。相邻衔接需通过场景、演员、景别检查。`src/lib/videoPlan.ts:43-78,102-115`、`src/lib/shotContinuity.ts:66-95`
- **最终作品并非只能预览**：拼接结果以组件状态中的 Blob URL 供预览，但明确提供 MP4 下载；切项目或卸载时释放 Blob URL。报告不把“预览临时”说成“没有下载”。`src/features/wizard/StepAssembly.tsx:25-53,117-123,225-252`
- **实体设定保留类别语义**：角色、场景、产品、道具拥有各自结构字段；镜头保存活动资产引用、对白、两套提示词、景别、时长与视频任务恢复信息，足以支撑后续的细粒度质量诊断。`src/stores/projectTypes.ts:75-130,132-166,168-220`

## 六步工作流审计

### 1. 想法

**已核实（代码事实）**：想法输入在 500ms 防抖后写入项目；可选 16:9、9:16、1:1，支持框内润色；开始后调用角色/资产提取，生成中状态同时看本地状态与项目级 `scripting`。`src/features/wizard/StepIdea.tsx:14-28,43-45,68-78,87-117,164-180`

**UX / 质量判断**：本次未发现足以断言想法页本身有功能故障的源码证据。想法润色提示词定义在步骤组件，而分镜/资产等大部分长规则集中在提示词注册表；这是管理边界上的不一致，但不等同于润色质量缺陷。`src/features/wizard/StepIdea.tsx:14-28`、`src/lib/promptRules.ts:1-13,21-66`

**影响假设**：首次生成的成本、将启动哪些自动阶段、能否在运行中停止，若提示不够显眼，可能影响用户对“提交后会发生什么”的预期。需要以实际文案和使用观察验证；本次没有据此断定界面缺少某条提示。

**流程摘要**：Step1 的视觉方向与按资产类型提取分别启动；资产图片阶段先试生成风格参考，再批量生成资产图（并发受控）；风格图失败不阻塞资产图。`src/features/wizard/useScriptActions.ts:203-315`、`src/features/wizard/useAssetActions.ts:314-348,319-490`

### 2. 资产

**已核实（代码事实）**：页面统计角色/场景/产品/道具的数量和图片就绪情况；存在缺图或无风格图时标记待处理。用户进入分镜时，若已有分镜或无想法则直接进入，否则启动分镜并在首镜头进度回调后切页；自动模式在观察到全部资产有图后推进。`src/features/wizard/StepAssets.tsx:80-84,96-128,139-154`

**质量风险（高置信度契约问题）**：分镜大纲提示词的 JSON 要求新增资产键 `newCharacters` / `newScenes`，但 parser schema 读取 `characters` / `scenes` 后才映射到返回的 `newCharacters` / `newScenes`；上层只读取后者并添加资产。若模型按格式返回，新增角色/场景可能被静默丢弃，导致后续镜头缺乏可引用实体。`src/lib/promptRules.ts:353-359`、`src/services/scriptService.ts:321-339`、`src/features/wizard/useScriptActions.ts:368-379`

**影响假设**：若这类资产漏失，用户可能在“资产摘要”与镜头的出场引用之间看到不一致，生成的镜头也可能少掉故事中关键主体；需先修正契约，再以受控样例验证。

**资产审核/门禁差异**：半自动审核卡的确认禁用条件仅涵盖“正在生成/正在进入分镜”，未按缺图、空提示词或失败资产逐项阻塞；Step2 门禁则只要求 `assetsReviewed`。auto 模式推进条件相反，要求至少有一个资产且所有资产有图。建议审核区展示缺项及后果，并明确提供“补齐 / 跳过继续”选择，避免确认语义与自动模式行为不同。`src/features/wizard/StepAssets.tsx:139-154,463-480`、`src/lib/wizardGating.ts:46-48`

### 3. 分镜

**已核实（代码事实）**：两阶段生成：大纲先建立镜头计划，再为镜头写详细内容。逐镜头阶段按序执行，并将上一镜的实际结果（脚本、画面提示词、景别）交给下一镜；失败镜头会被标记并继续处理。`src/features/wizard/useScriptActions.ts:358-366,381-429,437-449`

**审核与可编辑性**：分镜审核卡位于当前镜头详情，所有镜头具备脚本与画面提示词后才可确认；分镜正文只读，用户通过“交给 AI 修改”指令调整内容。`src/features/wizard/StepStoryboard.tsx:236-257`、`src/features/wizard/ShotDetail.tsx:3-6,172-214`

**流程依赖与进度**：该串行循环没有接收 UI 取消信号的调用链；本次对分镜操作界面未发现可见的“停止生成”控件。串行是因为下一镜读取上一镜实际内容，不能只为吞吐并发化；但旧执行流文档仍写镜头并发 3，与实现不符。当前一镜失败会标记并继续。`src/features/wizard/useScriptActions.ts:400-429,437-449`、`docs/execution-flow.md:127-138`

**幂等导航边缘态**：`generateStoryboard` 在项目已有活动任务时直接 `return`。资产页的 `enterStoryboard` 却只在收到首个 `onProgress` 回调时导航到分镜页。若入口触发时任务已存在，调用会无进度地返回，页面可能停在资产页且无错误提示。建议复用活动 Promise/进度订阅，或返回显式 already-running 状态并直接导航。`src/features/wizard/useScriptActions.ts:348-355`、`src/features/wizard/StepAssets.tsx:112-128`

**影响假设**：串行意味着长分镜时用户等待时间较长，不能取消可能加剧失控感；但调用耗时、分镜总时长、用户耐心阈值均未测。更稳妥的建议是先提供预计进度/已完成数与“停止后保留已完成镜头”语义，再决定是否改变生成算法。

### 4. 图片

**已核实（代码事实）**：步骤挂载或镜头数变化时会自动开始待生成图片；半自动审核卡在全部镜头均已成图或失败后显示。失败列表提供重试，确认被失败镜头禁用。单镜头详情会显示由于景别/总量被拒绝的参考位原因。`src/features/wizard/StepImages.tsx:41-64,189-215`、`src/features/wizard/ReviewCheckpoint.tsx:60-106`

**生成执行细节与刷新恢复**：图片批处理并发上限为 3；批处理内部信号最多阻止尚未启动的 worker，单张 `generateImage` 不接收 `signal`。图片页没有用户可见批次停止按钮；刷新后残留 `imaging` 会被复位为 `scripted`，页面挂载会自动重启待补图片。若服务端已完成但响应在刷新时丢失，客户端可能无法识别结果而重做；这是一种结果未知风险，发生率和实际额度结果未测。`src/features/wizard/useImageActions.ts:112-171,199-209`、`src/features/wizard/StepImages.tsx:56-64`、`src/services/ai/openai.ts:67,234`

**参考图质量风险（代码事实）**：产品图先于道具图注入，但与角色共用 `characters` 额度。极景/远景最多两张角色类参考、零道具类参考；近景额度不同；总计上限四张。产品图可能被记入错误类别额度。`src/lib/promptComposer.ts:282-314,340-358`

**影响假设**：当角色参考已用满同镜额度时，后续产品图有可能因被当作 character 而跳过，从而降低产品外观锚定；真实发生比例和画质影响未测。修正类别预算后需覆盖角色+产品+道具超额组合测试。

### 5. 视频

**已核实（代码事实）**：进入视频步骤时自动尝试生成待补镜头；支持“off / chain / identity”一致性策略。首尾帧、参考图不混用；身份参考是角色定妆照与风格母版。自动衔接依赖前镜视频尾帧，而尾帧 URL 保存在模块内存中，不持久化；刷新后规划会降级为只锁当前首帧。`src/features/wizard/StepVideos.tsx:79-89`、`src/lib/videoPlan.ts:17-23,43-78,82-99`、`src/lib/shotContinuity.ts:66-95`、`src/lib/tailFrameStore.ts:2-23`

**任务创建与恢复**：创建请求使用非幂等 `POST /videos`，通用重试次数固定为 0，避免响应超时或 5xx 后自动重复扣时长；任务只有收到并解析出服务端 ID 后才可按 ID 恢复。若请求其实已被接受但客户端在获取 task ID 前失去响应，当前客户端只能看到失败/不明状态，无法证明远端任务未创建。建议保留“结果未知、不要自动重发”的保护；若上游支持，后续加 client request ID/幂等键或按客户端引用查询，以便人工安全恢复。`src/services/videoService.ts:32-45,245-304`、`src/features/wizard/useVideoActions.ts:106-112,197-201`

**轮询与放弃**：轮询间隔 5 秒、单任务等待上限 30 分钟；超时不等于服务端取消，任务 ID 保留但恢复自动入口在向导挂载时。详情提供“放弃这条任务”，但 `giveUpVideoTask` 仅修改本地状态，不发服务端取消请求；批次运行时按钮还会禁用。既有确认文案已说明再次生成会再次扣秒、旧任务若出片将无人认领。建议按钮给出“本地停止跟踪”的明确语义与恢复入口，不要重复声称文案缺少成本/远端提示，也不许诺上游未支持的取消。`src/services/videoService.ts:28-30,433-438`、`src/features/wizard/CreationWizard.tsx:42-45`、`src/features/wizard/StepVideos.tsx:289-319`、`src/i18n/index.ts:362-365,840-843`、`src/features/wizard/useVideoActions.ts:462-496`

**影响假设**：创建请求结果未知时若用户立即手动重做，可能导致任务孤儿或重复任务；远端是否计费只能由服务端/供应商观测确认，源码无法断定。

**高优先级可靠性风险（静态核验）**：刷新恢复的轮询与批量注册表没有共用所有权。向导挂载时调用 `resumePendingVideoTasks()`；恢复函数并发轮询已有 `videoTaskId`，但该流程不登记 `activeVideoTasks`。因此恢复轮询期间，界面“放弃”操作可能通过只看批量注册表的守卫；放弃又只清除本地 task ID、不推进 `renderRevision`。如果用户随即重建，而旧轮询稍后成功，`commitVideoResult` 仍按旧的 `expectedRevision` 写回并清理任务字段，存在覆盖新结果或抹去新任务 ID 的竞态。**这是代码路径推导出的风险，不是本次实际触发或服务端计费的观测。**建议将恢复任务也登记进按项目/镜头的所有权表，且写回比较 task ID/任务代次；放弃/重建时使旧代次失效。`src/features/wizard/CreationWizard.tsx:42-45`、`src/features/wizard/useVideoActions.ts:41-53,122-143,287-321,470-495`、`src/lib/shotQueue.ts:97-105`

### 6. 后期拼接

**已核实（代码事实）**：需所有镜头都有视频才能拼接；使用本地 FFmpeg，下载/执行传入 `AbortSignal`，取消入口会 abort；完成后显示 Blob URL 预览且有下载 `.mp4` 按钮。组件卸载/切换项目会清理该 Blob URL。`src/features/wizard/StepAssembly.tsx:17-27,68-115,117-123,225-252`、`src/services/renderService.ts:73-78,106-119`

**体验边界**：源码证明“当前页面会话里可预览并下载”，不证明项目级云端保存或刷新后可恢复预览。`renderedUrl` 只在组件本地 state 中，清理也在组件卸载/切项目时执行。`src/features/wizard/StepAssembly.tsx:22-53`

**影响假设**：用户可能将“成片完成”理解为自动保存到项目；若刷新前未下载则预览状态会消失。建议将下载操作和“仅此会话预览/尚未保存到项目”的边界在 UI 中呈现，并验证是否需要更持久的成片交付方式。不得据此说没有 MP4 下载。

## 实体属性与提示词覆盖清单

### 实体 / 领域字段（按当前 TS 类型逐项清点）

| 实体 | 属性（代码标识符） | 主要下游用途 / 审计关注点 |
| --- | --- | --- |
| `StyleDetails` / `VisualDirection` | `kind`, `mediumMaterial`, `colorPalette`, `lightingMood`, `cameraTexture`, `composition`, `emotion`; 视觉方向另含 `name`, `description?`, `details`, `revision`, `status`。`src/stores/projectTypes.ts:36-56` | 项目级共享视觉锚点；status draft/confirmed/stale 与 revision 表示生命周期。旧项目还兼容 `Project.style`。 |
| 角色 `CharacterDetails` | `kind`, `species`, `role`, `age`, `personality`, `appearance`, `outfit`, `signature`, `background`。`src/stores/projectTypes.ts:75-85` | 定妆照与主体身份锚；保留用户明确指定的 species 等硬事实。字段类型不等于模型输出已满足。 |
| 场景 `SceneDetails` | `kind`, `settingType`, `environment`, `time`, `weather`, `elements`, `spatialLayers`, `lighting`, `paletteMood`, `storyUse`。`src/stores/projectTypes.ts:87-98` | 与镜头 `activeSceneId` 一起参与自动视频衔接判定；缺失或不一致会阻断自动衔接。`src/lib/shotContinuity.ts:66-95` |
| 产品 `ProductDetails` | `kind`, `category`, `purpose`, `silhouette`, `dimensions`, `color`, `material`, `structure`, `surfaceDetails`, `branding`, `signature`, `usageState`。`src/stores/projectTypes.ts:100-113` | `activeProductIds` 驱动产品参考图；预算角色类别错分见图片步。 |
| 道具 `PropDetails` | `kind`, `purpose`, `storyRole`, `objectType`, `shape`, `dimensions`, `material`, `color`, `structure`, `wear`, `signature`, `usage`。`src/stores/projectTypes.ts:115-130` | 显式引用道具图受景别预算限制。 |
| `Asset` 通用实体 | `id`, `type`, `name`, `description`, `prompt`, `imageUrl?`, `error?`, `details?`, `appearancePrompt?`, `assetNamespace?`, `fullPrompt?`, `avatarUrl?`, `multiViewUrl?`, `source?`, `derivation?`, `renderRevision?`。`src/stores/projectTypes.ts:132-166` | 角色专有字段与其它资产共享接口；`source` 区分 manual/extracted，`derivation.locked/dirty` 管派生提示词。字段结构不验证事实正确性。 |
| `DialogueLine` | `id`, `characterId: string \| null`, `text`, `delivery?`。`src/stores/projectTypes.ts:168-173` | `characterId=null` 表示旁白；delivery 当前为后续 TTS 预留。 |
| `Shot` | `id`, `index`, `scriptText`, `visualPrompt`, `motionPrompt`, `dialogues`, `activeCharacterIds`, `activeSceneId?`, `activeProductIds`, `activePropIds`, `duration`, `shotSize?`, `status`, `imageUrl?`, `videoUrl?`, `videoProgress?`, `videoRetryCount?`, `videoTaskId?`, `videoTaskModel?`, `error?`, `sceneDesc?`, `detailDesc?`, `lightingDesc?`, `styleDesc?`, `actionDesc?`, `cameraDesc?`, `envChangeDesc?`, `motionSpeedDesc?`, `endStateDesc?`, `firstFrameUrl?`, `lastFrameUrl?`, `useDualFrame`, `renderRevision?`。`src/stores/projectTypes.ts:174-220` | 子字段由总提示词渲染；`visualPrompt`/`motionPrompt` 才是 API SSOT。`endStateDesc` 合并到视频 prompt；首尾帧与动态规划有额外互斥/衔接逻辑。 |
| `Project` | `id`, `title`, `wizardStep`, `automationMode`, `assets`, `aspectRatio`, `style`, `visualDirection?`, `language`, `shots`, `status`, `error?`, `createdAt`, `updatedAt`, `ideaPrompt?`, `ideaChatHistory?`, `styleReferenceUrl?`, `assetsReviewed?`, `storyboardReviewed?`, `imagesReviewed?`, `styleReferenceError?`, `assetGenerationStarted?`, `imageGenerationStarted?`, `videoGenerationStarted?`。`src/stores/projectTypes.ts:227-261` | 统领跨步骤状态和审核门禁；新项目默认中文、16:9、半自动模式。`src/stores/projectStore.ts:45-65` |

### Prompt 链路

- **规则与骨架**：`PromptTask` 列举资产提取、视觉方向、分镜大纲/单镜、风格审计、生图/负面策略和润色等任务；骨架为中英双语并提供规则、示例、安全、动态资产占位符。`src/lib/promptRules.ts:21-34,57-66`
- **规则注册表的双用途设计**：规则的 `content` 面向提示词编辑/规则拼装；可选 `renderContent` 用于最后实际发送给图像/视频模型的渲染内容，避免把“怎样写提示词”的元指令直接发给生成模型。`src/lib/promptRules.ts:39-55,1239-1248`
- **结构化分镜提示词**：视觉与运动提示词分离；画面提示词要求使用单句外观锚点、一个机位/瞬间/景别；运动提示词沿起幅继续动作；另外要求对子字段、活动资产 ID、景别及时长约束填值。`src/lib/promptRules.ts:392-413`
- **文生图合成**：固定六段（主体、场景、风格、光照、构图、质量），空段剔除，再接注册表规则。`src/lib/promptComposer.ts:98-119`
- **镜头图参考选取**：显式角色、产品、道具引用；最多四张，分景别预算；场景和风格图不作为参考。此处规则有明确事故和实测背景，应保护并基于新数据复审，而非凭经验移除。`src/lib/promptComposer.ts:282-314,337-358`
- **视频提示词素材**：视频策略将媒体明确归入 keyframe/reference/text，互斥字段不同时发送；最多五张视频参考图。`src/lib/videoPlan.ts:17-31,43-78,102-115`
- **需修复的渲染设置链**：编辑面板更改 `rule.content` 与 enabled；但同 ID 合并时覆盖 `content` / `enabled`，保留 builtin 的其他属性（包含 `renderContent`）；最终 `getActiveRenderRules` 仅按 task/section 过滤，不判断 enabled。此处需缩小结论到有 `renderContent` 且被该 helper 实际调用的 `composeShot` 与 `negativeStrategy` 两项——它们会影响图片组合规则与视频/负向通用规则。不能泛化为所有`PromptTask`的最终渲染都忽略开关：`buildSystemPrompt` 与 `getActiveRuleText` 会检查 enabled。UI中自定义规则任务列表还遗漏可自检的 `visualDirectionAudit`、`stylePromptAudit`、`characterFidelityAudit`、`generationParams`，编辑器的规则开关/正文却可能让用户误以为对应通道可定制。`src/components/SettingsDialog.tsx:58-61,216-280`、`src/lib/promptRules.ts:1243-1248,1251-1267,1276-1293`、`src/features/wizard/useImageActions.ts:61-62`、`src/features/wizard/useVideoActions.ts:31-34`
- **语言契约需统一**：视觉、运动子字段提示词明确要求中文，润色系统提示词却要求英语；分镜 `storyboardShot.en` 自身也用英文自然语言描述“完整中文画面/运动提示词”，样例内容未在本次静态审计比对。用户可在图片/视频步骤对子字段调用润色，可能使完整提示词被改成英语。应统一项目语言/字段用途策略，并测双语项目回归；当前不能断言实际语言混杂率或效果退化。`src/lib/promptRules.ts:391-435,606-638,855-895`、`src/features/wizard/PromptSubFields.tsx:41-59,64-110,114-160`。完整提示词字段被注释为 API SSOT：`src/stores/projectTypes.ts:201-213`

### 系统提示词清点范围（逐项盘点）

以下覆盖 `PromptTask` 注册表的全部 13 个任务骨架、主要独立系统提示词和类型润色入口；目的是保证审计覆盖，不代表真实生成质量已评测。

| `PromptTask` / 提示 | 内容与效果约束 | 主要调用点 / 证据 |
| --- | --- | --- |
| `visualDirection` | 从创意抽取六维项目级视觉语言，不得夹带故事主体；编辑提示保持六维结构 | `scriptService.extractVisualDirectionFromIdea`、`VisualDirectionEditor`；`src/lib/promptRules.ts:67-97`、`src/features/wizard/VisualDirectionEditor.tsx:108-132` |
| `visualDirectionAudit` | 用项目主体黑名单判视觉方向越界并回写；失败时保留原值，不阻塞提取链 | `scriptService.auditVisualDirection`；`src/lib/promptRules.ts:141-170`、`src/services/scriptService.ts:711-770` |
| `extractAssets` | 单次按类型提取 JSON：角色/场景/产品/道具；每种类型调用复用同一 schema，并以 user 指令要求其它数组为空；风格不由此列表提取，而由视觉方向链派生 | `scriptService.extractAssetsByType`、`useScriptActions`；`src/lib/promptRules.ts:252-331`、`src/services/scriptService.ts:912-970`、`src/features/wizard/useScriptActions.ts:234-281` |
| `characterFidelityAudit` | 提取后只检查角色身份事实是否漂移，并按名字回填；失败时沿用原结果 | `scriptService.auditCharacterFidelity`；`src/lib/promptRules.ts:173-216`、`src/services/scriptService.ts:774-870` |
| `storyboardOutline` | 规划镜头数量/节奏与现有资产名称，并可返回新增角色/场景；这里存在 JSON key 与 parser key 契约不一致（P1） | `generateStoryboardOutline`；`src/lib/promptRules.ts:333-388`、`src/services/scriptService.ts:289-339` |
| `storyboardShot` | 单镜完整结构 JSON；中文画面/运动提示、资产 ID、景别、时长、对白、连续承接、起幅与止态规则；逐镜序列依赖上一镜产出 | `generateStoryboardShot`、`reviseShotWithInstruction`；`src/lib/promptRules.ts:391-435,932-981`、`src/features/wizard/useScriptActions.ts:400-429` |
| `characterAppearance` | 将角色描述转成英文定妆外观，保持主体/物种并补全视觉字段 | `buildCharacterAppearancePrompt`；`src/lib/promptRules.ts:438-486,1044-1066` |
| `styleRef` | 根据视觉方向派生纯视觉语言 style prompt，排除主体、叙事、样张板/构图词 | `deriveStylePrompt`；`src/lib/promptRules.ts:489-539,1068-1079`、`src/features/wizard/useAssetActions.ts:63-114` |
| `stylePromptAudit` | 对 style prompt 中具体主体、叙事和隐含主体进行审计/重写；出错保留原文继续 | `auditStylePrompt`；`src/lib/promptRules.ts:99-138`、`src/features/wizard/useAssetActions.ts:116-162` |
| `generationParams` | 由文本模型按用途选择采样参数，代码负责值域校验、缓存及部分用途关闭 thinking | `resolveGenerationParams`；`src/lib/promptRules.ts:219-250`、`src/lib/generationParams.ts:25-69,87-107,139-174` |
| `composeShot` | 生图多参考用途说明/防止抄参考图内容或构图；系统规则层内容与最终 `renderContent` 不一致风险 | `getActiveRenderRules`；`src/lib/promptRules.ts:541-565,1081-1107`、`src/lib/promptComposer.ts:282-359` |
| `negativeStrategy` | 仅提供通用画质瑕疵约束，并要求把局部禁项正向化；渲染设置 enabled 开关对 `renderContent` 路径未生效 | `useImageActions`、`useVideoActions`；`src/lib/promptRules.ts:567-577,1109-1135`、`src/features/wizard/useImageActions.ts:61-62`、`src/features/wizard/useVideoActions.ts:31-34` |
| `polish`（8 个 builtin 子提示） | 脚本文案、视觉提示、想法、运动、中文描述、角色九行描述、角色外观、对白；视觉/运动润色当前强制英文，与中文 SSOT 有冲突 | `BUILTIN_RULES polish.*` 经 `AiPolishField` 解析覆盖；`src/lib/promptRules.ts:595-739,1137-1205`、`src/components/ui/AiPolishField.tsx:96-124` |

**独立结构编辑提示词**（不属于以上 task 骨架）：角色九行描述 `SYSTEM_PROMPT_CHARACTER_DESCRIPTION_ZH`、资产 JSON 指令 `SYSTEM_PROMPT_ASSET_EDIT_ZH`、单镜修订中英两版 `SYSTEM_PROMPT_SHOT_EDIT_ZH/EN`、项目视觉方向编辑 `SYSTEM_PROMPT_VISUAL_DIRECTION_EDIT_ZH`；均要求结构化全量返回并保留未指定字段/纯视觉边界，另需维护 schema 同步。`src/lib/promptRules.ts:648-703`、`src/features/wizard/AssetEditor.tsx:82-109`、`src/features/wizard/VisualDirectionEditor.tsx:108-132`、`src/services/scriptService.ts:534-576`、`src/features/characters/useCharacterEditorActions.ts:169-194`

**合并与设置覆盖**：内置注册表包括 audit/参数任务，但 Settings 的自定义任务枚举只展示 `extractAssets/storyboardOutline/storyboardShot/characterAppearance/styleRef/composeShot/negativeStrategy/polish`。规则合并保留 builtin `renderContent`，设置面板编辑的是 `content`/`enabled`；实际需精准修复 `getActiveRenderRules` 对上述两个真实渲染任务不看 enabled、也不读取用户编辑后的 content 的问题。其它调用 `buildSystemPrompt`/`getActiveRuleText` 有 enabled 过滤，不能泛化为全部提示词开关失效。`src/components/SettingsDialog.tsx:58-61,216-280`、`src/lib/promptRules.ts:1243-1248,1251-1267,1276-1313`

**提示词质量 review 的边界**：当前最该先修的是可证实的结构契约与路由错误（新增资产键、renderContent 设置路径、子字段重写语言）；规则中的身份保持、可画性、单机位/单动作、motion 与 end-state 分离、参考图防抄构图是重要保护约束，应通过受控回归维持。模型是否实际遵循规则仍需真实生成抽样验证。

## 优先级建议

努力估算是初步范围，不是承诺；小型纯逻辑测试与手工判例包含在估计内，不包含真实用户研究/外部模型大量调用。

| 优先级 | 建议 | 证据 / 验收方向 | 估算 |
| --- | --- | --- | --- |
| **P1** | 修复 outline 新资产契约：提示词输出 `newCharacters/newScenes`，parser 消费 `characters/scenes`；选一套规范键并兼容历史模型响应。先加解析/写入回归，确认资产入库且后镜引用。 | `src/lib/promptRules.ts:353-359`、`src/services/scriptService.ts:321-339`、`src/features/wizard/useScriptActions.ts:368-379` | S（约 0.5–1.5 人日） |
| **P1** | 修复渲染注册表路径：设置中 `content/enabled` 需要映射至实际渲染；或为 `renderContent` 加专门 UI。当前只作用于 `composeShot/negativeStrategy` 的渲染器。增加 enabled/覆盖/导入用例。 | `src/components/SettingsDialog.tsx:58-61,216-280`、`src/lib/promptRules.ts:1243-1248,1276-1313` | S（约 1–2 人日） |
| **P1** | 修复产品参考图误用的类别归属/预算。`pickShotReferences` 中产品与角色共享额度变量/分支，产品引用可能未得到预期的独立名额；按用户是否优先产品展示选择显式策略，补总量与画幅预算纯函数测试。 | `src/lib/promptComposer.ts:282-314,337-359` | XS–S（约 0.5–1 人日） |
| **P2** | 统一“提示词语言”契约：决定结构化输入重写是否按项目语言输出；同步提示词、界面标签和 API 文本类型注释，并写双语项目回归测试。 | `src/lib/promptRules.ts:392-417`、`src/services/chatService.ts:127-155`、`src/stores/projectTypes.ts:201-213` | S（约 1–2 人日） |
| **P2** | 规范化用户可见的 HTTP 错误详情：保留错误类型/状态码等有用诊断，避免未经筛选的原始响应全文直接变成界面错误；分别覆盖文本、图片、视频创建错误分支。 | `src/services/ai/openai.ts:120-124,242-256`、`src/services/videoService.ts:262-265`、`src/features/wizard/WizardMessages.tsx:14-29` | S（约 1 人日） |
| **P2** | 明确长任务取消/放弃语义。图片与分镜提供能真实终止的中止链，或明示当前不能中止；视频放弃弹窗说明只清理本地跟踪、服务端可能仍运行。仅在服务端支持可靠取消时才承诺服务端停止。 | `src/features/wizard/useImageActions.ts:132-154`、`src/features/wizard/useScriptActions.ts:400-429`、`src/features/wizard/StepVideos.tsx:300-319`、`src/features/wizard/useVideoActions.ts:462-496` | M（约 2–4 人日，供应商取消能力未知） |
| **P2** | 明示最终文件生命周期：在成片预览旁区分“当前会话预览”与“下载到本地”；评估刷新/重进项目后是否需要恢复或保存成片。保留既有下载按钮。 | `src/features/wizard/StepAssembly.tsx:22-53,117-123,225-252` | XS（若只补说明，约 0.5 人日）；持久化另估 |
| **P3** | 在分镜生成等待状态呈现已完成数、失败镜头可重试范围及“不打断上下镜依赖”的停止行为；先测长脚本等待感受再考虑并发或架构变更。 | `src/features/wizard/useScriptActions.ts:400-449`、`src/features/wizard/StepStoryboard.tsx:210-257` | S–M，取决于是否新增暂停/停止 |

## 建议验证计划

1. **契约单测（不请求网络）**：用符合骨架的 outline JSON（`newCharacters` / `newScenes`）验证 parser、资产创建及下游引用；用规则注册表纯函数测试 enabled 开关、用户覆盖与 `renderContent` 的最终文本。用角色+产品+道具组合验证每一类别的预算和总上限。
2. **双语字段测试（不请求网络）**：对中文/英文项目的 `visualPrompt`、`motionPrompt` 子字段提交规则分别断言目标语言与字段保留；检查同镜 `visualPrompt` 和 `motionPrompt` 不被一次重写混淆。
3. **异步生命周期测试（伪造请求）**：单张图片请求中止、批量取消后新 worker 不启动、分镜取消后已完成镜头保留；视频“放弃”只改变本地状态且不冒充远端取消。测试网络与计时需 mock；按仓库测试约定不要引入浏览器/E2E 测试。
4. **受控生成抽样（需另行批准实际 API 用量）**：小样本覆盖主体物种/品种、产品标志特征、跨镜角色与场景连续、远/近景和三种画幅；由盲评者按身份一致、构图/景别符合、提示词遵循、镜头衔接、失败恢复打分。每次记录模型/参数/提示词版本、请求失败/重试、耗时及成本，区分单镜质量与剪辑成片质量。
5. **UX 观察**：围绕“何时开始生成、哪里审核、失败如何补做、视频放弃是否停止计费、成片如何保存”设计任务观察与短访谈；当前报告未执行此类研究，不预设结论。
6. **发布前复核**：验证提示词导入/恢复、持久化刷新、切项目、失败/重试与下载的状态转换；把真实 API 实验结果与静态代码事实分开记录，新增证据后再更新此历史快照的修订说明或另建审计。

## 未实测与结论边界

- 没有调用文本/图像/视频生成 API，没有生成或盲评任何作品，也没有进行用户访谈、走查或问卷。
- 没有通过真实 UI 验证组件交互；本文依据源码静态检查。代码中的注释可解释作者意图，但除对应实现也支持的内容外，不把注释当成已执行行为。
- 本文不估算真实质量提升、成本节省、错误发生率、取消成功率或用户满意度。所有这类结果均须按上方验证计划实测。
- “视频放弃”不等于“远端任务取消”；“成片预览临时”不等于“没有下载”；“失败时审核卡可见”不等于“失败镜头允许确认跳过”。
