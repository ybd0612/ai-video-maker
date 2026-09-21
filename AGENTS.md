# AI Video Maker — AI 一键成片

面向 AI 创作的短视频制作工具。主流程为 6 步向导（想法 → 资产 → 分镜 → 图片 → 视频 → 后期），底层按生成域编排（想法提取 → 风格母版 → 资产图 → 分镜 → 镜头图 → 镜头视频 → 本地拼接），集成 Agnes AI 的文本、图像、视频三大模型，支持中英文与黑白双主题。

## 技术栈

- React 19 + TypeScript + Vite
- Zustand v5 — 状态管理（localStorage 持久化）
- FFmpeg.wasm — 客户端视频拼接
- TailwindCSS v4 + Framer Motion — 样式与动画
- Lucide React — 图标库
- Vitest 4 — 单元测试（本项目只做代码单测，见「测试约定」）

## 项目结构

```
src/
├── main.tsx / App.tsx              # 入口（无路由库；App.tsx effect 同步 <html data-theme>）
├── pages/ProjectWorkspace.tsx      # 外壳：顶栏 + 左栏项目列表 + 向导主区（+ 可折叠底部日志坞）
├── i18n/index.ts                   # zh/en 字典 + useT（自研，零第三方依赖）
├── features/
│   ├── wizard/                     # 6 步向导
│   │   ├── CreationWizard.tsx      # 步骤路由 + 「下一步」唯一门禁表 canAdvance
│   │   ├── StepIdea / StepAssets / StepStoryboard / StepImages / StepVideos / StepAssembly
│   │   ├── StepIndicator / AutomationModeSwitch / ReviewCheckpoint
│   │   ├── useScriptActions.ts     # 分镜域：想法提取、大纲+逐镜头、改写、重roll（activeScriptTasks）
│   │   ├── useAssetActions.ts      # 资产域：风格母版链、资产图批量（activeAssetTasks）
│   │   ├── useImageActions.ts      # 镜头图片域（activeImageTasks）
│   │   ├── useVideoActions.ts      # 镜头视频域（activeVideoTasks）
│   │   ├── useWizardActions.ts     # 35 行门面，只组合上述四个域（不再是主实现文件）
│   │   ├── wizardActionUtils.ts    # 域间共享的写回与守卫工具
│   │   ├── VisualDirectionEditor.tsx / AssetEditor.tsx / AssetEditorTemplate.tsx
│   │   ├── AssetListSection.tsx / ShotListSection.tsx / ShotDetail.tsx / ShotCard.tsx
│   │     （统一详情外壳 AssetDetailShell 由 AssetEditorTemplate.tsx 导出，资产与镜头详情共用）
│   │   ├── shotStatus.tsx / PromptField.tsx / PromptSubFields.tsx / DualFrameToggle.tsx
│   │   └── ExpandableSection.tsx   # 零引用孤儿，待清理
│   ├── characters/                 # CharacterEditor.tsx + useCharacterEditorActions.ts（外貌派生与定妆照）
│   ├── projects/ProjectSidebar.tsx # 项目创建 / 切换 / 复制 / 删除 + 搜索 / 排序
│   └── script/ScriptPanel.tsx、preview/FinalPreview.tsx、preview/ShotPreview.tsx   # 零引用孤儿，待清理
├── services/
│   ├── ai/                         # factory.ts（provider 工厂）+ openai.ts（chatCompletion / generateImage）
│   ├── scriptService.ts            # 视觉方向提取与自检、按类资产提取、分镜大纲 + 逐镜头、镜头改写
│   ├── imageService.ts             # 单张生图、aspectRatioToImageParams（size 恒 1K）
│   ├── videoService.ts             # 视频创建、轮询、完成响应解析、VideoTaskCreatedError
│   ├── chatService.ts              # 润色与子字段回写；re-export 注册表里的 SYSTEM_PROMPT_*
│   ├── renderService.ts            # FFmpeg.wasm 拼接（单视频短路、dev CDN 代理、可取消）
│   └── rateLimit.ts                # rateLimiter 单例：RPM 滑窗 + Token Plan 配额
├── stores/
│   ├── projectTypes.ts             # 全部领域类型（AssetType / ShotStatus / VisualDirection / *Details）
│   ├── projectStore.ts             # 多项目 + persist（key wxhb-project，version 16）
│   ├── projectMigrations.ts        # v1→v16 迁移，导出纯函数便于单测
│   ├── projectOps.ts               # 级联失效规则（applyShotUpdates / applyAssetUpdate）
│   └── settingsStore.ts            # apiKey/baseUrl/plan/theme/language/promptRules（wxhb-settings，v4）
├── lib/
│   ├── models.ts / plans.ts        # 模型标识符、套餐与限额（两个单一事实源）
│   ├── promptRules.ts              # 提示词骨架 SKELETONS + 内置条目 BUILTIN_RULES + buildSystemPrompt
│   ├── promptComposer.ts           # 六段式 / 图生图 / 多图合成 / 定妆照物种锁定 / 多参考选取
│   ├── promptUtils.ts / validation.ts / resolveBaseUrl.ts / fetchWithRetry.ts
│   ├── assetDetails.ts / extractAssets.ts / assetNamespace.ts / characterUtils.ts
│   ├── shotFields.ts / shotReferences.ts / generationParams.ts / refineContent.ts
│   ├── batchRunner.ts              # createBatchRunner：注册表 + recoverStuck + 受控并发 + finally 清理
│   ├── jsonResponse.ts             # 模型 JSON 响应解析与容错
│   └── logger.ts / logStorage.ts / devDump.ts / dumpSanitize.ts   # 运行日志与调试落盘（会读写 store / localStorage）
├── components/                     # SettingsDialog / ApiKeyBanner / LogConsoleDock + ui/*
└── styles/globals.css              # :root 字号缩放 + 黑白主题语义色 token

tests/                              # Vitest 用例，按 src 分层镜像；helpers/localStorage.ts 为轻量桩
docs/                               # 现行参考在顶层；快照在 docs/history/；规划在 docs/roadmap/；索引 docs/index.md
vite-plugins/debugDumpPlugin.ts     # 仅 dev：脱敏 store 快照写 debug-dump/state.json
scripts/run-vitest.mjs              # Windows 盘符规范化后启动 Vitest
```

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

