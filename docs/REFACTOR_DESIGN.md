# wxhb 重构设计方案：从画布工作流到一键成片流水线

> 本文档定义 wxhb 的重构方向：从通用节点编辑器收敛为文本 → 图片 → 视频 → 拼接导出的一键成片工作台。

---

## 1. 为什么要重构

当前版本已经实现了很强的通用能力：

- 无限画布
- 5 类节点（Prompt / Text / Image / Video / Upload）
- 自由连线与连接校验
- DAG 拓扑执行、循环检测、级联失败、重试、轮询恢复
- 任务树、文件夹、多任务切换、IndexedDB 持久化

但这些能力和你的核心目标并不完全一致。

### 你的核心目标

用户输入一段文字或想法，系统自动完成：

1. 生成脚本 / 分镜
2. 生成参考图
3. 生成视频
4. 拼接成片并导出

### 当前问题

1. 交互过重
   - 用户需要自己创建节点
   - 需要理解 Prompt / Text / Image / Video 的区别
   - 需要连线、选输入源、理解 text-in / image-in / video-in

2. 心智模型过重
   - 用户不是在做视频，而是在编工作流
   - 产品表达更像开发者工具，不像内容创作工具

3. 能力溢出
   - DAG、循环检测、局部执行、多任务文件夹管理都是通用编排能力
   - 对短视频成片这个目标来说，属于过剩设计

---

## 2. 重构目标

把 wxhb 从 AI 节点工作流编辑器重构为 AI 一键成片工作台。

### 新的核心原则

- 目标导向：用户关心成片，不是节点图
- 最少操作：输入内容 → 系统自动编排 → 看结果
- 逐步可见：脚本、图片、视频、成片每一步都可预览
- 局部可控：自动为主，手动微调为辅
- 工程可维护：用固定流水线替代通用 DAG，降低系统复杂度

---

## 3. 新产品形态

## 3.1 总体页面结构

`
┌─────────────────────────────────────────────────────────────┐
│ 顶部栏：项目标题 / 比例 / 时长 / 风格 / 语言 / 一键成片按钮   │
├──────────┬──────────────────────────────┬───────────────────┤
│ 左侧面板 │        中间预览区            │    右侧面板       │
│ 分镜列表 │  当前镜头的图片/视频预览      │  当前镜头属性编辑  │
│          │  成片预览                    │  重新生成图/视频   │
├──────────┴──────────────────────────────┴───────────────────┤
│ 底部状态栏：脚本 → 图片 → 视频 → 渲染 四阶段进度              │
└─────────────────────────────────────────────────────────────┘
`

## 3.2 左侧：分镜列表

- 显示当前项目的 shot 列表
- 每个 shot 卡片包含：
  - 镜头序号
  - 画面描述
  - 缩略图（如果有）
  - 状态徽章（idle / pending / success / failed）
- 支持：
  - 拖拽排序
  - 新增 / 删除镜头
  - 从主题一键生成分镜

## 3.3 中间：预览区

两种模式：

1. 单镜头模式
   - 显示当前选中 shot 的参考图、视频、脚本文案

2. 成片模式
   - 显示最终拼接后的视频
   - 支持播放、下载

## 3.4 右侧：属性编辑

只保留真正必要的参数：

- 文案（可微调）
- 画面描述（可微调）
- 镜头时长
- 是否重新生成图
- 是否重新生成视频

## 3.5 底部：阶段进度

固定显示四个阶段状态：

1. Script
2. Image
3. Video
4. Render

点击某个阶段可查看该阶段整体进度。

---

## 4. 新交互流程

## 4.1 标准流程

1. 用户新建项目
2. 输入主题 / 一句话想法 / 原始文案
3. 系统自动生成分镜列表
4. 用户确认或微调分镜
5. 系统批量生成参考图
6. 系统批量生成视频
7. 系统自动拼接成片
8. 用户预览 / 下载

## 4.2 微调流程

- 修改某个 shot 的文案 → 重新生成该 shot 图片 / 视频
- 替换某张参考图 → 重新生成该 shot 视频
- 调整 shot 顺序 → 重新渲染成片
- 保留已完成 shot，只重新生成失败 shot

---

## 5. 状态机设计

## 5.1 Project Status

`
idle
 → scripting
 → imaging
 → videoing
 → rendering
 → done
 → failed
`

## 5.2 Shot Status

`
idle
 → scripting
 → scripted
 → imaging
 → imaged
 → videoing
 → videoed
 → failed
`

## 5.3 RenderJob Status

`
idle
 → pending
 → processing
 → done
 → failed
`

---

## 6. 数据模型设计

## 6.1 Project

`	s
interface Project {
  id: string;
  title: string;
  aspectRatio: '9:16' | '16:9' | '1:1';
  style?: string;
  language: 'zh' | 'en';
  shots: Shot[];
  status: ProjectStatus;
  outputUrl?: string;
  createdAt: number;
  updatedAt: number;
}
`

## 6.2 Shot

`	s
interface Shot {
  id: string;
  index: number;
  scriptText: string;
  visualPrompt: string;
  duration: number;
  status: ShotStatus;
  imageUrl?: string;
  videoUrl?: string;
  error?: string;
}
`

## 6.3 RenderJob

`	s
interface RenderJob {
  id: string;
  projectId: string;
  status: RenderJobStatus;
  progress: number;
  outputUrl?: string;
  error?: string;
}
`

---

## 7. 新目录结构建议

