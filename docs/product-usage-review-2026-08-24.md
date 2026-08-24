# AI 一键成片：功能使用层全面调研报告

**日期**：2026-08-24
**范围**：6 步创作向导全流程、多项目管理、角色/分镜/对白编辑、历史记录、设置、限流配额、成片交付
**方法**：源码走查（wizard / stores / services / components 全部模块）+ 真实用户视角模拟边界场景
**前置**：已阅读 `docs/product-optimization.md` 与 `docs/user-journey-review-2026-08-18.md`，本文只收录**增量发现**；已修复项（异步按项目 ID 写回、StepAssembly 统一、部分视频拼接拦截、Blob 生命周期、删除按钮语义、localhost 代理）与已记录待优化项（生成任务取消、刷新后视频轮询恢复、失败镜头引导、示例项目、导入导出、模型选择）不重复展开，仅在相关条目中做交叉引用。

---

## 结论摘要

| 优先级 | 数量 | 主题 |
|---|---|---|
| P0 | 1 | 首次生成的角色 ID 引用断裂，对白归属与角色一致性失效 |
| P1 | 7 | 项目状态机多处卡死/语义错误；reroll 未按项目 ID 写回；顶栏遗留旧版一键成片入口；资产生成失败静默且标记卡死；全局禁用右键菜单；auto 模式无法返回上一步 |
| P2 | 14 | 复制项目步骤重置、i18n 遗漏、单镜头拼接、并发未吃满、死代码、失败无反馈等 |

---

## P0 — 数据正确性

### 1. 首次生成分镜时，对白/角色引用的 ID 与库中角色 ID 不一致

**影响**：`generateScript` 输出的 `dialogues[].characterId` 与 `shots[].activeCharacterIds` 是模型自行编造的 ID（如 `"char_1"`），而提取的新角色入库时由 `extractNewCharacters` 用 `newId("char")` 重新生成 ID（如 `"char_173999_1"`）。两套 ID 无映射关系，导致：
- 角色对白在 `DialogueEditor` 的 `<select>` 中找不到匹配 option，显示为空白/旁白，**对白与角色关联全部丢失**，用户需逐个手动重选；
- `activeCharacterIds` 无效时，`injectCharacterDescriptions` / `findBestReference` 找不到角色，**角色描述不注入图片提示词、角色定妆照不作为 img2img 参考**——角色一致性主功能在首轮生成（无已有角色时）直接失效。

**涉及位置**：
- `src/services/scriptService.ts`（L310-334 解析 shots 时原样保留 characterId；L364-376 仅对 `activeCharacterIds` 做了按角色名匹配的兜底，`dialogues` 无兜底）
- `src/features/wizard/useWizardActions.ts`（`extractNewCharacters` L43-58 生成全新 ID，不与模型 ID 关联）
- `src/features/shots/DialogueEditor.tsx`（L57-72 select 无法匹配无效 ID）

**复现条件**：项目尚无角色时直接进入步骤 3 生成分镜（或步骤 1 提取后模型未严格复用给定 ID），出现概率取决于模型遵循 prompt 的程度。

**建议**：
1. `generateStoryboard` 内建立「模型返回角色名 → 新角色 ID」映射（`extractNewCharacters` 返回映射表），生成 shots 后统一回填 `dialogues[].characterId` 与 `activeCharacterIds`；
2. 兜底清理：对映射后仍无法匹配的 ID 置 `null`（对白归旁白）或从 `activeCharacterIds` 移除，并提示用户；
3. `scriptService` 中对 `dialogues` 复用现有 `activeCharacterIds` 的 name→id 匹配逻辑。

---

## P1 — 明显影响使用体验

### 2. 项目状态机多处卡死 / 语义错误（侧边栏持续转圈）

**影响**：`project.status` 是侧边栏 `statusIcon` 的唯一数据源，以下路径会使其长期停留在"进行中"：
- **视频全部生成完成后卡 `videoing`**：`generateVideosForStep` 启动时置 `videoing`，完成后只清除 `videoGenerationStarted`，**从不复位 `status`**（仅当后续拼接成功才变 `done`）；
- **图片部分失败卡 `imaging`**：`generateImagesForStep` 仅在全成功时置 `done`，部分失败时保留 `imaging`；
- **脚本生成失败卡 `scripting`**：`generateStoryboard` 无 try/catch，异常向上抛给组件后 store 状态未被复位（对比 `extractCharactersFromIdea` 有失败复位，实现不一致）。

**涉及位置**：`src/features/wizard/useWizardActions.ts`（L167、L374/411、L490/563-568）；`src/features/projects/ProjectSidebar.tsx`（L59-73）