- **运行器**：Vitest 4.1.11，配置在 `vitest.config.ts`（`environment: "node"`，仅复用 `@/` 别名，不加载 react / tailwind 插件）。`npm run test` / `npm run test:watch` 统一经 `scripts/run-vitest.mjs` 启动：Windows 下先用 `fs.realpathSync.native` 规范化项目 cwd，规避 Vitest runner 的盘符大小写问题。
- **用例位置**：`tests/**/*.test.ts`，按被测模块镜像分层（`tests/lib/` 对应 `src/lib/`，`tests/services/` 对应 `src/services/`）。
- **不引入 jsdom**：需要 `localStorage` 的用例使用 `tests/helpers/localStorage.ts` 提供的轻量桩。
- **断言必须来自真实实现**：写用例前先读源码，禁止依据注释或文档猜测期望值。若发现实现与注释不一致（例：`isValidApiKey` 注释写「minimum 10 chars」，正则实际只要求 9 位），用例应锁定**真实行为**并加注释说明，让偏差可见而非被掩盖。
- **网络与时间一律伪造**：涉及重试 / 限流的用例必须用 `vi.stubGlobal("fetch", ...)` 与 `vi.useFakeTimers()`，禁止真实请求与真实等待。
- **单例隔离**：`rateLimiter` 等模块级单例有跨用例状态，需用 `vi.resetModules()` + 动态 `import()` 取新实例（见 `tests/services/rateLimit.test.ts`）。
- 注意 `tsconfig.json` 的 `include` 仅含 `src`，因此 `tests/` 与 `vitest.config.ts` **不参与 `npm run build` 的类型检查**，需靠 `npm run test` 自行保证正确性。

## 基础编码规范

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

## 编码规范（结构化、变量化、复用）

本节是本项目新增和修改代码的强制规范。已有代码若与本节冲突，先记录真实影响和整改范围，再按最小 diff 逐步收敛；不得为了“统一风格”进行无边界重构。

### 1. 设计总则

- **先分层，再实现**：先明确数据模型、领域规则、服务调用、状态写回和 UI 展示分别属于哪一层；不把所有逻辑堆进页面组件或一个超大 Hook。
- **单一职责**：函数、组件、服务和 Store action 只负责一个清晰职责；输入校验、数据规范化、API 调用、状态写回、UI 提示尽量分开。
- **数据驱动**：能用类型、配置、规则表、映射表表达的内容，不用重复的条件分支和散落字面量表达。
- **边界清晰**：组件负责交互和展示，`features` 负责业务编排，`services` 负责外部服务，`lib` 负责无副作用的领域工具，`stores` 负责状态与持久化。
- **先复用后新增**：新增函数前必须搜索现有 `lib/`、`services/`、`stores/` 和同功能 feature，确认没有可直接复用的实现；不能仅因为调用位置不同就复制一份相同逻辑。

### 2. 结构化代码

- 业务流程按“输入 → 规范化 → 校验 → 执行 → 结果解析 → 状态写回”组织，禁止把多个阶段隐式混在一个条件分支中。
- 外部 API、模型响应、持久化数据、用户导入数据一律先视为 `unknown`，经过运行时校验或 type guard 后才能进入领域类型。
- 领域数据使用明确接口、字面量联合类型和显式映射；避免用 `Record<string, unknown>` 或无约束 `string` 掩盖真实业务结构。
- 页面组件不得直接拼接 API URL、直接 `fetch`、解析第三方响应或实现重试；这些逻辑必须由服务层和共享工具承接。
- 同一业务语义只能有一个权威实现。例如风格参考图、项目写回、视频时长规范化、Prompt 拼装和 Base URL 归一化，不允许页面各自实现一套规则。
- 抽取共享函数时以“相同业务语义”为依据，而不是只看代码长得像；如果两个流程未来可能独立演进，应保留清晰边界并共享底层纯函数。