`
src/
├── app/
│   └── App.tsx
├── i18n/
│   └── index.ts
├── stores/
│   ├── settingsStore.ts
│   └── projectStore.ts
├── pages/
│   └── ProjectWorkspace.tsx
├── features/
│   ├── script/
│   │   ├── ScriptPanel.tsx
│   │   └── useScriptGenerator.ts
│   ├── shots/
│   │   ├── ShotList.tsx
│   │   ├── ShotEditor.tsx
│   │   └── useShotActions.ts
│   ├── preview/
│   │   ├── ShotPreview.tsx
│   │   └── FinalPreview.tsx
│   ├── render/
│   │   └── useRenderJob.ts
│   └── settings/
│       └── ProjectSettingsBar.tsx
├── services/
│   ├── agnes/
│   │   ├── AgnesAdapter.ts
│   │   ├── imageService.ts
│   │   ├── videoService.ts
│   │   └── scriptService.ts
│   ├── renderService.ts
│   └── pipelineService.ts
├── lib/
│   ├── resolveBaseUrl.ts
│   └── validation.ts
└── styles/
    └── globals.css
`

---

## 8. 新模块职责

## 8.1 projectStore

职责：
- 管理 project 元信息
- 管理 shots
- 管理当前选中镜头
- 管理整体状态
- 持久化到 localStorage / IndexedDB

不再负责：
- nodes / edges
- 通用 DAG 图结构
- 任务树文件夹管理

## 8.2 pipelineService

职责：
- 协调四阶段执行顺序
- 支持全部执行和单镜头执行
- 支持失败重试
- 汇总错误与进度

## 8.3 scriptService

职责：
- 接收主题 / 原始文案
- 生成结构化分镜
- 输出每个 shot 的 scriptText、visualPrompt、duration

## 8.4 imageService

职责：
- 根据 visualPrompt 生成图片
- 支持单张 / 批量
- 支持参考图替换

## 8.5 videoService

职责：
- 根据 imageUrl + visualPrompt 生成视频
- 复用已有的异步任务轮询机制
- 支持单镜头重试

## 8.6 renderService

职责：
- 按 shot 顺序拼接视频
- 可选：加字幕、旁白、音乐
- 输出最终 MP4 URL

---

## 9. API 调用设计

## 9.1 脚本生成

- Input：project config + user prompt
- Output：Shot 数组

建议先用文本模型一次性输出 JSON：

`json
{
  "shots": [
    {
      "scriptText": "...",
      "visualPrompt": "...",
      "duration": 5
    }
  ]
}
`

## 9.2 图片生成

- Input：visualPrompt, aspectRatio
- Output：imageUrl

复用现有 Agnes image API。

## 9.3 视频生成

- Input：imageUrl, visualPrompt, duration, aspectRatio
- Output：videoUrl

复用现有 Agnes async video task + poll。

## 9.4 拼接渲染

- Input：Shot 数组（按顺序）
- Output：final video url

可选方案：
1. FFmpeg.wasm（前端）
2. 后端 FFmpeg service
3. 云端转码服务

建议 MVP 先做：
- 前端预览拼接顺序
- 后端或本地 FFmpeg 真正拼接

---

## 10. 与当前代码的关系

## 10.1 建议保留

- AgnesAdapter：保留作为 API 适配层基础
- settingsStore：保留 API Key / Base URL / 语言 / 暗色模式
- resolveBaseUrl：保留
- Lightbox / ConfirmDialog / HelpTooltip：保留
- i18n：保留
- 视频轮询机制思路：保留

## 10.2 建议移除或弱化

- CanvasWorkspace
- canvasStore
- taskStore
- TaskTreeView
- PropertiesPanel
- 5 类节点组件
- TypedEdge
- validateConnection
- useWorkflowRunner

这些组件都是为通用工作流编辑服务的，不适合新方向。

---

## 11. MVP 路线图

## Phase 1：脚本 + 参考图

目标：
- 验证输入主题 → 生成分镜 → 生成图的体验

功能：
- 新建项目
- 输入主题
- 生成 shots
- 每个 shot 生成参考图
- 左侧列表 + 中间预览 + 右侧微调

## Phase 2：单镜头视频生成

功能：
- 每个 shot 独立生成视频
- 支持单镜头重试
- shot 状态展示
- 视频预览

## Phase 3：拼接与导出

功能：
- 按 shot 顺序拼接
- 输出最终 MP4
- 下载成片
- 失败镜头提示与修复入口

## Phase 4：体验增强

功能：
- 字幕
- 旁白 / TTS
- 背景音乐
- 片头片尾模板
- 风格模板
- 比例模板
- 多语言版本导出

---

## 12. 成功标准

## 产品成功标准

- 用户能在 3 步内开始生成视频
- 不需要理解节点、连线、DAG
- 输入一个主题，10 分钟内看到成片原型
- 单镜头失败不影响整体理解流程

## 工程成功标准

- 删除通用画布编辑器相关复杂度
- pipeline 状态可预测、可重试、可观测
- 代码规模明显下降
- 新功能迭代速度更快

---

## 13. 结论

wxhb 不应继续走通用 AI 工作流编辑器的路线。

更合理的方向是：

> 把产品收敛为 AI 短视频成片工具
> 输入想法 → 生成脚本 → 生成参考图 → 生成视频 → 拼接成片

这样更贴近真实用户需求，也更容易做成一个完整、可用、可持续迭代的产品。
