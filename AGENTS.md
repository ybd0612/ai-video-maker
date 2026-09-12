# AI Video Maker — AI 一键成片

面向 AI 创作的短视频制作工具。主流程为 6 步向导（想法 → 角色资产 → 分镜 → 图片 → 视频 → 成片），底层为 Pipeline 架构（脚本 → 图片 → 视频 → 拼接），集成 Agnes AI 的文本、图像、视频三大模型，支持中英文切换。

## 技术栈

- React 19 + TypeScript + Vite
- Zustand v5 — 状态管理（localStorage 持久化）
- FFmpeg.wasm — 客户端视频拼接
- TailwindCSS v4 + Framer Motion — 样式与动画
- Lucide React — 图标库

## 项目结构

```
src/
├── i18n/                          # 轻量 i18n 系统（无第三方依赖）
│   └── index.ts                   # zh/en 翻译字典 + useT hook
├── pages/
│   └── ProjectWorkspace.tsx       # 主页面外壳（三栏：侧边栏 | 向导 | 编辑器）
├── features/
│   ├── wizard/                    # 6 步向导（主流程）
│   │   ├── CreationWizard.tsx     # 向导容器（步骤路由 + 状态机）
│   │   ├── StepIdea.tsx           # 步骤1：想法 + 画幅比例 + AI 对话
│   │   ├── StepAssets.tsx         # 步骤2：角色/场景/风格资产
│   │   ├── StepStoryboard.tsx     # 步骤3：分镜脚本
│   │   ├── StepImages.tsx         # 步骤4：镜头图片
│   │   ├── StepVideos.tsx         # 步骤5：视频生成
│   │   ├── StepAssembly.tsx       # 步骤6：成片拼接
│   │   ├── useWizardActions.ts    # 向导操作编排（含模块级幂等守卫注册表）
│   │   ├── ShotCard.tsx           # 分镜卡片（状态徽标 + 展开详情）
│   │   ├── PromptSubFields.tsx    # 提示词子字段编辑
│   │   ├── DualFrameToggle.tsx    # 首尾帧开关
│   │   └── ReviewCheckpoint.tsx   # 审核卡点
│   ├── characters/                # 角色编辑器（CharacterEditor）/ 面板（CharacterPanel）
│   ├── projects/                  # 项目管理面板（ProjectSidebar）
│   └── history/                   # 操作历史面板（HistoryPanel）
├── services/                      # 服务层
│   ├── rateLimit.ts               # 集中式用量限制器（RPM 节流 + Token Plan 配额追踪，单例）
│   ├── scriptService.ts           # 文本模型调用，生成结构化分镜（含 visualPrompt + motionPrompt）
│   ├── imageService.ts            # 图片生成（单张，使用 visualPrompt）
│   ├── videoService.ts            # 视频生成（异步创建 + 轮询 + 完成响应解析，使用 motionPrompt）
│   ├── chatService.ts             # AI 辅助：字段专家提示词 + 一键润色（polishText）
│   ├── renderService.ts           # FFmpeg.wasm 视频拼接
│   ├── pipelineService.ts         # 旧版一键流水线（兼容保留，非主流程）
│   └── ai/                        # AI 服务统一入口（OpenAI 兼容）
│       ├── factory.ts             # 服务工厂
│       ├── openai.ts              # chatCompletion / generateImage 实现
│       └── index.ts
├── stores/                        # Zustand stores
│   ├── projectStore.ts            # 多项目管理（projects[] + activeProjectId + history[]，localStorage 持久化，v1→v2 迁移）
│   └── settingsStore.ts           # 全局设置（apiKey/baseUrl/plan/language，localStorage）
├── lib/
│   ├── models.ts                  # AI 模型标识符常量（集中管理）
│   ├── plans.ts                   # 访问套餐与用量限制配置（RPM/配额单一事实源）
│   ├── fetchWithRetry.ts          # fetch 统一封装（超时 + 指数退避重试）
│   ├── promptUtils.ts             # 画面/运动提示词组合
│   ├── characterUtils.ts          # 角色描述注入
│   ├── assetNamespace.ts          # 角色命名空间与完整提示词
│   ├── promptComposer.ts          # 官方结构拼装器（六段式/图生图/多图合成/定妆照物种锁定/多参考选取）
│   ├── promptRules.ts             # 规则条目注册表（骨架 + 内置默认条目 + buildSystemPrompt/mergeRules）
│   ├── resolveBaseUrl.ts          # API 地址解析工具
│   └── validation.ts              # 校验工具（帧数计算、prompt 清理等）
├── components/
│   ├── SettingsDialog.tsx         # 设置对话框（API Key / Base URL / 套餐 / 语言）
│   ├── ApiKeyBanner.tsx           # API Key 缺失提示横幅
│   └── ui/                        # 通用 UI 组件
│       ├── ConfirmDialog.tsx      # 确认对话框
│       ├── ContextMenu.tsx        # 右键菜单
│       ├── HelpTooltip.tsx        # 帮助提示
│       ├── Lightbox.tsx           # 图片灯箱
│       ├── NumberInput.tsx        # 数字输入框
│       ├── IMEAwareTextarea.tsx   # 输入法兼容文本框
│       ├── AiPolishField.tsx      # 输入框 + 内嵌「润色 / 撤销」按钮（所有 AI 输入入口）
│       └── AiAssistDrawer.tsx     # 【已弃用】旧的多轮对话抽屉（无引用，保留参考）
├── styles/
│   └── globals.css                # 全局样式
├── App.tsx                        # 根组件
└── main.tsx                       # 入口文件
```

