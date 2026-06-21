<div align="center">

# 🎬 wxhb — AI 一键成片

**面向 AI 创作的短视频制作工具**

[English](./README_EN.md) | 中文

基于 Pipeline 架构的一键式短视频生成工具，集成 Agnes AI 的文本、图像、视频三大模型，从主题描述自动生成脚本分镜、参考图、视频片段并拼接为成片。

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
| 🎬 **一键成片** | 输入主题 → 自动生成分镜脚本 → 参考图 → 视频片段 → 拼接成片 |
| 🤖 **文本生成** | `agnes-2.0-flash` — 智能拆分 4-6 个结构化分镜（文案 + 画面描述 + 时长） |
| 🎨 **图像生成** | `agnes-image-2.1-flash` — 根据画面描述生成每个分镜的参考图（并发度 3） |
| 🎥 **视频生成** | `agnes-video-v2.0` — 异步创建 + 轮询，支持图生视频（并发度 2，10 分钟超时） |
| ✂️ **视频拼接** | FFmpeg.wasm 客户端 concat demuxer 拼接为最终 MP4 |
| 📋 **多项目管理** | 创建 / 切换 / 删除 / 复制项目，localStorage 持久化 |
| 📊 **操作历史** | 最近 200 条操作记录，按日期分组展示 |
| 🔄 **单镜头重试** | 失败的分镜可单独重试，无需重新生成整个项目 |
| 📐 **多比例支持** | 16:9（横屏）、9:16（竖屏）、1:1（方形） |
| 🌐 **中英文切换** | 内置轻量 i18n 系统，一键切换中文 / English |
| 🔧 **模型可替换** | 模型标识符集中管理，替换只需修改 `MODELS` 常量 |

## 🚀 快速开始

### 环境要求

- Node.js >= 18
- npm >= 9

### 安装与运行

```bash
# 克隆仓库
git clone https://github.com/your-username/wxhb.git
cd wxhb

# 安装依赖
npm install

# 启动开发服务器（默认 http://127.0.0.1:5173）
npm run dev

# 构建生产版本
npm run build

# 预览生产版本（端口 5180）
npm run preview
```

### 配置 API Key

1. 启动应用后，点击 **设置** 按钮
2. 填入 **API Key**（Agnes AI 或兼容的 OpenAI 格式密钥）
3. 确认 **API Base URL**（默认：`https://apihub.agnes-ai.com/v1`）
4. 保存设置

> 💡 API Key 存储在浏览器本地（localStorage），仅在发起 API 请求时发送到配置的服务端地址。

## 📖 使用指南

### 工作流程

1. **创建项目** — 在左侧面板点击新建项目，选择画面比例
2. **输入主题** — 在脚本面板输入短视频主题描述
3. **生成分镜** — 点击生成按钮，AI 自动拆分为 4-6 个分镜
4. **一键生成** — 点击运行，Pipeline 自动完成：图片生成 → 视频生成 → 拼接成片
5. **预览下载** — 在成片预览区查看最终视频并下载

### 界面布局

```
┌──────────┬────────────────────┬──────────────┐
│ 左侧面板  │     中央预览区      │  右侧编辑器   │
│          │                    │              │
│ · 项目列表 │  · 单镜头预览       │  · 分镜文案   │
│ · 分镜列表 │  · 图片/视频切换    │  · 画面描述   │
│ · 操作历史 │  · 成片预览+下载    │  · 时长设置   │
│          │                    │  · 单独重试   │
└──────────┴────────────────────┴──────────────┘
```

### Pipeline 四阶段

| 阶段 | 说明 | 并发度 |
|------|------|--------|
| 📝 脚本 | 调用文本模型生成 4-6 个结构化分镜 | 1 |
| 🖼️ 图片 | 为每个分镜生成参考图 | 3 |
| 🎥 视频 | 为每个分镜生成视频（异步创建 + 5 秒轮询） | 2 |
| ✂️ 拼接 | FFmpeg.wasm concat demuxer 拼接为 MP4 | 1 |

## 🏗️ 项目结构

