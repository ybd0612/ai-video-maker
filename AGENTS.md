# wxhb — AI Canvas Creator

面向 AI 创作的无限画布工作台。基于 React Flow 构建节点式工作流编辑器，集成 Agnes AI 的文本、图像、视频三大模型，支持拖拽编排、拓扑执行和中英文切换。

## 技术栈

- React 18 + TypeScript 6 + Vite 8
- React Flow v12（`@xyflow/react`）— 画布核心
- Zustand v5 — 状态管理
- localForage — IndexedDB 持久化（画布图 + 二进制 Blob）
- TailwindCSS v4 + Framer Motion — 样式与动画
- Lucide React — 图标库

## 项目结构

```
src/
├── i18n/                      # 轻量 i18n 系统（无第三方依赖）
│   └── index.ts               # zh/en 翻译字典 + useT hook + getTranslation
├── canvas/                    # 画布核心
│   ├── CanvasWorkspace.tsx    # 主画布组件（React Flow）
│   ├── types.ts               # 节点数据类型、模型注册表、Handle 配置、连接规则
│   ├── validateConnection.ts  # 连线校验规则
│   ├── hooks/
│   │   └── useWorkflowRunner.ts  # 工作流执行引擎（拓扑排序 + 循环检测 + 级联失败）
│   ├── nodes/                 # 5 种自定义节点：Prompt / Text / Image / Video / Upload
│   ├── edges/                 # 自定义连线样式（TypedEdge）
│   └── panels/                # 属性编辑面板（PropertiesPanel）
├── components/                # UI 组件
│   ├── Sidebar.tsx            # 左侧拖拽面板
│   ├── TaskManager.tsx        # 任务管理器
│   ├── SettingsDialog.tsx     # 设置对话框
│   ├── ApiKeyBanner.tsx       # API Key 提示横幅
│   └── ui/                    # 通用 UI 组件
├── stores/                    # Zustand stores
│   ├── canvasStore.ts         # 画布状态（nodes/edges/viewport，IndexedDB 持久化）
│   ├── settingsStore.ts       # 全局设置（apiKey/baseUrl/language/darkMode，localStorage）
│   └── taskStore.ts           # 任务管理（多画布 + 最多 20 版历史回溯，localStorage）
├── providers/                 # AI 模型抽象层
│   ├── types.ts               # ModelProvider 接口 + 参数/结果类型定义
│   └── agnes/
│       └── AgnesAdapter.ts    # Agnes AI 适配器（文本/图像/视频）
├── lib/
│   └── resolveBaseUrl.ts      # API 地址解析工具
├── styles/
│   └── globals.css            # 全局样式 + React Flow 覆写
├── App.tsx                    # 根组件
└── main.tsx                   # 入口文件
```

## 命令

- `npm run dev` — 启动开发服务器（端口 3000）
- `npm run build` — TypeScript 检查 + Vite 生产构建
- `npm run preview` — 预览生产版本（端口 5180）
- `python "C:\Users\ybd06\Documents\project\pm\python\conversation_hook.py" "标题" "行1" "行2" "行3"` — OLED 屏幕摘要

## 路径别名

`@/` 映射到 `src/`（通过 `vite.config.ts` 和 `tsconfig.json` 的 `paths` 配置）。

## 编码规范

- TypeScript `strict: true`，开启 `noUnusedLocals` / `noUnusedParameters`
- 使用 `verbatimModuleSyntax` — 类型导入必须用 `import type`
- `erasableSyntaxOnly: true` — 禁止使用需要运行时擦除的 TS 语法（如 enum）
- 节点数据类型采用判别联合（discriminated union），在 `src/canvas/types.ts` 集中定义
- 状态管理使用 Zustand + persist 中间件：画布数据走 IndexedDB，设置走 localStorage
- 大二进制输出（图片/视频）通过 `canvasStore` 的 `persistBlob` / `retrieveBlob` 存取 IndexedDB，不放入 store state
- 国际化使用自研 `useT()` hook，翻译键在 `src/i18n/index.ts` 的 `zh` / `en` 字典中
- 新增翻译键时必须同时添加 zh 和 en 两个字典

## AI Provider 架构

- 抽象接口在 `src/providers/types.ts`，定义 `ModelProvider` 接口
- 具体实现在 `src/providers/agnes/AgnesAdapter.ts`（当前唯一适配器）
- 模型注册表在 `src/canvas/types.ts` 的 `MODEL_REGISTRY` 中
- 替换模型只需修改 `MODEL_REGISTRY` 或新增一个 `ModelProvider` 实现
- API Key 和 Base URL 由用户在设置对话框中配置，存储在浏览器本地

## 工作流执行引擎

核心在 `src/canvas/hooks/useWorkflowRunner.ts`：
- **循环检测**：DFS 白/灰/黑着色法
- **拓扑排序**：Kahn 算法（BFS）
- **下游发现**：BFS 找出受影响的下游节点，支持局部执行
- **级联失败**：上游失败自动标记所有下游为 failed
- **视频轮询**：异步任务 + 3 秒间隔轮询，10 分钟超时
- 支持 AbortController 取消

## 连接规则

节点之间的 Handle 有类型约束（`text` / `image` / `video` / `prompt`），在 `ALLOWED_CONNECTIONS` 中定义：
- `text → text` / `text → prompt`
- `image → image` / `image → video`
- `video → video`

## 注意事项

- 本项目无测试套件，无需运行测试
- `server.cjs` / `server2.cjs` 是独立的 Node.js 静态文件服务器脚本，用于在非开发环境提供 dist 目录
- `prompt-text-workflow.mjs` 是独立的工作流脚本工具
- `.env.example` 中的 `VITE_*` 环境变量仅作参考，实际配置通过应用内设置对话框完成