顶层另有 `tests/`（单元测试目录，见「测试约定」）与 `vitest.config.ts`（单元测试配置）。

## 命令

- `npm run dev` — 启动开发服务器（端口 5173）
- `npm run build` — TypeScript 检查 + Vite 生产构建
- `npm run preview` — 预览生产版本（端口 5180）
- `npm run test` — 运行单元测试（Vitest 单次执行）
- `npm run test:watch` — 单元测试 watch 模式

## 路径别名

`@/` 映射到 `src/`（通过 `vite.config.ts` 和 `tsconfig.json` 的 `paths` 配置）。

## 测试约定（单元测试）

本项目的测试**只做代码单元测试，禁止浏览器 / E2E 测试**（Playwright 已移除，勿再引入）。

- **运行器**：Vitest，配置在 `vitest.config.ts`（`environment: "node"`，仅复用 `@/` 别名，不加载 react / tailwind 插件）。
- **用例位置**：`tests/**/*.test.ts`，按被测模块镜像分层（`tests/lib/` 对应 `src/lib/`，`tests/services/` 对应 `src/services/`）。
- **不引入 jsdom**：需要 `localStorage` 的用例使用 `tests/helpers/localStorage.ts` 提供的轻量桩。
- **断言必须来自真实实现**：写用例前先读源码，禁止依据注释或文档猜测期望值。若发现实现与注释不一致（例：`isValidApiKey` 注释写「minimum 10 chars」，正则实际只要求 9 位），用例应锁定**真实行为**并加注释说明，让偏差可见而非被掩盖。
- **网络与时间一律伪造**：涉及重试 / 限流的用例必须用 `vi.stubGlobal("fetch", ...)` 与 `vi.useFakeTimers()`，禁止真实请求与真实等待。
- **单例隔离**：`rateLimiter` 等模块级单例有跨用例状态，需用 `vi.resetModules()` + 动态 `import()` 取新实例（见 `tests/services/rateLimit.test.ts`）。
- 注意 `tsconfig.json` 的 `include` 仅含 `src`，因此 `tests/` 与 `vitest.config.ts` **不参与 `npm run build` 的类型检查**，需靠 `npm run test` 自行保证正确性。