### 3. 文本变量化

- 所有用户可见文本（标题、按钮、placeholder、title、错误、空状态、确认文案）必须进入 `src/i18n/index.ts`，同时维护 `zh` / `en`；禁止在 JSX 中散落中文或英文。
- 所有长 Prompt、系统规则、模型输出格式要求统一进入 `src/lib/promptRules.ts` 的规则注册表；组件和服务只传递规则 ID、动态上下文或变量，不新增无法覆盖的长 Prompt。
- Prompt 的静态规则与动态数据分离：项目想法、角色、场景、产品、用户输入通过明确占位或上下文注入，不复制成多份静态模板。
- 错误信息按错误类型和翻译键管理；服务层不得在多个文件重复拼接同一错误文案。需要携带诊断信息时使用结构化错误字段，展示层再翻译和格式化。
- 文本进入 API 或 Store 前必须明确规范化策略：普通单行文本可 `trim`，Prompt 需保留必要换行；不得在不同入口对同一字段采用不同清洗规则。

### 4. 参数变量化与单一事实源

- 禁止硬编码会变化、会计费、会影响协议或会影响产品行为的事实，包括模型名、API 地址、套餐 RPM/配额、超时、重试次数、并发度、视频时长、画幅、尺寸档位、分镜数量、Prompt、用户文案和 magic number。
- 这类参数必须放入职责明确的配置或策略模块，并通过类型和白名单约束；例如模型放 `lib/models.ts`，套餐放 `lib/plans.ts`，视频策略应集中维护最小/最大/默认时长、允许选项和计费口径。
- 同一参数必须从同一规范化结果派生出 UI 展示、API 请求、配额计算、日志和测试断言；禁止“原始值用于计费、修正值用于请求”这类分裂语义。
- API 参数使用领域类型，例如 `ImageSizeTier`、`ImageRatio`、视频画幅联合类型；不要为了省事把参数声明为 `string`。
- 固定协议字段名和算法必要常量可以存在，但必须使用有意义的命名常量或类型表达，不能用无法解释的裸数字；一次性局部实现也不得隐藏业务规则。
- 配置按领域拆分，不建立一个包含所有开关的巨型配置对象；环境差异、用户可配置项、协议常量和产品策略分别归位。

### 5. 相同/相似逻辑的复用规则

- 新增同类方法前先回答：已有实现在哪里？差异是参数不同还是业务语义不同？能否抽成纯函数、策略函数或领域服务？
- 两个以上入口共享“生成请求 + 参数转换 + 错误处理 + 结果写回”时，优先抽取共享领域函数；UI 只提供输入和回调，不复制服务流程。
- 共享函数必须显式接收依赖和参数，禁止通过隐式全局状态、当前活动项目或闭包变量改变行为。
- 复用不能牺牲可读性：单次使用、尚未稳定的逻辑不提前抽象；抽取后必须保留清晰命名、输入输出类型和边界测试。
- 修复一个入口后必须搜索同类入口，确认没有同样缺陷；新增规则、参数或错误处理时同步检查批量、单项、重试和手动入口。

### 6. API、异常与安全

- 所有 AI 请求必须经过统一服务层、统一 Base URL 归一化、统一超时和错误解析；组件不得直接访问供应商接口。
- 非幂等的图片/视频生成 POST 禁止直接套用通用自动重试；只有服务端提供幂等键、请求 ID 或任务恢复机制时才允许创建请求重试。
- 长请求、轮询、下载、FFmpeg 和退避等待必须支持 `AbortSignal`；用户取消不得进入下一轮重试或继续占用资源。
- 区分参数错误、配额耗尽、用户取消、网络错误、服务端任务已创建但轮询失败和内容安全错误；禁止只靠错误字符串判断业务状态。
- API Key、Token、Cookie、真实请求头和个人数据禁止进入源码、文档、测试 fixture、日志、截图、构建产物和 CI artifact。调试落盘必须先脱敏；发现历史凭证时先轮换，再处理 Git 历史清理。
- 所有用户输入和外部响应都视为不可信；展示前避免 HTML 注入，拼接 URL/正则/文件名时必须做边界处理。

### 7. 异步任务与状态写回

- 跨 `await` 的操作必须在开始时捕获 `targetProjectId`；完成、失败、进度、定时器和 fire-and-forget 回调都只能按目标 ID 写回。
- 异步流程禁止使用 `updateProject`、`updateShot`、`updateAsset`、`setWizardStep` 等只作用于 active project 的 action，除非操作已证明不会跨项目；优先使用 `ByProjectId` 版本。
- 批量任务必须使用模块级注册表做幂等守卫、独立 `AbortController`、受控并发和 `finally` 清理；任务、监听器、定时器与 Blob URL 不得跨批次遗留。
  - ⚠️ **这是目标态，不是已实现能力**（2026-09-21 实测）：全仓 `controller.abort()` 只有 5 处（`StepAssembly.tsx:114`、`fetchWithRetry.ts:106,115`、`renderService.ts:109,112`），**批量生成没有任何用户级取消入口**；切项目、离开步骤、组件卸载都不中断在飞请求与视频轮询（`docs/execution-flow.md` §9.3）。补齐前禁止宣称「所有 AI 请求可取消」。
