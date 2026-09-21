<div align="center">

# 🎬 AI Video Maker

**面向 AI 创作的短视频制作工具** —— 一句想法 → 视觉方向 → 资产 → 分镜 → 图片 → 视频 → 成片，全程在浏览器内完成，无后端。

[English](./README_EN.md) | 中文 · [全部文档](./docs/index.md)

</div>

> ⚠️ **项目状态：开发阶段（Development）**
>
> 仍在快速迭代，异步任务恢复、自动化推进与成片拼接都存在已知缺陷（见「已知限制」）。**不建议用于生产或重要内容制作。** 生成会真实消耗你 Agnes 账号的配额与费用，请先用短想法试跑。本仓库当前未随附许可证文件（见「许可证」）。

## 这个项目解决什么问题

传统 AI 成片工具把「一句话」直接黑箱成一条视频，中间产物不可控。本项目把链路拆成 6 个可审、可改、可重跑的环节，**每一步的中间产物（视觉方向、资产设定、双提示词、时长）都是显式数据**，你可以只重摇某一个镜头，而不必推倒重来。

| 你要做的事 | 直接看 |
| --- | --- |
| 跑起来、配置 API Key 与套餐 | 本页 [快速开始](#快速开始) 与 [配置](#配置-api-key-与套餐) |
| 想知道程序实际怎么跑（谁触发 → 发什么请求 → 写回什么） | [docs/execution-flow.md](./docs/execution-flow.md) |
| 想看每一步参数的进出与请求体 | [docs/execution-flow-diagrams.md](./docs/execution-flow-diagrams.md) |
| 想知道一句想法被拆成哪些字段、提示词原文长什么样 | [docs/idea-breakdown.md](./docs/idea-breakdown.md) |
| 想点选式追踪某个字段的下游消费者 | [docs/flow-map.html](./docs/flow-map.html)（双击本地打开，无需启动服务） |
| 改代码前的强制规范（分层 / 单一事实源 / 异步写回 / 测试） | [AGENTS.md](./AGENTS.md) |
| 同一事实在多份文档里以谁为准、口径冲突登记 | [docs/index.md](./docs/index.md) |

## 主流程：6 步向导

步骤标签与界面一致（`src/i18n/index.ts` 的 `wizard.step1~6`）：

```text
1 想法  →  2 资产  →  3 分镜  →  4 图片  →  5 视频  →  6 后期
```

1. **想法** — 输入创作想法 + 画幅（`9:16` / `16:9` / `1:1`）。回车即提取，产出视觉方向与四类资产，并自动进入步骤 2。
2. **资产** — 项目级**视觉方向**（六维：媒介材质 / 色彩 / 光影 / 镜头质感 / 构图 / 情绪）+ 四类结构化资产：**角色 character / 场景 scene / 核心主体 product / 关键道具 prop**（另有派生的 `style` 风格资产与风格母版图）。每张参考图可单独重生成。
3. **分镜** — 先出大纲、再逐镜头细化，产出中文文案 + 英文**画面提示词 visualPrompt** / **运动提示词 motionPrompt** + 时长（规范化后只可能是 4 / 5 / 8 秒）+ 对白与资产引用。**内容全只读**，唯一改写入口是详情页的「一句话交给 AI 改」。
4. **图片** — 每镜头一张画面图（`visualPrompt` + 角色/主体/道具参考图多参考注入），并发 3，支持单项重摇。
5. **视频** — `motionPrompt` + 镜头图作首帧，异步创建 + 5 秒轮询，`size` 固定 `720P`，时长 4–12 秒，支持首尾帧；并发按套餐降为 1 / 2 / 3。
6. **后期** — FFmpeg.wasm 在浏览器端拼接为 MP4 并下载；单镜头时直接下载不走 FFmpeg。

### 两种推进模式

- **半自动（默认）**：步骤 2 / 3 / 4 各有审核卡点，审核通过才放行下一步。
- **全自动**：条件 effect 自动串起 6 步；任一环节存在失败项时自动推进**会停住**（要求 100% 成功，代码有意为之）。

### 资产与一致性机制

- **中文是唯一主数据**，英文提示词是 AI 派生的编译产物：默认锁定，可解锁精修；改中文会标 `dirty`，出图前统一重派生。
- **风格母版图只以文字（stylePrompt）参与下游，不作为 i2i 参考图**；分镜图的参考图仅取 角色定妆照 → 主体 → 道具（2026-09-15 事故决策，避免参考图内容被整体复制）。
- 角色定妆照走**物种锁定**拼装（不再写死人像语汇），这是「动物角色画成人」类问题的修法。
- 资产分来源：`extracted`（AI 提取，重新提取为**替换式**）与 `manual`（手动添加，重新提取时保留）。
- 所有异步写回按 `projectId` + `renderRevision` 落库：跨项目串写与过期结果丢弃都有守卫；改子字段会按规则作废已生成的图片/视频（这是「改完必须重新生成」的真实机制）。

## 主要能力

- 6 步向导 + 多项目管理（创建 / 切换 / 复制 / 删除 / 搜索 / 排序），数据持久化在 `localStorage`
- 文本 / 图片 / 视频三类调用的**集中式限流**：RPM 滑动窗口 + Token Plan 配额计数，配置单一事实源在 `src/lib/plans.ts`
- **提示词规则注册表**（`src/lib/promptRules.ts`）：骨架在代码、规则条目可编辑；设置对话框「提示词规则」Tab 可查看 / 编辑 / 开关 / 新增 / 导入导出，**改完即时生效、零构建**
- **采样参数由模型自决**（`src/lib/generationParams.ts`）：按用途先发一次元请求决定 `temperature` / `top_p` / Thinking，代码只做区间校验与缓存
- 内联 AI 润色：所有 AI 可辅助的输入框右下角嵌「润色 / 逐步撤销」（`components/ui/AiPolishField.tsx`）
- 中英文界面（自研轻量 i18n，无第三方依赖）+ 黑白双主题（语义色 token）
- 运行日志停靠面板（`components/LogConsoleDock.tsx`，trace/span + localStorage 持久化）
- 仅开发期的调试出口：`vite-plugins/debugDumpPlugin.ts` 把脱敏后的 store 快照写到 `debug-dump/state.json`（该目录已 gitignore）

## 当前明确不支持

这几条常被误认为已有能力，实测代码中没有实现：

- **多轮 AI 对话面板**：步骤 1 只有想法输入框 + 内嵌润色，没有聊天抽屉（旧的 `AiAssistDrawer` 已删除，项目约定禁止再引入旁挂式 AI 入口）。
- **配音 / TTS / 字幕**：对白的 `delivery` 只是预留字段，对白不进入任何生成请求。
- **项目导入导出 / 云端同步 / 多人协作**：状态只在当前浏览器。
- **批量生成任务的取消**：唯一的用户级取消入口是第 6 步的「取消拼接」。切换项目、离开步骤、组件卸载都**不会**中断在飞请求与视频轮询，钱照扣、结果按项目 ID 写回。
- **图片 2K / 3K / 4K 档**：`aspectRatioToImageParams` 恒返回 `1K`（`src/services/imageService.ts:72-78`），更高档位仅在限流表里预留。
- **`shot.firstFrameUrl`**：无消费者的死字段，视频首帧实际取 `shot.imageUrl`。
- 操作历史面板（左侧 History Tab）已整体停用并从持久化中移除（persist v15 起）。

## 快速开始

### 环境要求

- Node.js `^20.19.0` 或 `>=22.12.0`（`package.json` 的 `engines`）
- npm（.lock 为 v3，npm ≥ 9 可用）
- 一个 Agnes AI 的 API Key（或兼容 OpenAI 接口的服务地址）

### 安装与运行

```bash
npm install
npm run dev      # http://127.0.0.1:5173
```

### 配置 API Key 与套餐

1. 顶栏打开「设置」→ **通用** Tab。
2. 填 API Key；Base URL 默认中国站 `https://api.agnes-ai.cn/v1`。
3. 选择访问套餐（`default` 免费 / `enterprise` 企业认证 / `starter` `plus` `pro` Token Plan），界面会同步显示该档 RPM 与配额摘要。
4. 保存后再开始生成。

Key、设置与项目数据都存在当前浏览器的 `localStorage`，只在发起请求时发往你配置的地址。**不要把 Key 提交进 Git 或放进公开截图。**

### 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 开发服务器（端口 5173，绑定 `127.0.0.1`，自动开浏览器） |
| `npm run build` | `tsc` 类型检查 + Vite 生产构建（产出 `dist/`） |
| `npm run preview` | 预览生产构建（端口 5180，`strictPort`） |
| `npm run test` | Vitest 单元测试单次执行 |
| `npm run test:watch` | Vitest watch |
| `npx tsc --noEmit` | 只跑类型检查（最快的改动反馈） |

RPM 与配额的完整数值表**只**在 `src/lib/plans.ts` 维护，本页与 `docs/` 均不复述，以免口径漂移。

## 技术栈

React 19 + TypeScript（`strict`）· Vite 8 · Zustand 5（persist）· Tailwind CSS 4 + Framer Motion 12 · FFmpeg.wasm（`@ffmpeg/ffmpeg` 0.12）· Lucide React · Vitest 4 · 自研 i18n（零依赖）

模型标识符集中在 `src/lib/models.ts`，替换模型只改这一处。

## 目录结构

```text
src/
├── pages/ProjectWorkspace.tsx   # 外壳：顶栏 + 左侧项目栏 + 向导主区（+ 底部日志坞）
├── features/
│   ├── wizard/                  # 6 步向导：Step*.tsx + use{Script,Asset,Image,Video}Actions.ts
│   ├── characters/              # 角色编辑器与面板
│   └── projects/                # 项目侧栏（创建/切换/复制/删除/搜索/排序）
├── services/                    # 外部服务：script / image / video / chat / render / rateLimit + ai/(OpenAI 兼容)
├── stores/                      # projectStore(v16) / settingsStore(v4) / projectMigrations / projectOps / projectTypes
├── lib/                         # 无副作用领域工具：models plans promptRules promptComposer
│                                #   assetDetails shotReferences generationParams refineContent
│                                #   batchRunner jsonResponse fetchWithRetry validation resolveBaseUrl ...
├── components/                  # 设置对话框、提示横幅、日志坞 + ui/（润色输入框、确认框、灯箱等）
├── i18n/                        # zh / en 字典 + useT
└── styles/globals.css           # 字号缩放与黑白主题语义色 token

tests/                           # Vitest 用例，按被测模块镜像分层
docs/                            # 设计 / 流程 / 历史快照，索引见 docs/index.md
vite-plugins/                    # debugDumpPlugin（仅 dev server）
scripts/run-vitest.mjs           # Windows 下规范化盘符后启动 Vitest
```

## 测试与验证口径

- **只做代码单元测试**（Vitest 4，`environment: "node"`，不引入 jsdom，**不做浏览器 / E2E**）。当前规模：30 个文件 / 393 个用例全通过（2026-09-21 实测）。
- 网络与时间必须伪造（`vi.stubGlobal("fetch")` + `vi.useFakeTimers()`）；模块级单例用 `vi.resetModules()` 隔离。
- `tsconfig.json` 的 `include` 只含 `src`，所以 `tests/` 不参与 `npm run build` 的类型检查，需靠 `npm run test` 自证。
- 界面效果由维护者本地手动确认；改动后的最小验证是 `npx tsc --noEmit` + `git diff --check` + `npm run test` + `npm run build`。
- CI（`.github/workflows/deploy.yml`）在 push `main` 时构建并部署到 GitHub Pages；**目前不含单元测试步骤**，测试尚未成为部署门禁。

## 部署

构建 `base` 为相对路径 `./`，因此既能在自定义域名下运行，也能直接发到 GitHub Pages 子路径（`https://<user>.github.io/<repo>/`）。仓库 Settings → Pages 需将 Source 设为 “GitHub Actions”，之后推送 `main` 即自动部署。

> 生产构建不含 `debugDumpPlugin`（`apply: "serve"`），但 `vite.config.ts` 里的 `/cdn-proxy` 与 `/ffmpeg-core` 代理只在 dev server 生效。部署到自建域名后若出现视频下载 CORS 或 FFmpeg 核心拉取失败，属于当前已知缺口。

## 已知限制

- AI 输出依赖外部模型：结构化 JSON、提示词质量、图片/视频一致性仍会不稳定。
- 配额在 HTTP 之前扣，请求失败**不回滚**；图片 403 / 内容过滤、视频创建后失败都会白扣一次。
- 非幂等的图片/视频创建 POST 目前仍复用通用重试封装，服务端没有幂等键，重试有重复计费风险（已登记为待收口项）。
- 单个镜头图片被级联失效后，步骤 4 没有「只补缺失项」的自动入口，容易退化成「全部重新生成」。
- 自动模式任一环节有失败项就永久停住，不会带着失败继续收尾。
- FFmpeg.wasm 受浏览器内存与跨域资源限制，长视频或部分远端地址可能拼接失败。
- 浏览器标签页标题目前是 `AI Canvas Creator`（`index.html:24`），与仓库名 `ai-video-maker` 尚未统一。

遇到生成异常时，请一并记录：当前向导步骤、项目状态、失败镜头编号、浏览器控制台错误、是否刷新或切换过项目 —— 这些是定位所需的最小信息集。

## 参与贡献

本项目尚无 `CONTRIBUTING.md`。改代码前请先读 [AGENTS.md](./AGENTS.md)（分层与单一事实源铁律、向导可靠性铁律、测试约定），其中最容易被踩的三条：

- 批量生成必须走模块级注册表做幂等守卫，每个任务独立 `AbortController`。
- 异步结果一律按 `projectId` 写回，禁止使用只作用于活动项目的 action。
- 用户可见文案进 `src/i18n/index.ts`（zh + en 同步），长提示词进 `src/lib/promptRules.ts` 条目，会变化的参数进 `lib/models.ts` / `lib/plans.ts`。

提交遵循约定式提交（`feat:` / `fix:` / `refactor:` / `docs:`），只精确暂存业务文件。

## 许可证

本仓库**尚未随附许可证文件**，`package.json` 仍为 `"private": true`。在作者明确选择并添加 `LICENSE` 之前，默认**保留所有权利（All rights reserved）**，不得据此认为代码可自由再分发。

应用本身依赖 Agnes AI 的付费模型服务；使用该服务需你自己的 API Key，并受其服务条款与配额约束，本仓库不对第三方服务的可用性、价格与输出内容负责。