**建议**：统一在批量生成函数收尾处按结果复位 `project.status`（全部成功 → 与步骤一致的终态，如步骤 5 完成后不应显示"生成中"；存在失败 → `failed` 并携带失败摘要），并给 `generateStoryboard` 补 try/catch 失败复位（对齐 `extractCharactersFromIdea`）。

### 3. 单镜头重试（rerollShot / rerollImage）未按项目 ID 写回

**影响**：`rerollShot`（L171-219）与 `rerollImage`（L416-444）使用 active-project 版本 `setShotStatus` / `updateShot`。用户在重试生成期间切换项目，结果写入新项目（shotId 不匹配则静默丢弃），**原项目镜头永久卡在 `scripting`/`imaging`**。违反 AGENTS.md「异步结果一律按项目 ID 写回」铁律——`rerollVideo` 已用 ByProjectId 版本，这两个函数是漏网之鱼。

**涉及位置**：`src/features/wizard/useWizardActions.ts`（L182/196/217、L427/440/442）

**建议**：捕获 `targetProjectId` 后统一改用 `setShotStatusByProjectId` / `updateShotByProjectId`（与 `rerollVideo` 对齐）。

### 4. 顶栏遗留旧版「一键成片」入口，与向导主流程并存

**影响**：`ProjectWorkspace` 顶栏在 `shots.length > 0` 时显示 Run All / Cancel 按钮，调用 `runPipeline("")`。空 prompt 会跳过脚本阶段但**重新生成全部图片+视频**，且：
- 无幂等注册表守卫，与向导批量生成**并发产生重复服务端任务（token 双倍消耗）**；
- 全程使用 active-project 版本 store API（`setShotStatus`/`updateShot`/`setProjectStatus`），切换项目即串写；
- 向导进行中按钮仍可点击，用户极易误触。

**涉及位置**：`src/pages/ProjectWorkspace.tsx`（L172-193、L91-118）；`src/services/pipelineService.ts`（L47/75/83/88/114/118/134 等）

**建议**：从顶栏移除 Run All / Cancel（或仅在无向导项目时展示）；旧 pipeline 入口若需保留，至少补幂等守卫与 ByProjectId 写回。

### 5. 资产生成失败无任何反馈，且批量标记永久卡死

**影响**：
- `generateAssetImages` 内所有单任务失败只 `console.error`（L261/282/304），用户对失败完全无感；
- 收尾仅在全成功时清除 `assetGenerationStarted`（L328-334）；任一角色画像/风格图失败时标记保持 `true`。步骤 2 的「生成全部头像/场景」按钮以该标记做 `isGenerating` 禁用，**失败后按钮永久转圈禁用**（仅离开步骤再回来时被 StepAssets 挂载 effect 重置，且该 effect 不区分"刷新恢复"与"任务仍在后台运行的普通导航"，任务运行中切项目再回来也会误重置标记，造成 UI 与真实任务脱节）。

**涉及位置**：`src/features/wizard/useWizardActions.ts`（L245-307、L328-334）；`src/features/wizard/StepAssets.tsx`（L45-50、L77-93）

**建议**：失败时写回角色/场景的 `error` 字段并在 UI 展示重试入口；收尾按「全部成功/存在失败」两分支决定标记清除；挂载重置 effect 应仅在没有存活任务时生效（或改为按注册表状态判断）。

### 6. 全局禁用右键菜单，原生复制/粘贴菜单全部丢失

**影响**：`App.tsx` 对 `document` 全局 `contextmenu` preventDefault，而自定义 `ContextMenu` 组件**从未被任何业务代码使用**（死代码）。用户无法右键复制/粘贴/拼写检查——对以大量文本编辑为核心的创作工具体验损失明显。

**涉及位置**：`src/App.tsx`（L8-12）；`src/components/ui/ContextMenu.tsx`（无引用）

**建议**：移除全局拦截；如需保留自定义菜单，在明确挂载点使用 `ContextMenu`，其余区域放行原生菜单。

### 7. auto 模式无法返回上一步（自动推进 effect 弹回）

**影响**：`StepImages`/`StepVideos` 的 auto 推进 effect 依赖 `allImaged`/`allVideoed`。在 auto 模式下从步骤 5/6 返回上一步时，因内容已全部就绪，effect 立即把用户弹回后一步——**用户无法返回修改**（需先手动切成 semi-auto 才能返回，路径不可见）。

**涉及位置**：`src/features/wizard/StepImages.tsx`（L44-48）；`src/features/wizard/StepVideos.tsx`（L57-61）

**建议**：auto 推进只在「进入步骤时内容发生变化（从缺到齐）」触发，或记录用户手动导航标志；更简单方案：`wizardStep` 变更是用户操作时抑制自动推进一次。

### 8. 复制项目后步骤重置为 1，需连点 5 次「下一步」才能回到原进度