```
src/
├── i18n/                          # 轻量 i18n 系统（无第三方依赖）
│   └── index.ts                   # zh/en 翻译字典 + useT hook
├── pages/
│   └── ProjectWorkspace.tsx       # 主页面（三栏布局：分镜列表 | 预览 | 编辑器）
├── features/
│   ├── script/
│   │   └── ScriptPanel.tsx        # 用户输入区域 + 生成分镜按钮
│   ├── shots/
│   │   ├── ShotList.tsx           # 左侧分镜列表（状态徽标 + 缩略图）
│   │   └── ShotEditor.tsx         # 右侧分镜编辑器（文案 / 画面描述 / 时长）
│   ├── preview/
│   │   ├── ShotPreview.tsx        # 单镜头预览（图片 + 视频）
│   │   └── FinalPreview.tsx       # 成片预览（FFmpeg 拼接 + 下载）
│   ├── projects/
│   │   └── ProjectSidebar.tsx     # 项目管理面板
│   └── history/
│       └── HistoryPanel.tsx       # 操作历史面板
├── services/                      # Pipeline 服务层
│   ├── pipelineService.ts         # 编排引擎（脚本 → 图片 → 视频，含并发控制）
│   ├── scriptService.ts           # 文本模型调用，生成结构化分镜
│   ├── imageService.ts            # 图片生成（单张）
│   ├── videoService.ts            # 视频生成（异步创建 + 轮询）
│   └── renderService.ts           # FFmpeg.wasm 视频拼接
├── stores/                        # Zustand stores
│   ├── projectStore.ts            # 多项目管理（localStorage 持久化，v1→v2 迁移）
│   └── settingsStore.ts           # 全局设置（apiKey/baseUrl/language，localStorage）
├── providers/                     # AI 模型抽象层
│   ├── types.ts                   # ModelProvider 接口定义
│   └── agnes/
│       └── AgnesAdapter.ts        # Agnes AI 适配器（文本/图像/视频）
├── lib/
│   ├── models.ts                  # AI 模型标识符常量（集中管理）
│   ├── resolveBaseUrl.ts          # API 地址解析工具
│   └── validation.ts              # 校验工具（帧数计算、prompt 清理等）
├── components/
│   ├── SettingsDialog.tsx         # 设置对话框（API Key / 语言）
│   ├── ApiKeyBanner.tsx           # API Key 缺失提示横幅
│   └── ui/                        # 通用 UI 组件
│       ├── ConfirmDialog.tsx      # 确认对话框
│       ├── ContextMenu.tsx        # 右键菜单
│       ├── HelpTooltip.tsx        # 帮助提示
│       ├── Lightbox.tsx           # 图片灯箱
│       ├── NumberInput.tsx        # 数字输入框
│       └── IMEAwareTextarea.tsx   # 输入法兼容文本框
├── styles/
│   └── globals.css                # 全局样式
├── App.tsx                        # 根组件
└── main.tsx                       # 入口文件
```

## 🔧 模型替换

模型标识符集中定义在 `src/lib/models.ts`：