## 编码规范

- TypeScript `strict: true`，开启 `noUnusedLocals` / `noUnusedParameters`
- 使用 `verbatimModuleSyntax` — 类型导入必须用 `import type`
- `erasableSyntaxOnly: true` — 禁止使用需要运行时擦除的 TS 语法（如 enum）
- 状态管理使用 Zustand + persist 中间件，设置走 localStorage
- 图片和视频输出存储为 URL（由 AI 模型返回），不存储为 base64 或二进制 Blob
- Zustand persist 使用 version 字段 + migrate 函数处理数据结构变更
- 国际化使用自研 `useT()` hook，翻译键在 `src/i18n/index.ts` 的 `zh` / `en` 字典中
- 新增翻译键时必须同时添加 zh 和 en 两个字典
- 成片预览使用组件内 state 管理（blob URL 不持久化到 store，避免刷新后失效）
- **界面缩放与字号**：整体缩放由 `src/styles/globals.css` 的 `:root { font-size: 112.5% }` 统一控制（Tailwind 的尺寸/间距/字号类均以 rem 为单位）；**新增样式禁止写死 `text-[Npx]`**，小字用 `text-[0.625rem]` / `text-[0.6875rem]` 这类 rem 写法或 Tailwind 预设类，否则不参与整体缩放。需要整体调大/调小界面时只改这一个数字
- **黑白主题（2026-09-12 方案 A 落地）**：语义色 token 定义在 `src/styles/globals.css`（light 为默认值，`html[data-theme="dark"]` 覆盖，经 `@theme inline` 映射为 `bg-app` / `bg-surface` / `bg-raised` / `bg-hover` / `border-line(-soft/-strong)` / `text-ink~ink-5` / `accent` / `info` / `success` / `warn` / `danger` 等工具类，支持 `/xx` 透明度修饰符）。**新组件禁用 slate/red/emerald 等原始色类，一律用语义 token**；主题状态在 settingsStore（persist v3，默认 `light`），App.tsx effect 同步到 `<html data-theme>`，index.html 内联脚本防首帧闪白；顶栏 ☀️/🌙 按钮切换
- **验证方式**：本项目**不使用浏览器/预览服务做验证**（由用户本地手动确认界面效果）；AI 侧只跑 `npx tsc --noEmit` + `git diff --check` + `npm run build`

## Pipeline 架构

> 主流程已改为 6 步向导（`features/wizard/`），`pipelineService.ts` 为旧版一键流水线（兼容保留）。本节描述底层编排逻辑。

四阶段流水线，编排在 `src/services/pipelineService.ts`：

1. **脚本阶段** — 调用文本模型生成 4-6 个结构化分镜（scriptText + visualPrompt + motionPrompt + duration）
2. **图片阶段** — 为每个分镜生成参考图（使用 visualPrompt，并发度 3）
3. **视频阶段** — 为每个分镜生成视频（使用 motionPrompt，按套餐并发：免费档 1，企业 2，Token Plan 3；异步创建 + 5 秒轮询，单任务 30 分钟超时，任务注册等待 2 分钟）。请求参数：`mode=keyframe`（有首帧/尾帧时，字段为 `first_frame` / `last_frame`）或 `text`，`size` 固定 `"720P"`，画幅用 `aspect_ratio`，时长用 `seconds`（4-12 秒字符串）；轮询必须带 `model_name`
4. **拼接阶段** — FFmpeg.wasm concat demuxer 拼接所有视频为最终 MP4（支持 AbortSignal 取消：下载阶段中止 fetch，FFmpeg 阶段 terminate 进程）

- 并发控制使用 `Promise.allSettled`，确保所有 worker 完成后再检查状态
- 支持 AbortController 取消
- 支持单镜头重试（`runSingleShot`，跳过脚本阶段）
- 视频生成自动重试（最多 3 次，针对网络超时/5xx 等临时性故障）
- 失败视频的自动重试统一由向导视频步骤（`useWizardActions.generateVideosForStep`）接管