**影响**：`duplicateProject` 保留 `ideaPrompt`/`shots`（含 imageUrl/videoUrl）但把 `wizardStep` 重置为 1。复制已完成项目后，用户面对步骤 1 且无法跳过（步骤 2 需要角色/场景，若项目无角色则只能逐次点下一步）；若点「生成并继续」还会**重复消耗一次文本配额**重新提取。步骤 4/5 的自动生成判定基于 `!imageUrl`/`!videoUrl`，不会重新生成，因此本可直接进入步骤 6。

**涉及位置**：`src/stores/projectStore.ts`（`duplicateProject` L324-351）

**建议**：按复制内容推断 `wizardStep`（有 shots → 3；全有 imageUrl → 4；全有 videoUrl → 5；有成片 → 6），并考虑保留失败/错误字段的清理说明。

---

## P2 — 锦上添花

| # | 问题 | 影响 | 位置 | 建议 |
|---|---|---|---|---|
| 9 | 图片全部完成即置 `project.status = "done"` | 侧边栏显示"已完成"勾，但视频/成片尚未生成，与成片完成混淆 | `useWizardActions.ts` L411 | 引入步骤级终态（如 `images_ready`）或仅置 `idle` |
| 10 | 步骤 5「N 个排队中，免费档约 1 分钟/条」硬编码中文且"免费档"不准确（企业/Token Plan 同文案） | 英文界面混中文；文案误导 | `StepVideos.tsx` L78 | 走 i18n 并按套餐区分文案 |
| 11 | ProjectSidebar「未找到匹配项目」硬编码中文 | 英文界面混中文 | `ProjectSidebar.tsx` L135 | 补翻译键 |
| 12 | 单镜头项目拼接返回原始远程 URL（`videoUrls.length === 1` 直接 return），下载走跨域直连且 `a.download` 文件名不生效，`revokeObjectURL` 对非 Blob 无意义 | 单镜头成片下载体验损坏（可能打开新页面而非下载） | `renderService.ts` L177；`StepAssembly.tsx` L89-95 | 单镜头也包一层 Blob URL |
| 13 | 视频并发仅 2（`plan.rpm.video <= 1 ? 1 : 2`），Token Plan RPM=5 未吃满；AGENTS.md 前后描述矛盾（一处"Token Plan 5"，一处"Token Plan 2"） | Token Plan 用户长列表等待偏久；文档误导 | `useWizardActions.ts` L462；AGENTS.md | 按 accessType 映射并发（default 1 / enterprise 2 / tokenplan 3-5），并统一文档 |
| 14 | 历史面板 action 类型大量死代码：`script_generated`/`shot_regenerated`/`settings_changed` 无任何调用点；向导全部生成动作不记历史 | 历史记录信息量低，无法回溯生成操作 | `projectStore.ts` L137-146；`HistoryPanel.tsx` L14-24 | 在向导生成/重试成功时补 `addHistory`；删除无用类型 |
| 15 | `darkMode` 状态定义但全局无 UI 入口、无样式消费 | 死代码 | `settingsStore.ts` L23/37/46 | 移除或接入深色切换 |
| 16 | 步骤 1 AI 对话系统提示词（IDEA_SYSTEM_PROMPT）硬编码中文，英文界面下 AI 助手仍以中文回复 | 语言体验不一致 | `StepIdea.tsx` L18-31 | 按 `project.language` 提供 en 版 |
| 17 | `rerollShot` 重试 prompt 仅传 `Regenerate this shot: {scriptText}`，无主题/角色上下文 | 重试结果风格漂移 | `useWizardActions.ts` L188 | 附带 ideaPrompt 与角色摘要 |
| 18 | ReviewCheckpoint 的「确认图片」与「跳过审核」（manual 模式）行为完全相同（都直接进下一步） | 按钮语义重复，无确认差异 | `StepImages.tsx` L133-138；`ReviewCheckpoint.tsx` L40-56 | manual 的"跳过"应跳过预览确认或给出差异说明 |
| 19 | ShotList 删除分镜无确认；`GripVertical` 图标暗示可拖拽但未实现排序（`reorderShots` 无 UI） | 误删风险；图标误导 | `ShotList.tsx` L65/86-92 | 补轻量确认；隐藏图标或实现拖拽 |
| 20 | CharacterEditor 生成头像/外貌失败静默（注释"user can retry"但无提示） | 用户不知失败原因 | `CharacterEditor.tsx` L50/104 | 显示失败 toast 或错误行 |
| 21 | 成片生成后拼接按钮隐藏，无「重新拼接」入口（需修改视频后重进才可重拼） | 改画幅/素材后无法直接重拼 | `StepAssembly.tsx` L136 | 成片区追加「重新拼接」按钮（复用已有 Blob 释放逻辑） |
| 22 | 历史按 `MM-DD` 分组，跨年无法区分 | 时间线歧义 | `HistoryPanel.tsx` L44-48 | 非当年条目加年份 |
| 23 | 切换画幅后已生成的图片/视频不重新生成，拼接时 FFmpeg 降级重编码 | 用户改画幅后输出尺寸不匹配预期 | `ProjectWorkspace.tsx` L160-169 | 画幅变更时提示"需重新生成图片/视频"并给出跳转入口 |
| 24 | 顶栏 Base URL 只读，与 AGENTS.md「Base URL 由用户在设置对话框中配置」描述不符 | 文档与实现不一致；部分用户场景（代理/自建）受限 | `SettingsDialog.tsx` L206-213；AGENTS.md | 确认设计意图后同步文档，或放开可编辑 |