```typescript
export const MODELS = {
  text: "agnes-2.0-flash",
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
<div align="center">

# 🎨 AI Canvas Creator

**面向 AI 创作的无限画布工作台**

[English](./README_EN.md) | 中文

基于 React Flow 构建的节点式 AI 工作流编辑器，集成 Agnes AI 的文本、图像、视频三大模型，支持拖拽式编排、拓扑执行和中英文切换。

![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite)
![React Flow](https://img.shields.io/badge/React_Flow-12-FF0072)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-4-06B6D4?logo=tailwindcss)
![License](https://img.shields.io/badge/License-MIT-green)

</div>

---

## ✨ 功能特性

| 特性 | 说明 |
|------|------|
| 🖼️ **无限画布** | 基于 React Flow 的节点式画布，支持缩放、平移、小地图 |
| 🤖 **文本生成** | 集成 `agnes-2.0-flash` 模型，支持系统提示词和自定义参数 |
| 🎨 **图像生成** | 集成 `agnes-image-2.1-flash`，支持文生图和图生图（URL 管线） |
| 🎬 **视频生成** | 集成 `agnes-video-v2.0`，异步任务 + 进度轮询 |
| 📤 **图片上传** | 拖拽/点击上传本地图片，自动转为 base64 数据用于 API 调用 |
| 🔗 **智能连线** | 规则化 Handle 验证，右键删除连线 |
| 📐 **预设尺寸** | 图像/视频支持多种预设尺寸（1:1、16:9、9:16 等） |
| 📦 **批量生成** | 图像支持 1-10 张批量生成，视频支持 1-5 个批量生成 |
| ⚡ **工作流执行** | 拓扑排序 + 循环检测 + 级联失败 + 局部执行 |
| 💾 **任务管理** | 文件夹 + 树形任务管理、多画布切换、自动保存 + 备份恢复 |
| 🌐 **中英文切换** | 内置轻量 i18n 系统，一键切换中文/English |
| 🔧 **模型可替换** | 抽象 Provider 层，替换模型只需修改注册表或实现适配器 |

## 🚀 快速开始

### 环境要求

- Node.js >= 18
- npm >= 9

### 安装与运行

```bash
# 克隆仓库
git clone https://github.com/your-username/ai-canvas-creator.git
cd ai-canvas-creator

# 安装依赖
npm install

# 启动开发服务器（默认 http://localhost:3000）
npm run dev

# 构建生产版本
npm run build

# 预览生产版本
npm run preview
```

### 配置 API Key

1. 启动应用后，点击左侧边栏底部的 **设置**
2. 填入 **API Key**（Agnes AI 或兼容的 OpenAI 格式密钥）
3. 确认 **API Base URL**（默认：`https://apihub.agnes-ai.com/v1`）
4. 点击 **测试连接** 验证后 **保存设置**

> 💡 API Key 存储在浏览器本地，仅在发起 API 请求时发送到配置的服务端地址。

## 📖 使用指南

### 画布操作

| 操作 | 方式 |
|------|------|
| 添加节点 | 从左侧面板拖拽节点到画布 |
| 连接节点 | 从一个节点的输出 Handle 拖向另一个节点的输入 Handle |
| 删除连线 | 右键点击连线，选择删除 |
| 选中节点 | 单击节点，右侧面板显示属性编辑 |
| 画布控制 | 左下角工具栏：放大、缩小、适应视图 |

### 节点类型

| 节点 | 功能 | 输入 | 输出 |
|------|------|------|------|
| **Prompt** | 自由文本输入 | — | 文本 |
| **Text** | LLM 文本生成 | 文本 | 文本 |
| **Image** | AI 图像生成（支持批量 1-10 张、预设尺寸） | 文本 + 图像（可选） | 图像 |
| **Video** | AI 视频生成（支持批量 1-5、自动计算帧数） | 图像（可选） | 视频 |
| **Upload** | 本地图片上传 | — | 图像 |

### 连接规则

```
Prompt ──→ Text ──→ Image ──→ Video
                    ↑        ↑
Upload ─────────────┘────────┘
```

- `prompt-out` → `text-in`（Prompt 输出文本到 Text 节点）
- `text-out` → `text-in`（文本可串联）
- `image-out` → `image-in`（图像可串联，也支持图生图）
- `image-out` → `video-in`（图像作为视频输入）
- `video-out` → `video-in`（视频可串联）
- Upload 节点输出 `image-out`，可连接到 Image 或 Video 节点

### 任务管理

- **新建任务**：在任务树空白区域右键，选择新建任务或新建文件夹
- **切换任务**：点击任务名称（自动保存当前画布后切换）
- **自动保存**：画布修改后 500ms 自动保存到当前任务
- **重命名/删除**：右键点击任务或文件夹，弹出操作菜单
- **数据恢复**：如果任务数据丢失，系统会自动从 localStorage 备份恢复

## 🏗️ 项目结构