- `Promise.all` / `Promise.allSettled` 的选择必须表达业务语义：需要收集所有任务结果时使用 `allSettled`，需要失败即停时才使用 `all`；禁止无意吞掉异常。
- fire-and-forget 必须显式处理 rejection；进度回调不得写入已经不存在或已切换的项目。

### 8. TypeScript、测试与完成标准

- 保持 `strict`、`noUnusedLocals`、`noUnusedParameters`、`verbatimModuleSyntax` 和 `erasableSyntaxOnly`；类型导入使用 `import type`。
- 禁止用 `as any`、`as never`、`@ts-ignore` 或 `@ts-expect-error` 绕过业务类型；动态字段更新使用 `keyof`、映射类型或显式字段映射。
- 纯函数、配置解析、Prompt 拼装、API 请求体、外部响应解析、Store 迁移、限流、批量执行、取消、重试耗尽、跨项目写回和资源清理必须有 Vitest 单元测试。
- 网络和时间一律伪造；单例模块按现有约定使用 `vi.resetModules()` 隔离；本项目不引入浏览器/E2E 测试。
- 已知缺陷的 characterization test 必须标注“锁定现状而非期望行为”；修复缺陷时先更新测试期望，再修改实现。
- 每次提交前至少完成：结构/硬编码/复用自检、`npx tsc --noEmit`、`git diff --check`、适用的单元测试和 `npm run build`；结果必须如实记录。
- 功能、接口、模型参数、配置、目录结构或编码规则变更时，同一次工作同步相关文档；关键事实先改 SSOT，再扫描旧值残留。

## 现状与待办（入口）

- 本文只承载**长期工程约定**；时点性审计已迁出为 `docs/history/2026-09-13-agents-audit.md`（入库即冻结）。
- **文档口径冲突 / 未决事实**：看 `docs/index.md` §4 冲突登记（C1–C17，带 `文件:行` 证据）。
- **代码级待办与可疑点**：看 `docs/execution-flow.md` §12（18 条，按影响排序）。
- **能力缺口与演进规划**：看 `docs/roadmap/competitive-gap-2026-09-21.md`。

仍然有效的红线（不与上述三份重复，改代码必须遵守）：

- **P0 安全**：发现疑似密钥泄露时停止提交与传播，先轮换再脱敏，并评估 Git 历史清理范围。
- **P1 非幂等重试**：图片创建与视频创建在没有幂等键 / 任务恢复协议前，不得继续扩大创建请求的自动重试。
- **P1 多项目写回**：跨 `await` 一律按 `targetProjectId` 写回，禁止 active-project action 参与异步链路。
- **P1 取消链路**：新增生成入口必须贯通 `AbortSignal`；补齐前不得宣称「所有 AI 请求可取消」（现状见上方铁律注）。
- **P1 质量门禁**：`npm run test` 现为 30 文件 / 393 用例通过（2026-09-21 实测）；**CI 仍不跑测试**，把它加成部署前门禁是待办。
- **P1 数据契约**：镜头时长与数量口径已收敛（时长 `{4,5,8}` 白名单 + 数量交模型判断）；`scriptService` 之外仍缺统一的`unknown → 解析 → 运行时校验 → 重试/报错` 链路（按类资产提取已具备）。

## Pipeline 架构（现行链路的权威描述在 docs/execution-flow.md）

6 步向导即运行期编排：想法提取（视觉方向链 ∥ 资产链）→ 风格母版 → 资产图 → 分镜（大纲 → 逐镜头）→ 镜头图片 → 镜头视频 → 本地拼接。
旧版一键流水线 `pipelineService.ts` 已删除（零引用死代码），`useWizardActions.ts` 已拆为四个域 hook。
**逐步骤的触发点、请求体、写回与门禁不要在本文件查证**，看 `docs/execution-flow.md`（现行、带 `文件:行`）与
`docs/execution-flow-diagrams.md`（参数进出）；本节只留跨阶段稳定约定：