## 向导可靠性铁律（踩坑沉淀，改动时必须遵守）

- 批量生成（视频/图片/资产）必须用**模块级注册表**（`activeVideoTasks` / `activeImageTasks` / `activeAssetTasks`）做幂等守卫：同项目任务在跑时不重复启动，避免服务端任务重复创建（token 双倍消耗）。
- 每个批量任务用**独立 AbortController**，禁止共享 abortRef 互杀。
- 向导步骤的自动触发 effect 只依赖 `[shots.length]`，**禁止依赖 `*GenerationStarted` 标志**（批量生成内部会把它置 true，导致 effect 重入误杀进行中任务）。
- 刷新恢复：注册表为空时，残留 `videoing`→`imaged`、`imaging`→`scripted`；挂载时重置卡 true 的 `*GenerationStarted`，避免永久转圈。
- 异步结果一律按项目 ID 写回（`updateXxxByProjectId`），禁止用 active-project 版本，防串写。
- “重试失败 / 全部重新生成”按钮必须走批量生成函数（幂等 + 并发受控），禁止 forEach 并发 reroll。
- 视频完成响应解析链：`url`（顶层）→ `metadata.url` → `video_url` → `output.url` → `output.video_url` → `remixed_from_video_id`。
- **风格参考图必须先于资产图生成**（2026-09-12；B 方案后更新）：`generateAssetImages` 分两阶段——阶段 1 串行生成风格图（`generateStyleReference`，幂等 + activeAssetTasks 互斥，风格提示词由 AI 从 idea + 中文风格描述**零角色派生**，硬性禁止出现人物/生物），阶段 2 的角色/场景/产品任务经 `referenceImageUrls` 参考风格图（生图请求走 `extra_body.image[]` 多参考，`size` 用档位 `"1K"/"2K"` + `ratio`，不用精确像素）；风格图失败不阻塞资产生成（退化为文生图）。角色定妆照 prompt 已移除 `photorealistic` 硬编码与 `Portrait of / head and shoulders / looking at camera` 人像语汇（后者是"动物角色画成人"的推手之一，2026-09-12 实锤），改用 `promptComposer.composePortraitPrompt`（物种锁定句 + 全身设定）。
- `extractCharactersFromIdea` 成功写回后自动 `void generateStyleReference(targetProjectId)` 后台生成风格图（不阻塞进入步骤 2）；风格资产（`Asset.type="style"`）与风格提示词由 AI 派生（`ensureStyleAsset` 懒派生）。分镜图经 `pickShotReferences` 选取多参考（场景→角色→产品合计 ≤2 张，风格图恒占末位，总数 ≤3）；StepAssets 手动「重新生成风格图」传 `force=true` 覆盖已有图。
- **资产防重复（2026-09-12）**：`Asset.source` 标记来源（`extracted`=AI 提取 / `manual`=手动添加，缺省视为 extracted 兼容旧数据；`addAsset` 默认 manual）。重新提取是**替换式**：旧的 extracted 资产整体被新结果取代、manual 保留且与新结果重名时以手动版为准；有 extracted 资产时先弹 `confirmDialog`（列出将替换的名字）确认，取消则返回 `false` 不推进向导。模型对同一故事命名不稳定（「小兔子」/「小白兔」），**禁止改回纯追加式**。
- 分镜阶段 `generateScript` 已产出完整英文双提示词，**禁止二次翻译覆盖**（translateToMotion 已移除）。
- 分镜生成后必须**回填角色 ID 引用**：模型返回的 `activeCharacterIds` / `dialogues.characterId` 可能是自编 ID，需按「角色名 → store 角色 ID」映射统一回填（新资产由 `extractNewAssets` 建映射），匹配不到的对白置 `null`（归旁白），否则角色一致性（图片注入/定妆照参考）与对白归属会失效。
- 单镜头重roll（`rerollShot`）同样必须**回填对白/角色引用**（映射 + 无效清理），并把 `dialogues` / `activeCharacterIds` 一并写回，否则重roll后对白与脚本脱节。
- 步骤 1 资产提取走**轻量接口** `extractAssetsFromIdea`（只返回 characters/products/scenes JSON，maxTokens 1024，不生成分镜）；完整分镜生成仅在步骤 3 调用 `generateScript`，禁止用完整分镜生成做资产提取（token 浪费）。