```
src/
├── i18n/                      # 国际化
│   └── index.ts               # 中英文翻译字典 + useT hook
├── canvas/                    # 画布核心
│   ├── CanvasWorkspace.tsx    # 主画布组件（React Flow）
│   ├── types.ts               # 节点类型、模型注册表
│   ├── validateConnection.ts  # 连接校验规则
│   ├── hooks/
│   │   └── useWorkflowRunner.ts  # 工作流执行引擎
│   ├── nodes/                 # 5 种自定义节点
│   │   ├── PromptNode.tsx
│   │   ├── TextNode.tsx
│   │   ├── ImageNode.tsx
│   │   ├── VideoNode.tsx
│   │   └── UploadNode.tsx
│   ├── edges/                 # 自定义连线样式
│   └── panels/                # 属性编辑面板
├── components/                # UI 组件
│   ├── Sidebar.tsx            # 左侧面板（设置 + 清空画布）
│   ├── TaskTreeView.tsx       # 树形任务管理器（文件夹 + 任务 + 右键菜单）
│   ├── SettingsDialog.tsx     # 设置对话框
│   ├── ApiKeyBanner.tsx       # API Key 提示横幅
│   └── ui/                    # 通用 UI 组件
│       ├── ConfirmDialog.tsx  # 确认对话框
│       ├── ContextMenu.tsx    # 右键菜单
│       ├── HelpTooltip.tsx    # 帮助提示
│       ├── Lightbox.tsx       # 图片灯箱
│       └── NumberInput.tsx    # 数字输入框
├── stores/                    # 状态管理（Zustand）
│   ├── canvasStore.ts         # 画布状态（IndexedDB 持久化 + localStorage 备份）
│   ├── settingsStore.ts       # 全局设置（localStorage）
│   └── taskStore.ts           # 任务管理（文件夹 + 多画布任务切换，localStorage）
├── providers/                 # AI 模型抽象层
│   ├── types.ts               # ModelProvider 接口
│   └── agnes/
│       └── AgnesAdapter.ts    # Agnes AI 适配器
├── lib/
│   ├── resolveBaseUrl.ts      # API 地址解析工具
│   └── validation.ts          # 校验工具（帧数计算、prompt 清理等）
├── styles/
│   └── globals.css            # 全局样式 + React Flow 覆写
├── App.tsx                    # 根组件
└── main.tsx                   # 入口文件
```

## 🔧 模型替换

### 修改注册表

编辑 `src/canvas/types.ts` 中的 `MODEL_REGISTRY`：

```typescript
export const MODEL_REGISTRY: Record<Modality, ModelEntry[]> = {
  text: [
    { id: "agnes-2.0-flash", name: "Agnes 2.0 Flash", modality: "text" },
    // 添加其他文本模型...
  ],
  image: [
    { id: "agnes-image-2.1-flash", name: "Agnes Image 2.1", modality: "image" },
  ],
  video: [
    { id: "agnes-video-v2.0", name: "Agnes Video v2.0", modality: "video" },
  ],
};
```

### 接入其他 Provider

实现 `src/providers/types.ts` 中的 `ModelProvider` 接口：

```typescript
export interface ModelProvider {
  readonly name: string;
  discover(apiKey: string, baseUrl: string): Promise<AIModel[]>;
  generateText(apiKey: string, baseUrl: string, params: TextParams): Promise<TextResult>;
  generateImage(apiKey: string, baseUrl: string, params: ImageParams): Promise<ImageResult>;
  createVideoTask(apiKey: string, baseUrl: string, params: VideoParams): Promise<string>;
  pollVideoTask(apiKey: string, baseUrl: string, taskId: string): Promise<VideoTaskStatus>;
}
```

## 🌐 国际化

项目内置轻量 i18n 系统，无需第三方依赖：

- **翻译字典**：`src/i18n/index.ts` 中的 `zh` / `en` 对象
- **组件中使用**：`const t = useT();` 然后 `t("key")` 或 `t("key", { name: "value" })`
- **组件外使用**：`getTranslation("key")`
- **添加新语言**：在 `dictionaries` 中添加新的语言对象即可

## 🛠️ 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | React 18 + TypeScript 6 |
| 构建 | Vite 8 |
| 画布 | React Flow v12 |
| 状态 | Zustand v5 + localForage |
| 样式 | TailwindCSS v4 + Framer Motion |
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