- 提示词双轨：`visualPrompt` 喂生图、`motionPrompt` 喂视频，均由分镜阶段一次产出，禁止二次翻译覆盖。
- 参考图注入走 `extra_body.image[]`；风格母版与场景图不进参考图（只以文本注入）。
- 并发：资产 / 镜头图片 / 分镜逐镜头各 3；视频按套餐 1（免费）/ 2（企业）/ 3（Token Plan）。
- 视频参数体系：`mode=keyframe`（有首帧或尾帧，字段 `first_frame` / `last_frame`）或 `mode=text`，`size` 固定 `"720P"`，画幅 `aspect_ratio`，时长 `seconds`（4–12 秒字符串）；轮询必须带 `model_name`。
- 成片地址解析链以**实测**为准：`url`（顶层）→ `metadata.url` → `video_url` → `output.url` → `output.video_url` → `remixed_from_video_id`。
- 批量用 `createBatchRunner` + 四张模块级注册表；`Promise.allSettled` 收集全部结果，需要失败即停时才用 `all`。
- 单镜头重roll 必须回填对白与资产引用（名称→store ID 映射，匹配不到的对白置 `null` 归旁白）。

## 向导可靠性铁律（踩坑沉淀，改动时必须遵守）

- 批量生成（视频/图片/资产）必须用**模块级注册表**（`activeVideoTasks` / `activeImageTasks` / `activeAssetTasks`）做幂等守卫：同项目任务在跑时不重复启动，避免服务端任务重复创建（token 双倍消耗）。
- 每个批量任务用**独立 AbortController**，禁止共享 abortRef 互杀。
- 向导步骤的自动触发 effect 只依赖 `[shots.length]`，**禁止依赖 `*GenerationStarted` 标志**（批量生成内部会把它置 true，导致 effect 重入误杀进行中任务）。
- 刷新恢复：注册表为空时，残留 `videoing`→`imaged`、`imaging`→`scripted`；挂载时重置卡 true 的 `*GenerationStarted`，避免永久转圈。
- 异步结果一律按项目 ID 写回（`updateXxxByProjectId`），禁止用 active-project 版本，防串写。
- “重试失败 / 全部重新生成”按钮必须走批量生成函数（幂等 + 并发受控），禁止 forEach 并发 reroll。
- 视频完成响应解析链：`url`（顶层）→ `metadata.url` → `video_url` → `output.url` → `output.video_url` → `remixed_from_video_id`。
- **风格母版必须先于资产图生成，但不作为 i2i 参考图**（2026-09-12 建立，2026-09-15 修订）：`generateAssetImages` 分两阶段——阶段 1 串行生成风格图（`generateStyleReference`，幂等 + `activeAssetTasks` 互斥；风格提示词由 AI 从中文风格描述 + 视觉方向六维**零角色派生**，再经 `stylePromptAudit` 越界自检），阶段 2 的角色 / 场景 / 主体 / 道具任务**只以英文 `stylePrompt` 文本注入**生图 prompt，不传风格图作参考（参考图内容会被整体复制，2026-09-15 实锤）；风格图失败不阻塞资产生成。生图请求走 `extra_body.image[]` 多参考，`size` 恒 `1K` + `ratio`（`imageService.aspectRatioToImageParams`；2K/3K/4K 仅在 `plans.ts` 预留，全仓无调用点产生）。定妆照用 `promptComposer.composePortraitPrompt`（物种锁定句 + 全身设定，已移除 `photorealistic` 与 `Portrait of / head and shoulders / looking at camera` 人像语汇）。
- 步骤 1 两条链**并行**（`Promise.allSettled`）：链 A 视觉方向（提取 + `visualDirectionAudit` 自检，完成即写 `wizardStep: 2`），链 B 按类资产提取（character/scene/product/prop 各一次请求）；两链都成功后 fire-and-forget 依次跑 `generateStyleReference(targetProjectId)` → `generateAssetImages(undefined, targetProjectId)`（顺序不可颠倒）。风格资产（`Asset.type="style"`）由 `generateStyleReference` 内部**懒建**（`ensureStyleAsset` 函数已不存在，2026-09-21 已清掉残留注释）。分镜图经 `pickShotReferences` 取多参考：**只有 角色定妆照 → 主体 → 道具**，场景图与风格母版都不进参考（代码上限 4 张，旧口径「≤2 张 / 风格图恒占末位 / 总数 ≤3」全部作废）。StepAssets 手动「重新生成风格图」传 `force=true` 覆盖已有图。
- **资产防重复（2026-09-12）**：`Asset.source` 标记来源（`extracted`=AI 提取 / `manual`=手动添加，缺省视为 extracted 兼容旧数据；`addAsset` 默认 manual）。重新提取是**替换式**：旧的 extracted 资产整体被新结果取代、manual 保留且与新结果重名时以手动版为准；有 extracted 资产时先弹 `confirmDialog`（列出将替换的名字）确认，取消则返回 `false` 不推进向导。模型对同一故事命名不稳定（「小兔子」/「小白兔」），**禁止改回纯追加式**。
- 分镜阶段（`generateStoryboardOutline` + 逐镜头 `generateStoryboardShot`）已产出完整英文双提示词，**禁止二次翻译覆盖**（translateToMotion 已移除）。
- 分镜生成后必须**回填角色 ID 引用**：模型返回的 `activeCharacterIds` / `dialogues.characterId` 可能是自编 ID，需按「角色名 → store 角色 ID」映射统一回填（新资产由 `extractNewAssets` 建映射），匹配不到的对白置 `null`（归旁白），否则角色一致性（图片注入/定妆照参考）与对白归属会失效。
- 单镜头重roll（`rerollShot`）同样必须**回填对白/角色引用**（映射 + 无效清理），并把 `dialogues` / `activeCharacterIds` 一并写回，否则重roll后对白与脚本脱节。
- 步骤 1 资产提取走**按类轻量接口** `extractAssetsByType`（每类一次请求，只返回该类 JSON，代码再做越界兜底过滤）；完整分镜仅在步骤 3 走 `generateStoryboardOutline` + `generateStoryboardShot`，禁止用完整分镜生成做资产提取（无谓的重复请求）。
- **镜头数量不写死**（2026-09-21 产品决定）：由模型按想法的叙事复杂度与节奏自行判断，载体是 `promptRules.ts` 的 `storyboardOutline` 骨架第 1 条与内置条目 `storyboard.shot-count`（用户可在设置里覆盖）。**代码与文档一律不得再出现「4-6 个 / 4-8 个」这类固定区间**；镜头时长仍受结构约束（`duration` 只允许 4 / 5 / 8 秒）。
- **文本模型输出预算统一为 `MAX_OUTPUT_TOKENS`（65536，见 lib/models.ts）——效果优先，禁止为各任务单独设小预算**（预算过小会导致输出截断、JSON 断裂）。

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
- 字段与专家系统提示词统一由**规则条目注册表** `lib/promptRules.ts` 管理（2026-09-12 B 方案）：`chatService.ts` 早期的 `SYSTEM_PROMPT_*` 常量已迁为注册表内置条目（polish 任务），`chatService` 现在只 re-export 其中 7 个（`chatService.ts:41-49`）；角色 / 资产 / 视觉方向三个编辑提示词实际定义在 `promptRules.ts`，`AiPolishField` 经 `resolvePolishSystemPrompt` 取生效版；用户可在设置对话框「提示词规则」Tab 查看/编辑/开关/新增/导入导出（存 `settingsStore.promptRules`，persist v2，同 id 覆盖内置，改规则即时生效零构建）；`scriptService` 的分镜/抽资产系统提示词同样走骨架（SKELETONS）+ 生效条目（`buildSystemPrompt`）拼装，动态 assets 上下文段在函数内拼装不入条目。**修改提示词规则优先改条目，不改代码**
- 边界行为：内容为空 / 无 API Key / 请求进行中时按钮自动禁用；失败就地显示原因（不弹窗）；润色结果与原文相同则不入撤销栈
- 按钮样式（用户两次微调后的定稿）：**只用图标不显示文字**（`h-5 w-5` 方形 + 图标 `size={12}`，含义靠 `title` 提示）；**不得紧贴输入框边框**——多行贴右下角留距（`bottom-2.5 right-2.5`，输入框配 `pb-9`），单行垂直居中（`top-1/2 -translate-y-1/2 right-2`，输入框配 `pr-16`）
- 旧的多轮对话抽屉 `AiAssistDrawer.tsx` 已于 2026-09 结构收敛重构中删除（零引用死代码）；**禁止再引入旁挂式 AI 入口**