## 双提示词系统

文生图和图生视频的提示词逻辑不同，拆分为两个字段：

- **visualPrompt**（文生图）：静态场景描述，包含主体+场景背景+光影色调+艺术风格
- **motionPrompt**（图生视频）：动态描述，包含主体动作+镜头运镜+环境变化

脚本生成阶段同时产出两套提示词，分别用于图片和视频生成。

## AI 辅助（内联润色 / 撤销）

可选增强功能，不影响一键成片主流程：

- 所有 AI 可辅助的输入框右下角**内嵌「润色」按钮**：一键把当前内容交给该字段的专家角色优化，结果自动回填（用户无需输入额外指令）
- 润色后可点「撤销」**逐步回退**到上一次润色前的内容；撤销栈为组件本地状态，随镜头 / 资产切换（`resetKey`）与刷新清空
- 统一走 `components/ui/AiPolishField.tsx`（输入框 + 内嵌按钮），润色请求走 `chatService.polishText`；**禁止再引入旁挂式 AI 入口**（输入框外的 ✨ 按钮 / 抽屉）
- 字段与专家系统提示词统一由**规则条目注册表** `lib/promptRules.ts` 管理（2026-09-12 B 方案）：`chatService.ts` 的 8 个 `SYSTEM_PROMPT_*` 常量已整体搬迁为注册表内置条目（polish 任务），`AiPolishField` 经 `resolvePolishSystemPrompt` 取生效版；用户可在设置对话框「提示词规则」Tab 查看/编辑/开关/新增/导入导出（存 `settingsStore.promptRules`，persist v2，同 id 覆盖内置，改规则即时生效零构建）；`scriptService` 的分镜/抽资产系统提示词同样走骨架（SKELETONS）+ 生效条目（`buildSystemPrompt`）拼装，动态 assets 上下文段在函数内拼装不入条目。**修改提示词规则优先改条目，不改代码**
- 边界行为：内容为空 / 无 API Key / 请求进行中时按钮自动禁用；失败就地显示原因（不弹窗）；润色结果与原文相同则不入撤销栈
- 按钮样式（用户两次微调后的定稿）：**只用图标不显示文字**（`h-5 w-5` 方形 + 图标 `size={12}`，含义靠 `title` 提示）；**不得紧贴输入框边框**——多行贴右下角留距（`bottom-2.5 right-2.5`，输入框配 `pb-9`），单行垂直居中（`top-1/2 -translate-y-1/2 right-2`，输入框配 `pr-16`）
- 旧的多轮对话抽屉 `AiAssistDrawer.tsx` **已弃用**（无任何引用，保留仅作历史参考）

## UI 交互约定

- **卡片的「进入编辑」统一为点击整张卡片**：`role="button"` + `tabIndex={0}` + Enter/Space 键盘可达 + `cursor-pointer` + `focus:border-emerald-500`，卡片上加 `title={t("characters.edit")}` 作为提示；**不再单独放铅笔按钮**（`Pencil` 图标已全项目移除）。角色卡片见 `wizard/StepAssets.tsx` 与 `characters/CharacterPanel.tsx`
- 卡片内的次级操作（删除等）**必须 `e.stopPropagation()`**，否则会连带触发卡片的进入编辑
- 界面整体缩放与字号规则见「编码规范」一节（rem 化，禁止写死 px 字号）

## 模型配置

