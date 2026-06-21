# wxhb — AI 一键成片

面向 AI 创作的短视频制作工具。采用 Pipeline 架构（脚本 → 图片 → 视频 → 拼接），集成 Agnes AI 的文本、图像、视频三大模型，支持中英文切换。

## 技术栈

- React 18 + TypeScript + Vite
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
│   └── ProjectWorkspace.tsx       # 主页面（三栏布局：分镜列表 | 预览 | 编辑器）
├── features/
│   ├── script/
│   │   └── ScriptPanel.tsx        # 用户输入区域 + 生成分镜按钮
│   ├── shots/
│   │   ├── ShotList.tsx           # 左侧分镜列表（状态徽标 + 缩略图）
│   │   └── ShotEditor.tsx         # 右侧分镜编辑器（文案 / 画面描述 / 时长）
│   └── preview/
│       ├── ShotPreview.tsx        # 单镜头预览（图片 + 视频）
│       └── FinalPreview.tsx       # 成片预览（FFmpeg 拼接 + 下载）
├── services/                      # Pipeline 服务层
│   ├── pipelineService.ts         # 编排引擎（脚本 → 图片 → 视频，含并发控制）
│   ├── scriptService.ts           # 文本模型调用，生成结构化分镜
│   ├── imageService.ts            # 图片生成（单张）
│   ├── videoService.ts            # 视频生成（异步创建 + 轮询）
│   └── renderService.ts           # FFmpeg.wasm 视频拼接
├── stores/                        # Zustand stores
│   ├── projectStore.ts            # 多项目管理（projects[] + activeProjectId + history[]，localStorage 持久化，v1→v2 迁移）
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

## 命令

- `npm run dev` — 启动开发服务器（端口 5173）
- `npm run build` — TypeScript 检查 + Vite 生产构建
- `npm run preview` — 预览生产版本（端口 5180）

## 路径别名

`@/` 映射到 `src/`（通过 `vite.config.ts` 和 `tsconfig.json` 的 `paths` 配置）。

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

## Pipeline 架构

四阶段流水线，编排在 `src/services/pipelineService.ts`：

1. **脚本阶段** — 调用文本模型生成 4-6 个结构化分镜（scriptText + visualPrompt + duration）
2. **图片阶段** — 为每个分镜生成参考图（并发度 3）
3. **视频阶段** — 为每个分镜生成视频（并发度 2，异步创建 + 5 秒轮询，10 分钟超时）
4. **拼接阶段** — FFmpeg.wasm concat demuxer 拼接所有视频为最终 MP4

- 并发控制使用 `Promise.allSettled`，确保所有 worker 完成后再检查状态
- 支持 AbortController 取消
- 支持单镜头重试（`runSingleShot`，跳过脚本阶段）

## 模型配置

- 模型标识符集中定义在 `src/lib/models.ts` 的 `MODELS` 常量中
- 服务层（scriptService / imageService / videoService）通过 `MODELS` 引用模型名
- 替换模型只需修改 `MODELS` 常量
- API Key 和 Base URL 由用户在设置对话框中配置，存储在浏览器本地

## 数据模型

- **Project**：项目（title / aspectRatio / style / language / shots / status / error / createdAt / updatedAt）
- **Shot**：分镜（scriptText / visualPrompt / duration / imageUrl / videoUrl / status）
- **HistoryEntry**：操作记录（projectId / action / description / timestamp）
- 项目状态流转：`idle → scripting → imaging → videoing → rendering → done`（可卡在 `failed`）
- 分镜状态流转：`idle → scripting → scripted → imaging → imaged → videoing → videoed`（可卡在 `failed`）
- 多项目存储：`projects[]` + `activeProjectId`，通过 `getActiveProject()` 派生活跃项目
- 历史记录保留最近 200 条，按日期分组展示

## 多项目管理

- 左侧面板三个标签：**项目**（ProjectSidebar）、**分镜**（ShotList）、**历史**（HistoryPanel）
- 项目操作：创建 / 切换 / 删除 / 复制
- 复制项目时保留分镜结构，重置状态为 idle
- v1 → v2 存储迁移：旧单项目自动转换为新多项目格式

## 工作流约定（Agent 必须遵守）

每次完成代码编写任务后，执行以下流程：

1. **文档同步检查** — 审查相关文档（README.md、AGENTS.md 等），确保与代码变动一致。如有新增/删除/重命名的文件、接口变更、功能变更等，必须同步更新文档。
2. **提交代码** — 使用 `git add` + `git commit` 提交所有变更，commit message 遵循约定式提交格式（`feat:` / `fix:` / `docs:` / `refactor:` 等）。
3. **推送代码** — 执行 `git push` 推送到远程仓库。

## 注意事项

- 本项目无测试套件，无需运行测试
- `server.cjs` / `server2.cjs` 是独立的 Node.js 静态文件服务器脚本，用于在非开发环境提供 dist 目录
- `.env.example` 中的 `VITE_*` 环境变量仅作参考，实际配置通过应用内设置对话框完成
- `providers/` 目录保留了 ModelProvider 抽象接口，但当前服务层直接调用 API（未经过 adapter）