## UI 交互约定

- **卡片的「进入编辑」统一为点击整张卡片**：`role="button"` + `tabIndex={0}` + Enter/Space 键盘可达 + `cursor-pointer` + 语义化 focus 边框（如 `focus:border-success`），卡片上加 `title={t("characters.edit")}` 作为提示；**不再单独放铅笔按钮**（`Pencil` 图标已全项目移除）。资产卡片入口见 `wizard/StepAssets.tsx` 与 `wizard/AssetListSection.tsx`（`characters/CharacterPanel.tsx` 已删除）
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
  - ⚠️ **`seed` 服务端校验范围 -1 ~ 999**（官方文档未写，2026-09-12 实测 400 `invalid_request` 得知）：超出范围直接 400。同 seed 同 prompt 输出字节级一致；「重新生成」传 0-999 随机值破除结果趋同（`randomSeed()` 定义在 `useCharacterEditorActions.ts:38`，**当前只有角色定妆照重生成传 `seed`**，资产图与镜头图片/视频请求都不传）
  - 视频 `agnes-video-2.5-flash` — 仅支持 `size="720P"`，画幅用 `aspect_ratio`（16:9 → 1280x704），时长用 `seconds`（"4"~"12"），有首帧/尾帧时 `mode="keyframe"`（`first_frame` / `last_frame`），无图时 `mode="text"`；轮询必须带 `model_name`，成片 URL 在响应顶层 `url`