---

## 与既有文档的关系说明

- 已记录且**已修复**（未重复）：异步串项目（批量路径）、成片流程统一、部分视频拼接拦截、Blob 生命周期、删除按钮语义、localhost 代理、404 排查。
- 已记录**待优化**（本轮给出增量机制补充）：
  - 「生成任务取消 / 切换提示」→ 补充：`generateScript`/`chatCompletion` 全程无 AbortSignal，RPM 等待也不可中断（P2，并入 #13 附近）；
  - 「刷新后视频轮询恢复」→ 补充具体矛盾点：`VideoTaskCreatedError(stillRunning)` 保留的 `videoing` 状态在刷新后被 `stuckVideoing` 重置为 `imaged` 并重新提交，**可能创建重复服务端任务**，与"不重复创建"注释冲突（建议在 shot 上持久化 `serverVideoId` 用于刷新后按任务 ID 续轮询）。

## 验证边界

- 本轮为纯源码走查 + 状态机推演，未消耗真实 API 配额、未改动业务代码。
- 优先级按「数据正确性 → 状态健壮性 → 交互体验」排序；P0 问题 #1 的实际出现频率受模型行为影响，建议先在真实生成中抽查 `dialogues[].characterId` 是否能在 `project.characters` 中命中。

---

## 修复状态附录（2026-08-24 更新）

全部 22 个问题已按 P0 → P1 → P2 三批修复完成，每批均通过 `npx tsc --noEmit` + `git diff --check` + `npm run build` 验证：

| 批次 | 提交 | 覆盖问题 | 说明 |
|---|---|---|---|
| 1（P0） | `29fb381` | #1 | 角色 ID 回填（scriptService dialogues 兜底 + useWizardActions 映射回填 + DialogueEditor 渲染兜底） |
| 2（P1） | `9259f1a` | #2-#8 | 状态机复位、reroll 按项目写回、移除旧版一键入口、资产失败反馈与标记修复、右键菜单恢复、auto 模式可返回、复制项目步骤推断 |
| 3（P2） | `494fd2e` | #9-#24 | 状态语义、并发映射、i18n 补齐、单镜头 Blob 拼接、历史记录补全、死代码清理、失败提示等 |
| 模式与审核 | `04606bb` | 流程增强 | 自动化模式三档并两档（移除伪选项 manual）；审核卡点增强（失败镜头引导 + 配额提示） |
| 资产统一 | `ca642db` | 架构演进 | 角色/场景/产品统一为 Asset 资产体系（v8 迁移），新增产品资产链路（提取/参考图/一致性锚定） |
| 提取优化 | `c9e59b1` | 流程增强 | 场景资产 AI 自动提取（分镜回填）、步骤 1 轻量资产提取省 token、分镜卡片失败原因展示 |
| 流程闭环 | `73d2eb3` | 流程增强 | 分镜重生成确认与审核卡点、单镜头重roll写回对白、缺画面描述提示、rerollAll 成本确认、时长配额预估、拼接取消、后台任务切换提示 |

**待后续实测跟进**：
- #1 的角色 ID 回填逻辑已按「名字映射 + 无效清理」实现，建议在真实生成中抽查命中率（`dialogues[].characterId` 是否能命中 `project.characters`），如模型返回 ID 模式与名字差异过大，可进一步在系统提示词中强制模型使用角色名作为 ID。
- #13 的视频并发对 Token Plan 保守取 3（RPM=5 未吃满），如需榨满可调 `useWizardActions` 中 `videoConcurrency` 映射。

**报告范围外的新增优化**（2026-08-24 流程审查后实施，见上表 4-7 行）：自动化模式两档化、资产统一与产品资产、场景自动提取与轻量提取、分镜审核卡点与成本感知（rerollAll 确认 / 时长配额预估 / 拼接取消 / 后台任务切换提示）。
