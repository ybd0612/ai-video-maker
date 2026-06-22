<div align="center">

# 🎬 AI Video Maker

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
| 🤖 **智能分镜** | `agnes-2.0-flash` — 自动生成 4-6 个分镜，同时产出文生图 + 图生视频两套提示词 |
| 🎨 **图像生成** | `agnes-image-2.1-flash` — 根据画面描述生成参考图（并发度 3） |
| 🎥 **视频生成** | `agnes-video-v2.0` — 根据动态描述生成视频（并发度 2，自动重试 3 次） |
| ✂️ **视频拼接** | FFmpeg.wasm 客户端 concat demuxer 拼接为最终 MP4 |
| ✨ **AI 辅助优化** | 每个输入框旁可调用 AI 多轮对话优化提示词 |
| 📋 **多项目管理** | 创建 / 切换 / 删除 / 复制项目，localStorage 持久化 |
| 📊 **操作历史** | 最近 200 条操作记录，按日期分组展示 |
| 🔄 **自动重试** | 视频生成失败自动重试，进入页面自动恢复失败任务 |
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
git clone https://github.com/ybd0612/ai-video-maker.git
cd ai-video-maker

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
│ · 操作历史 │  · 成片预览+下载    │  · 动态描述   │
│          │                    │  · 时长设置   │
│          │                    │  · 单独重试   │
└──────────┴────────────────────┴──────────────┘
```

### Pipeline 四阶段

| 阶段 | 说明 | 并发度 |
|------|------|--------|
| 📝 脚本 | 生成分镜 + 文生图提示词 + 图生视频提示词 | 1 |
| 🖼️ 图片 | 根据画面描述生成参考图 | 3 |
| 🎥 视频 | 根据动态描述生成视频（自动重试 3 次） | 2 |
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
│   ├── chatService.ts             # 多轮对话 API（AI 辅助提示词优化）
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
│       ├── IMEAwareTextarea.tsx   # 输入法兼容文本框
│       └── AiAssistDrawer.tsx     # AI 辅助提示词优化对话抽屉
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
