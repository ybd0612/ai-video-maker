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
                         ↑
Upload ──────────────────┘
```

- `text-out` → `text-in` / `prompt-out`
- `image-out` → `image-in` / `video-in`
- `video-out` → `video-in`

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
│   ├── canvasStore.ts         # 画布状态（IndexedDB 持久化）
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
