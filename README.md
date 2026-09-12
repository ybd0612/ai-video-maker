<div align="center">

# 🎬 AI Video Maker

**面向 AI 创作的短视频制作工具**

[English](./README_EN.md) | 中文

基于 6 步向导的短视频自动创作工具：输入主题，AI 自动完成角色提取、分镜脚本、参考图、视频片段生成并拼接为成片。集成 Agnes AI 的文本、图像、视频三大模型。

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-4-06B6D4?logo=tailwindcss)
![FFmpeg.wasm](https://img.shields.io/badge/FFmpeg.wasm-0.12-007808)
![License](https://img.shields.io/badge/License-MIT-green)

</div>

---

## ✨ 功能特性

| 特性 | 说明 |
|------|------|
| 🧭 **6 步向导** | 想法 → 资产（角色/场景/产品） → 分镜 → 图片 → 视频 → 成片，每步可控、可单独重试 |
| 🎬 **一键成片** | 全自动模式：输入主题后流水线直出成片（脚本 → 图片 → 视频 → 拼接） |
| 🤖 **智能分镜** | `agnes-3.0-flash` — 生成 4-6 个分镜，同时产出文生图 + 图生视频两套提示词 |
| 🎨 **图像生成** | `agnes-image-2.1-flash` — 按画面描述生成参考图（并发 3） |
| 🎥 **视频生成** | `agnes-video-v2.0` — 异步任务 + 轮询，按套餐自动限速，失败自动重试与恢复 |
| 🎞️ **首尾帧控制** | 分镜可选双图流（首帧 + 尾帧）生成，运动一致性更好 |
| ✂️ **视频拼接** | FFmpeg.wasm 客户端 concat demuxer 拼接为最终 MP4 |
| ✨ **AI 辅助优化** | 每个输入框旁可调用 AI 多轮对话优化提示词 |
| 🚦 **套餐限流** | 5 档套餐（免费 / 企业 / Starter / Plus / Pro），RPM 节流 + Token Plan 配额，防止超额调用 |
| 🔄 **幂等可靠** | 批量任务模块级幂等守卫：不重复创建服务端任务、不误杀进行中任务，刷新/切换自动恢复 |
| 📋 **多项目管理** | 创建 / 切换 / 删除 / 复制项目，localStorage 持久化 |
| 📊 **操作历史** | 最近 200 条操作记录，按日期分组展示 |
| 📐 **多比例支持** | 16:9（横屏）、9:16（竖屏）、1:1（方形） |
| 🌐 **中英文切换** | 内置轻量 i18n 系统，一键切换中文 / English |
| 🔧 **模型可替换** | 模型标识符集中管理，替换只需修改 `MODELS` 常量 |

## 🚀 快速开始

### 环境要求

- Node.js ^20.19.0 或 >= 22.12.0（Vite 8 要求）
- npm >= 9

### 安装与运行

```bash
# 克隆仓库
git clone https://github.com/ybd0612/ai-video-maker.git
cd ai-video-maker

# 安装依赖
npm install

# 启动开发服务器（默认 http://127.0.0.1:5173）
npm run dev

# 构建生产版本（TypeScript 检查 + Vite 构建）
npm run build

# 预览生产版本（端口 5180）
npm run preview
```

### 配置 API Key

1. 启动应用后，点击 **设置** 按钮
2. 填入 **API Key**（Agnes AI 或兼容的 OpenAI 格式密钥）
3. 确认 **API Base URL**（默认中国站：`https://api.agnes-ai.cn/v1`）
4. 选择 **访问套餐**（默认免费档；升级后切换以解除用量限制）
5. 保存设置

> 💡 API Key 存储在浏览器本地（localStorage），仅在发起 API 请求时发送到配置的服务端地址。

## 📖 使用指南

### 6 步向导工作流

| 步骤 | 页面 | 说明 |
|------|------|------|
| 1️⃣ | **输入想法** | 描述视频主题，可选 16:9 / 9:16 / 1:1 比例，可与 AI 多轮对话打磨想法 |
| 2️⃣ | **角色资产** | AI 自动提取角色/产品/场景，可生成角色定妆照、场景参考图、产品参考图、风格参考图 |
| 3️⃣ | **分镜脚本** | 生成 4-6 个分镜（文案 / 画面描述 / 动态描述 / 时长），可逐条编辑重roll |
| 4️⃣ | **镜头图片** | 为每个分镜生成参考图，可单张重roll |
| 5️⃣ | **生成视频** | 为每个分镜生成视频片段（可选首尾帧），可单条重roll |
| 6️⃣ | **成片拼接** | 校验所有镜头后 FFmpeg.wasm 拼接为 MP4 并下载 |

- **semi-auto（默认）**：分镜/图片生成后确认，再进入后续生成，可随时回头修改
- **auto**：所有步骤自动推进，直出成片
- 免费档视频生成约 **1 条/分钟**（RPM=1），多个镜头会排队并在界面显示预计等待

### 界面布局

```
┌────────────┬────────────────────────┬──────────────────┐
│ 左侧面板    │      中央向导/预览       │    右侧编辑器      │
│            │                        │                  │
│ · 项目列表  │  · 6 步向导步骤          │  · 提示词字段      │
│ · 分镜列表  │  · 分镜卡片 + 状态徽标    │  · 时长设置        │
│ · 角色管理  │  · 图片/视频预览         │  · AI 辅助优化 ✨  │
│ · 操作历史  │  · 成片预览 + 下载       │  · 重试按钮        │
└────────────┴────────────────────────┴──────────────────┘
```

## 💳 套餐与用量限制

服务面向免费用户，官方对各访问类型有 RPM 与 Token Plan 订阅配额限制。应用在真实 API 调用前统一拦截，避免触发 429 / 配额超限。

- **5 档套餐**：`default`（免费）、`enterprise`（企业认证）、`starter` / `plus` / `pro`（Token Plan）
- **配置单一事实源**：`src/lib/plans.ts` 的 `PLANS` 常量（调整限制只改此处）
- **集中式限流器**：`src/services/rateLimit.ts` 单例 `rateLimiter`，三类真实入口统一在调用前 `await rateLimiter.acquire(kind, opts)`
- **RPM 节流**：60 秒滑动窗口，按模型种类（图片再按 1K/2K/3K/4K 档位）限制；达到上限自动等待
- **订阅配额**（仅 Token Plan）：文本（每 5h / 每周）、图片（每日张数）、视频（每日秒数）持久化到 localStorage，刷新不丢失；用尽抛终态错误，不会误入自动重试

| 模型 | default | enterprise | Token Plan |
|------|---------|-----------|------------|
| 文本 | 20 RPM | 40 RPM | 1000 RPM |
| 图片(1K) | 20 RPM | 40 RPM | 100 RPM |
| 视频 | 1 RPM | 2 RPM | 5 RPM |

## 🔒 视频生成可靠性设计

- **异步任务**：`POST /videos` 创建任务 → `GET /agnesapi?video_id=` 轮询（5s 间隔，单任务 30 分钟超时，任务注册等待 2 分钟）
- **幂等守卫**：批量生成用模块级注册表记录运行中任务，同项目不重复启动，杜绝服务端任务重复创建（避免 token 双倍消耗）
- **独立取消**：每个批量任务独立 AbortController，互不误杀；刷新后残留的“生成中”状态自动重置并重新接管
- **按项目写回**：异步结果按发起项目 ID 写回，生成中切换项目不会串写
- **失败分级**：明确失败（failed/cancelled）才标红；服务端任务仍可能运行的状态保持等待，不误报

## 🏗️ 项目结构

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
│   │   ├── useWizardActions.ts    # 向导操作编排（含幂等守卫注册表）
│   │   ├── ShotCard.tsx           # 分镜卡片（状态徽标 + 展开详情）
│   │   ├── PromptSubFields.tsx    # 提示词子字段编辑
│   │   ├── DualFrameToggle.tsx    # 首尾帧开关
│   │   └── ReviewCheckpoint.tsx   # 审核卡点
│   ├── characters/                # 角色编辑器 / 面板
│   ├── projects/                  # 项目管理面板
│   └── history/                   # 操作历史面板
├── services/                      # 服务层
│   ├── rateLimit.ts               # 集中式用量限制器（RPM + 配额，单例）
│   ├── scriptService.ts           # 文本模型调用，生成结构化分镜（双提示词）
│   ├── imageService.ts            # 图片生成
│   ├── videoService.ts            # 视频生成（异步创建 + 轮询 + 完成响应解析）
│   ├── chatService.ts             # 多轮对话 API（AI 辅助提示词优化）
│   ├── renderService.ts           # FFmpeg.wasm 视频拼接
│   ├── pipelineService.ts         # 旧版一键流水线（兼容保留）
│   └── ai/                        # AI 服务统一入口（openai 兼容）
│       ├── factory.ts             # 服务工厂
│       ├── openai.ts              # chatCompletion / generateImage 实现
│       └── index.ts
├── stores/                        # Zustand stores
│   ├── projectStore.ts            # 多项目管理（localStorage 持久化，v1→v2 迁移）
│   └── settingsStore.ts           # 全局设置（apiKey/baseUrl/plan/language）
├── lib/
│   ├── models.ts                  # AI 模型标识符常量（集中管理）
│   ├── plans.ts                   # 套餐与用量限制单一事实源
│   ├── fetchWithRetry.ts          # fetch 统一封装（超时 + 指数退避重试）
│   ├── promptUtils.ts             # 画面/运动提示词组合
│   ├── characterUtils.ts          # 角色描述注入
│   ├── assetNamespace.ts          # 角色命名空间与完整提示词
│   ├── resolveBaseUrl.ts          # API 地址解析
│   └── validation.ts              # 校验工具（帧数计算、prompt 清理）
├── components/
│   ├── SettingsDialog.tsx         # 设置对话框（API Key / Base URL / 套餐 / 语言）
│   ├── ApiKeyBanner.tsx           # API Key 缺失提示横幅
│   └── ui/                        # 通用 UI 组件（ConfirmDialog / Lightbox / AiAssistDrawer 等）
├── styles/
│   └── globals.css                # 全局样式
├── App.tsx                        # 根组件
└── main.tsx                       # 入口文件
```

## 🔧 模型替换

模型标识符集中定义在 `src/lib/models.ts`：

```typescript
export const MODELS = {
  text: "agnes-3.0-flash",
  image: "agnes-image-2.1-flash",
  video: "agnes-video-v2.0",
} as const;
```

替换模型只需修改此常量，服务层（scriptService / imageService / videoService）会自动引用新模型。

## 🛠️ 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | React 19 + TypeScript 6 |
| 构建 | Vite 8 |
| 状态 | Zustand v5（localStorage 持久化） |
| 样式 | TailwindCSS v4 + Framer Motion |
| 视频拼接 | FFmpeg.wasm 0.12 |
| 图标 | Lucide React |

## 📄 许可证

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支：`git checkout -b feature/amazing-feature`
3. 提交更改：`git commit -m 'feat: add amazing feature'`
4. 推送分支：`git push origin feature/amazing-feature`
5. 提交 Pull Request