- ⚠️ 视频 2.5 Flash 与旧版 `agnes-video-v2.0` 参数体系不同（旧版 `num_frames`（8n+1、≤441）/ `frame_rate` / `width` / `height` / `image` / `last_image` 均已废弃，`calcNumFrames` 已无调用方），修改 `videoService.ts` 时勿混用两套参数
- API Key 和 Base URL 由用户在设置对话框中配置，存储在浏览器本地
- 📌 模型名/参数变更的**文档同步清单**（升级时必须逐处更新，改完 grep 全仓旧名确认零残留）：`src/lib/models.ts`（SSOT）、`README.md` 与 `README_EN.md`（特性表 + MODELS 代码块，中英口径一致）、`AGENTS.md`（本节 + Pipeline 架构章节）。`docs/history/` 下的归档快照（含原 `TEST_REPORT.md`）属历史实测记录，**不作为当前 SSOT**；除安全脱敏、历史状态警示和明显误导性待办修订外，不改写其原始证据。

## 用量限制与套餐（Rate Limit / Plan）

服务面向免费用户（默认 `default` 套餐），官方对各访问类型有 RPM 与订阅配额限制。这些限制已写入程序，在真实 API 调用前统一拦截，避免触发 429 / 配额超限。数据来源：`https://agnes-ai.cn/zh-Hans/docs/tokenplan`。

- **套餐（plan）**：用户在设置对话框选择，存入 `providerConfig.plan`，默认 `default`。共 5 档：`default`（免费）、`enterprise`（企业认证）、`starter` / `plus` / `pro`（Token Plan 订阅）。
- **配置单一事实源**：`src/lib/plans.ts` 的 `PLANS` 常量，集中定义各档 RPM 与订阅配额（文本/图片/视频）。替换或调整限制只改此处。
- **集中式限流器**：`src/services/rateLimit.ts` 的单例 `rateLimiter`。三类真实入口统一在调用前 `await rateLimiter.acquire(kind, opts)`：
  - 文本 — `src/services/ai/openai.ts` 的 `chatCompletion`
  - 图片 — `openai.ts` 的 `generateImage`（按 `imageSizeToTier(size)` 区分 1K/2K/3K/4K 档位）
  - 视频 — `src/services/videoService.ts` 的 `generateVideo`（cost = 请求时长秒数）
- **RPM 节流**：按模型种类（图片再按尺寸档位）做 60s 滑动窗口；达到上限即等待到最早一条滑出窗口。以官方「实际 RPM」作安全上限（更保守）。默认档视频 RPM=1，向导已按套餐同步并发（免费档 1、企业 2、Token Plan 3），不会同时显示多个“生成中”。
- **订阅配额（仅 Token Plan）**：文本（每 5h / 每周）、图片（每日张数）、视频（每日秒数）计数并持久化到 localStorage（key `wxhb-usage`），刷新不丢失。用尽抛出 `RateLimitError`（reason=`quota`，定义于 `services/rateLimit.ts`），按终态错误处理（不进入视频自动重试）。
- **取消**：`acquire` 支持 `AbortSignal`，取消时抛 `RateLimitError`（reason=`aborted`）。
- **套餐升级即生效**：用户切换套餐后，限流器实时读取 `providerConfig.plan`，无需刷新页面。

## 数据模型

类型定义的唯一载体是 `src/stores/projectTypes.ts`（本节只给导航，不复制字段清单）。

- **Project**：`title` / `wizardStep` 1..6 / `automationMode`（`auto` | `semi-auto`）/ `aspectRatio`（`9:16`|`16:9`|`1:1`）/
  `ideaPrompt` / `style`（中文风格描述）/ `visualDirection`（结构化六维 + `revision` + `status`）/
  `styleReferenceUrl` 与 `styleReferenceError` / `assets[]` / `shots[]` / 三个 `*Reviewed` 审核标记 /
  三个 `*GenerationStarted` 幂等标记 / `status` / `error` / `createdAt` / `updatedAt`
- **Asset**（`type` = `character` | `scene` | `product` | `prop` | `style`）：`source`（`extracted` | `manual`，缺省按 extracted 兼容旧数据）/
  `name` / `description` / `prompt`（英文派生物；style 资产上即 `stylePrompt`）/ `details`（分类结构化设定）/
  `imageUrl` / `avatarUrl` / `multiViewUrl` / `error` / `derivation`（`locked` / `dirty`）/ `renderRevision`；
  角色另有 `appearancePrompt` / `assetNamespace` / `fullPrompt`
- **Shot**：`scriptText` / `visualPrompt` / `motionPrompt` + 画面 4 子字段与动态 4 子字段 / `duration`（规范化后只可能 4|5|8）/
  `dialogues[]`（`characterId` 为 `null` 即旁白，`delivery` 为 TTS 预留、不进任何请求）/ `activeCharacterIds` / `activeSceneId` /
  `activeProductIds` / `activePropIds` / `imageUrl` / `videoUrl` / `videoProgress` / `videoRetryCount` /
  `useDualFrame` / `lastFrameUrl` / `status` / `error` / `renderRevision`
  （⚠️ `firstFrameUrl` 是无消费者的死字段，视频首帧实际取 `imageUrl`）
