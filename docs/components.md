# UI 组件

## 概述

wxhb 的 UI 组件位于 `src/components/`，负责侧边栏、任务管理、设置和提示横幅。PropertiesPanel 位于 `src/canvas/panels/`。

## 文件位置

```
src/components/
├── Sidebar.tsx          # 左侧面板（设置 + 清空画布）
├── TaskTreeView.tsx     # 树形任务管理器（文件夹 + 任务 + 右键菜单）
├── TaskManager.tsx      # 任务管理器（旧版，已弃用）
├── SettingsDialog.tsx   # 设置对话框
├── ApiKeyBanner.tsx     # API Key 提示横幅
└── ui/                  # 通用 UI 组件
    ├── ConfirmDialog.tsx
    ├── ContextMenu.tsx
    ├── HelpTooltip.tsx
    ├── Lightbox.tsx
    └── NumberInput.tsx

src/canvas/panels/
└── PropertiesPanel.tsx  # 右侧属性编辑面板
```

---

## Sidebar — 左侧边栏

### 布局

```
┌─────────────────────┐
│ AI Canvas           │ ← Logo 区
│ Infinite Canvas...  │
├─────────────────────┤
│                     │
│  TaskTreeView       │ ← 树形任务管理器（flex-1，可滚动）
│  (文件夹 + 任务)     │
│                     │
├─────────────────────┤
│ ⚙ 设置              │ ← Footer 按钮
│ 🗑 清空画布          │
└─────────────────────┘
```

### 画布操作

- **设置** → 打开 SettingsDialog
- **清空画布** → 有节点时需确认 → `clearAll()`

---

## TaskTreeView — 树形任务管理器

### 概述

替代旧版 TaskManager，提供文件夹 + 任务的树形结构管理，支持右键菜单操作和内联编辑。

### 功能

- 文件夹 + 任务的树形展示
- 右键上下文菜单（新建任务、新建文件夹、重命名、删除）
- 内联可编辑标签
- 自动保存切换（captureSnapshot → updateTask → setActiveTaskId → loadSnapshotIntoCanvas）
- 启动时备份恢复（如果任务为空但 localStorage 备份存在）

### 布局

```
┌──────────────────────────┐
│ 📁 我的项目               │ ← 文件夹节点
│   ├── 📄 任务A (5)       │ ← 任务节点
│   └── 📄 任务B (3)  ★    │ ← 激活任务标记
│ 📁 另一个项目             │
│   └── 📄 任务C            │
│ 📄 根级别任务              │ ← 无文件夹
└──────────────────────────┘
```

### 右键菜单

| 操作 | 说明 |
|------|------|
| 新建任务 | 在当前文件夹下创建新任务 |
| 新建文件夹 | 创建新文件夹 |
| 重命名 | 内联编辑名称 |
| 删除 | 删除任务或文件夹 |

### 切换流程

1. 捕获当前画布快照（`captureSnapshot()`）
2. 更新当前任务的 canvasData
3. 设置 activeTaskId
4. 加载目标任务的 canvasData 到画布

### 防竞态标志

导出 `isSwitchingTask` 标志，防止任务切换期间的 auto-save 造成数据覆盖。

---

## PropertiesPanel — 右侧属性面板

### 概述

选中节点时在画布右侧显示，提供节点的完整属性编辑、执行日志查看和输出预览。

### 文件位置

`src/canvas/panels/PropertiesPanel.tsx`

### 显示条件

- 选中节点时显示（`selectedNodeId !== null`）
- 点击画布空白处或关闭按钮隐藏

### 布局

```
┌──────────────────────────┐
│ 节点标签    ▶ ↻ ✕        │ ← Header（sticky）
├──────────────────────────┤
│ LABEL                    │
│ [节点标签输入框]           │
├──────────────────────────┤
│ 节点类型特有字段           │ ← 按节点类型动态渲染
│ （见下方各类型详情）       │
├──────────────────────────┤
│ 日志 (N)                 │ ← 可折叠日志区
│ ┌──────────────────────┐ │
│ │ 12:30:01 — 执行开始   │ │
│ │ 12:30:03 — 生成成功   │ │
│ └──────────────────────┘ │
└──────────────────────────┘
```

### Header 操作

| 按钮 | 功能 |
|------|------|
| ▶ Play | 运行此节点（`run({ startNodeId })`） |
| ↻ RotateCcw | 重置所有节点执行状态 |
| ✕ X | 关闭面板 |

### 节点类型特有字段

#### TextNodeFields

- Model 下拉（从 `MODEL_REGISTRY.text` 读取）
- Prompt textarea
- System Prompt textarea
- Temperature 数字输入
- Max Tokens 数字输入
- 文本输出预览区（显示 `output` 字段）

#### ImageNodeFields

- Model 下拉（从 `MODEL_REGISTRY.image` 读取）
- Prompt textarea
- Size 下拉（预设尺寸选项，如 1024x1024、576x1024 等）
- Count 数字输入（1-10，批量生成数量）
- Quality 显示（"standard"）
- 输出图片预览（多图时显示网格，来自 `outputUrls[]`）

#### VideoNodeFields

- Prompt textarea
- Negative Prompt textarea
- Size 下拉（预设尺寸：1280x720、720x1280、1024x1024 等）
- FPS 下拉（24 / 30 / 60）
- Duration 下拉（3 / 5 / 10 / 18 秒，自动计算帧数）
- NumFrames 显示（通过 `calcNumFrames(duration, fps)` 自动计算）
- Count 数字输入（1-5，批量生成数量）
- Seed 数字输入（0 = 随机）
- Mode 选择（normal / keyframe）
- 任务 ID / 进度显示
- 视频输出播放器（多个视频时循环显示，来自 `outputUrls[]`）

#### PromptNodeFields

- System Prompt textarea
- Output Modality 下拉（text / image / video）

#### UploadNodeFields

- 文件信息（名称、类型）
- 图片预览
- 无图片时提示"暂无图片"

### 日志区

- 可折叠（details/summary）
- 显示日志条数
- 每条日志：时间戳 + 消息
- 最大高度 160px，溢出滚动

---

## SettingsDialog — 设置对话框

### 功能

- API Key 配置（支持显示/隐藏切换）
- API Base URL 配置
- 连接测试（发送 "ping-ok" 请求验证）
- 语言切换（zh / en）
- Toast 通知

### 动画

使用 Framer Motion：
- 背景淡入淡出
- 对话框缩放弹出
- Toast 从顶部滑入

### 连接测试

发送一个简单的 chat/completions 请求：
```json
{
  "model": "agnes-2.0-flash",
  "messages": [{ "role": "user", "content": "Reply with exactly: ping-ok" }],
  "temperature": 0,
  "max_tokens": 32
}
```

响应中包含 "ping-ok" → 成功，否则显示响应预览。

### 存储

- 设置保存到 `settingsStore` → localStorage
- API Key 存储在浏览器本地，不会上传

---

## ApiKeyBanner — API Key 提示横幅

### 行为

- 当 API Key 为空时，在画布顶部显示警告横幅
- 首次访问时自动打开 SettingsDialog（通过 `autoOpened` ref 防止重复）
- API Key 配置后自动隐藏（返回 null）

### 内容

- ⚠️ 警告图标 + 提示文本
- "Open Settings" 按钮