- 模型标识符集中定义在 `src/lib/models.ts` 的 `MODELS` 常量中
- 服务层（scriptService / imageService / videoService）通过 `MODELS` 引用模型名
- 替换模型只需修改 `MODELS` 常量
- 当前模型（2026-09-12 升级至 2.5/3.0 世代，官方文档 https://wiki.agnes-ai.cn）：
  - 文本 `agnes-3.0-flash` — 512K 上下文 / 最大输出 65,536 Token，支持文本与图像 URL 输入，`chat_template_kwargs.enable_thinking` 控制 Thinking（默认关闭）
  - 图像 `agnes-image-2.5-flash` — 端点 `POST /v1/images/generations`，结果取 `data[0].url`；支持文生图 / 图生图 / 多图合成（image 参数为数组）
  - ⚠️ **图生图 / 多图合成的参考图必须放在 `extra_body.image`**（`"extra_body": {"image": [...], "response_format": "url"}`，官方文档要求）。放在请求体顶层会被服务端拒绝：403 `team_model_access_denied`，报错文案误导为"模型无权限"，实为参数位置错误（2026-09-12 实测踩坑）
  - 视频 `agnes-video-2.5-flash` — 仅支持 `size="720P"`，画幅用 `aspect_ratio`（16:9 → 1280x704），时长用 `seconds`（"4"~"12"），有首帧/尾帧时 `mode="keyframe"`（`first_frame` / `last_frame`），无图时 `mode="text"`；轮询必须带 `model_name`，成片 URL 在响应顶层 `url`
- ⚠️ 视频 2.5 Flash 与旧版 `agnes-video-v2.0` 参数体系不同（旧版 `num_frames`（8n+1、≤441）/ `frame_rate` / `width` / `height` / `image` / `last_image` 均已废弃，`calcNumFrames` 已无调用方），修改 `videoService.ts` 时勿混用两套参数
- API Key 和 Base URL 由用户在设置对话框中配置，存储在浏览器本地
- 📌 模型名/参数变更的**文档同步清单**（升级时必须逐处更新，改完 grep 全仓旧名确认零残留）：`src/lib/models.ts`（SSOT）、`README.md` 与 `README_EN.md`（特性表 + MODELS 代码块，中英口径一致）、`AGENTS.md`（本节 + Pipeline 架构章节）。`docs/` 下的历史评审报告与 `TEST_REPORT.md` 属历史实测记录，**不回改**。

## 用量限制与套餐（Rate Limit / Plan）

服务面向免费用户（默认 `default` 套餐），官方对各访问类型有 RPM 与订阅配额限制。这些限制已写入程序，在真实 API 调用前统一拦截，避免触发 429 / 配额超限。数据来源：`https://agnes-ai.cn/zh-Hans/docs/tokenplan`。

- **套餐（plan）**：用户在设置对话框选择，存入 `providerConfig.plan`，默认 `default`。共 5 档：`default`（免费）、`enterprise`（企业认证）、`starter` / `plus` / `pro`（Token Plan 订阅）。
- **配置单一事实源**：`src/lib/plans.ts` 的 `PLANS` 常量，集中定义各档 RPM 与订阅配额（文本/图片/视频）。替换或调整限制只改此处。
- **集中式限流器**：`src/services/rateLimit.ts` 的单例 `rateLimiter`。三类真实入口统一在调用前 `await rateLimiter.acquire(kind, opts)`：
  - 文本 — `src/services/ai/openai.ts` 的 `chatCompletion`
  - 图片 — `openai.ts` 的 `generateImage`（按 `imageSizeToTier(size)` 区分 1K/2K/3K/4K 档位）
  - 视频 — `src/services/videoService.ts` 的 `generateVideo`（cost = 请求时长秒数）