- 状态流转：项目 `idle → scripting → imaging → videoing → rendering → done`（可卡 `failed`；批量完成后复位 `idle` 或 `failed`，
  只有成片完成才置 `done`）；分镜 `idle → scripting → scripted → imaging → imaged → videoing → videoed`（可卡 `failed`）
- `HistoryEntry` / 操作历史已随 persist v15 从持久化中移除，**不再属于数据模型**，勿再加回
- 多项目：`projects[]` + `activeProjectId`，经 `getActiveProject()` 派生；复制项目保留分镜结构并重置 `idle`
- persist：`wxhb-project` v16 / `wxhb-settings` v4 / `wxhb-usage`（限流用量）。迁移按版本分块串行，
  **新增持久化字段必须同时加迁移与 `tests/stores/*` 回归**；块执行顺序与版本号不完全一致（`<11` 排在 `<12`、`<13` 之后），改迁移前先看 `docs/execution-flow.md` §13

## 多项目管理

- 左侧面板只保留**项目**（`ProjectSidebar`）；分镜列表与镜头详情在步骤 3（`ShotListSection` → `ShotDetail`），资产与视觉方向编辑在步骤 2（`AssetListSection` / `AssetEditor` / `VisualDirectionEditor` / `CharacterEditor`），操作历史已整体停用并移出持久化
- **分镜内容全只读**：镜头文案 / 结构化子字段 / 英文提示词 / 对白 / 资产引用都不可手改，唯一修改入口是步骤 3 详情页的「交给 AI 修改」（`ShotDetail` + `useScriptActions.reviseShot` → `reviseShotWithInstruction`）；禁再加回逐字段输入框，也禁新增第二套分镜详情布局（必须复用 `AssetDetailShell` 系列）
- **进入分镜步骤前先在资产页等首个镜头**：`StepAssets.enterStoryboard` 触发 `generateStoryboard` 并在首个镜头写回时切页（与「想法 → 资产」同构）；禁改回「先切页再生成」的一屏转圈体验
- 项目操作：创建 / 切换 / 删除 / 复制
- 复制项目时保留分镜结构，重置状态为 idle
- v1 → v16 持续存储迁移：旧单项目、多轮字段、角色描述格式与视觉方向平铺字段逐步收敛为当前结构；新增持久化字段必须增加版本迁移与回归测试（迁移明细见 `docs/execution-flow.md` §13）

## 工作流约定（Agent 必须遵守）

每次完成代码编写任务后，执行以下流程：

1. **文档同步检查** — 先按 `docs/index.md` §3 同步铁律与 §2 SSOT 表定位受影响文档（README.md、README_EN.md、AGENTS.md、`docs/` 现行参考），确保与代码变动一致；关键事实只改权威载体，其余文档改为引用。如有新增/删除/重命名的文件、接口变更、功能变更等，必须同步更新文档（中英双语口径一致）。关键事实先更新 SSOT，再扫描引用方；历史报告必须标明历史状态，不得继续作为现行协议依据。
2. **安全扫描** — 提交前搜索 API Key、Token、Cookie、真实请求头和个人数据；发现疑似凭证先停止提交，轮换/脱敏后再继续。测试 fixture、日志、截图和 CI artifact 也必须脱敏。
3. **结构与复用自检** — 检查本次改动是否新增散落 Prompt、业务 magic number、无约束参数类型、active-project 异步写回或重复实现；能复用现有 helper/服务/类型时不得复制。
4. **提交代码** — 使用 `git add` + `git commit` 提交所有变更，commit message 遵循约定式提交格式（`feat:` / `fix:` / `docs:` / `refactor:` 等）。只精确暂存业务文件，**禁止 `git add -A`**（`.workbuddy/` 等工具数据不入库）。
5. **推送代码** — 默认不推送；仅在用户明确要求 push 时执行 `git push`。

## 注意事项

- 项目只做**单元测试**（Vitest），**不使用浏览器 / E2E**；验证用 `npx tsc --noEmit` + `git diff --check` + `npm run test` + `npm run build`（dist 被占用时先 `rm -rf dist`）。UI 效果由用户本地手动确认，AI 不启动 dev/preview 服务做界面核对。
- `.env.example` 中的 `VITE_*` 环境变量仅作参考，实际配置通过应用内设置对话框完成。
- 模型调用无抽象层：`src/services/` 直接调用 Agnes API，不存在 adapter 中间层（旧 `src/providers/` 已在前一轮重构中移除，勿再引用）。
- 视频/图片等外部 API 响应字段以**用户实测为准**，不要仅凭官方文档推断（实测：Agnes 视频成片地址在响应顶层 `url` 字段，非文档示例的 `metadata.url`）。
- `docs/history/` 下的归档快照（含原 `TEST_REPORT.md`）属于历史证据，不能作为当前模型、参数或测试规范的 SSOT；当前口径以源码、`models.ts` / `plans.ts`、本文件和同步后的 README 为准。
- 发现疑似密钥泄露时，不得继续提交或传播原值；先轮换凭证，再脱敏当前文件并评估 Git 历史清理范围。
