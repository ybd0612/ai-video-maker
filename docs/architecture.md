# 系统架构

## 技术栈

| 层级 | 技术 | 版本 | 用途 |
|------|------|------|------|
| 框架 | React | 18 | UI 渲染 |
| 语言 | TypeScript | 6 | 类型安全 |
| 构建 | Vite | 8 | 开发服务器 + 生产打包 |
| 画布 | React Flow (`@xyflow/react`) | v12 | 无限画布、节点、连线 |
| 状态 | Zustand | v5 | 全局状态管理 |
| 持久化 | localForage | — | IndexedDB 存储（画布图 + 二进制 Blob） |
| 样式 | TailwindCSS | v4 | 原子化 CSS |
| 动画 | Framer Motion | — | 过渡动画（SettingsDialog 等） |
| 图标 | Lucide React | — | 图标库 |

## 项目结构

```
src/
├── App.tsx                       # 根组件：Sidebar + Canvas + Settings
├── main.tsx                      # 入口
├── i18n/                         # 自研 i18n（零依赖）
│   └── index.ts                  # zh/en 字典 + useT + getTranslation
├── canvas/                       # 画布核心模块
│   ├── CanvasWorkspace.tsx       # 主画布（React Flow 容器）
│   ├── types.ts                  # 节点数据类型、模型注册表、Handle 配置
│   ├── validateConnection.ts     # 连线校验
│   ├── hooks/
│   │   └── useWorkflowRunner.ts  # 工作流执行引擎
│   ├── nodes/                    # 5 种自定义节点
│   │   ├── index.ts              # nodeTypes 注册表
│   │   ├── NodeShell.tsx         # 公共节点外壳
│   │   ├── StatusBadge.tsx       # 执行状态徽章
│   │   ├── PromptNode.tsx
│   │   ├── TextNode.tsx
│   │   ├── ImageNode.tsx
│   │   ├── VideoNode.tsx
│   │   └── UploadNode.tsx
│   ├── edges/                    # 自定义连线
│   │   ├── index.ts
│   │   └── TypedEdge.tsx
│   └── panels/
│       └── PropertiesPanel.tsx   # 右侧属性编辑面板
├── components/                   # UI 组件
│   ├── Sidebar.tsx               # 左侧面板（节点调色板 + 任务管理器）
│   ├── TaskManager.tsx           # 任务管理（多画布 + 历史回溯）
│   ├── SettingsDialog.tsx        # 设置对话框
│   └── ApiKeyBanner.tsx          # API Key 提示横幅
├── stores/                       # Zustand stores
│   ├── canvasStore.ts            # 画布状态 + IndexedDB 持久化
│   ├── settingsStore.ts          # 全局设置 + localStorage
│   └── taskStore.ts              # 任务管理 + localStorage
├── providers/                    # AI 模型抽象层
│   ├── types.ts                  # ModelProvider 接口
│   └── agnes/
│       └── AgnesAdapter.ts       # Agnes AI 适配器
├── lib/
│   └── resolveBaseUrl.ts         # URL 清理工具
└── styles/
    └── globals.css               # 全局样式 + React Flow 覆写
```

## 数据流概览

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   Sidebar    │────▶│  CanvasWorkspace  │────▶│ PropertiesPanel  │
│  (拖拽添加)   │     │  (React Flow)     │     │  (属性编辑)       │
└─────────────┘     └────────┬─────────┘     └──────────────────┘
                             │
                    ┌────────▼─────────┐
                    │   canvasStore     │◀──── IndexedDB (localForage)
                    │  (nodes/edges)    │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐     ┌──────────────────┐
                    │ useWorkflowRunner │────▶│  AgnesAdapter     │────▶ Agnes API
                    │ (拓扑执行)        │     │  (Provider)       │
                    └──────────────────┘     └──────────────────┘
```

## 模块依赖关系

- **App.tsx** → Sidebar, CanvasWorkspace, SettingsDialog, ApiKeyBanner
- **CanvasWorkspace** → canvasStore, settingsStore, taskStore, useWorkflowRunner, nodeTypes, edgeTypes, validateConnection
- **节点组件** → canvasStore, NodeShell, types（节点数据类型）
- **useWorkflowRunner** → canvasStore, settingsStore, AgnesAdapter（通过 providers/types）
- **TaskManager** → taskStore, canvasStore
- **SettingsDialog** → settingsStore
- **Sidebar** → settingsStore, canvasStore, TaskManager

## 路径别名

`@/` 映射到 `src/`（配置在 `vite.config.ts` 和 `tsconfig.json`）。

## 编码约束

- TypeScript `strict: true`，`noUnusedLocals` / `noUnusedParameters`
- `verbatimModuleSyntax` — 类型导入必须用 `import type`
- `erasableSyntaxOnly: true` — 禁止 enum 等需运行时擦除的语法
- 节点数据采用判别联合（discriminated union）
- 大二进制通过 IndexedDB Blob 存储，不放入 store state