- **RPM 节流**：按模型种类（图片再按尺寸档位）做 60s 滑动窗口；达到上限即等待到最早一条滑出窗口。以官方「实际 RPM」作安全上限（更保守）。默认档视频 RPM=1，向导已按套餐同步并发（免费档 1、企业 2、Token Plan 3），不会同时显示多个“生成中”。
- **订阅配额（仅 Token Plan）**：文本（每 5h / 每周）、图片（每日张数）、视频（每日秒数）计数并持久化到 localStorage（key `wxhb-usage`），刷新不丢失。用尽抛出 `RateLimitError`（reason=`quota`），由 `pipelineService.isRetriableError` 识别为终态错误（消息不含瞬时关键字），不会进入视频自动重试。
- **取消**：`acquire` 支持 `AbortSignal`，取消时抛 `RateLimitError`（reason=`aborted`）。
- **套餐升级即生效**：用户切换套餐后，限流器实时读取 `providerConfig.plan`，无需刷新页面。

## 数据模型

- **Project**：项目（title / aspectRatio / style / language / shots / status / error / createdAt / updatedAt / styleReferenceUrl / styleReferenceError）
- **Asset**：统一资产（type: character / scene / product；name / description / prompt / imageUrl / error；character 另有 appearancePrompt / assetNamespace / fullPrompt / avatarUrl）——角色、场景、产品共用一套存储与参考链
- **Shot**：分镜（scriptText / visualPrompt / motionPrompt / duration / imageUrl / videoUrl / status / videoRetryCount）
- **HistoryEntry**：操作记录（projectId / action / description / timestamp）
- 项目状态流转：`idle → scripting → imaging → videoing → rendering → done`（可卡在 `failed`；向导内图片/视频批量完成后会复位为 `idle` 或 `failed`，成片拼接完成才置 `done`）
- 分镜状态流转：`idle → scripting → scripted → imaging → imaged → videoing → videoed`（可卡在 `failed`）
- 多项目存储：`projects[]` + `activeProjectId`，通过 `getActiveProject()` 派生活跃项目
- 历史记录保留最近 200 条，按日期分组展示；`addHistory(action, description, projectId?)` 支持异步任务完成后按发起项目写历史

## 多项目管理

- 左侧面板四个标签：**项目**（ProjectSidebar）、**分镜**（ShotList）、**角色**（CharacterPanel）、**历史**（HistoryPanel）
- 项目操作：创建 / 切换 / 删除 / 复制
- 复制项目时保留分镜结构，重置状态为 idle
- v1 → v2 存储迁移：旧单项目自动转换为新多项目格式

## 工作流约定（Agent 必须遵守）

每次完成代码编写任务后，执行以下流程：

1. **文档同步检查** — 审查相关文档（README.md、README_EN.md、AGENTS.md 等），确保与代码变动一致。如有新增/删除/重命名的文件、接口变更、功能变更等，必须同步更新文档（中英双语口径一致）。
2. **提交代码** — 使用 `git add` + `git commit` 提交所有变更，commit message 遵循约定式提交格式（`feat:` / `fix:` / `docs:` / `refactor:` 等）。只精确暂存业务文件，**禁止 `git add -A`**（`.workbuddy/` 等工具数据不入库）。
3. **推送代码** — 默认不推送；仅在用户明确要求 push 时执行 `git push`。

## 注意事项

- 项目只做**单元测试**（Vitest），**不使用浏览器 / E2E**；验证用 `npx tsc --noEmit` + `git diff --check` + `npm run test` + `npm run build`（dist 被占用时先 `rm -rf dist`）
- `.env.example` 中的 `VITE_*` 环境变量仅作参考，实际配置通过应用内设置对话框完成
- 模型调用无抽象层：`src/services/` 直接调用 Agnes API，不存在 adapter 中间层（旧 `src/providers/` 已在前一轮重构中移除，勿再引用）
- 视频/图片等外部 API 响应字段以**用户实测为准**，不要仅凭官方文档推断（实测：Agnes 视频成片地址在响应顶层 `url` 字段，非文档示例的 `metadata.url`）
