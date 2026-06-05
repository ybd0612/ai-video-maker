# UI 组件

## 概述

wxhb 的 UI 组件位于 `src/components/`，负责侧边栏、任务管理、设置和提示横幅。

## 文件位置

```
src/components/
├── Sidebar.tsx          # 左侧边栏
├── TaskManager.tsx      # 任务管理器
├── SettingsDialog.tsx   # 设置对话框
└── ApiKeyBanner.tsx     # API Key 提示横幅
```

---

## Sidebar — 左侧边栏

### 布局

```
┌─────────────────────┐
│ AI Canvas           │ ← Logo 区
│ Infinite Canvas...  │
├─────────────────────┤
│ 拖拽到画布            │ ← 标题
│ ┌─────────────────┐ │
│ │ 💬 提示词        │ │ ← PaletteItem（可拖拽）
│ │   自由文本输入    │ │
│ ├─────────────────┤ │
│ │ 🔤 文本生成      │ │
│ │   LLM 文本生成    │ │
│ ├─────────────────┤ │
│ │ 🖼 图像生成      │ │
│ │   AI 图像创作     │ │
│ ├─────────────────┤ │
│ │ 🎬 视频生成      │ │
│ │   AI 视频生成     │ │
│ ├─────────────────┤ │
│ │ 📤 上传图片      │ │
│ │   本地图片上传    │ │
│ └─────────────────┘ │
├─────────────────────┤
│ 任务管理器区域        │ ← TaskManager 组件
├─────────────────────┤
│ ⚙ 设置              │ ← Footer 按钮
│ 🗑 清空画布          │
└─────────────────────┘
```

### PaletteItem 拖拽实现

```typescript
const onDragStart = (e: DragEvent) => {
  e.dataTransfer.setData("application/wxhb-node", nodeType);
  e.dataTransfer.effectAllowed = "move";
};
```

CanvasWorkspace 的 `onDrop` 读取此数据创建节点。

### 画布操作

- **设置** → 打开 SettingsDialog
- **清空画布** → 有节点时需确认 → `clearAll()`

---

## TaskManager — 任务管理器

### 功能

- 保存当前画布为命名任务
- 在任务间切换（自动保存当前画布）
- 重命名 / 删除任务
- 历史版本查看和恢复

### 布局

```
┌──────────────────────────┐
│ 💾 任务 / 当前任务名  ▼   │ ← 可折叠标题
├──────────────────────────┤
│ [输入任务名称...] [+新建] │ ← 操作栏
│ 点击切换（自动保存）       │
│ ┌──────────────────────┐ │
│ │ 📂 任务A (5) [H:3]  │ │ ← TabButton
│ │ 📂 任务B (3)  ★激活  │ │
│ └──────────────────────┘ │
└──────────────────────────┘
```

### TabButton

每个任务标签显示：
- 文件夹图标 + 名称 + 节点数
- 历史版本数（可展开查看）
- Hover 显示：重命名 / 删除按钮

### 切换流程

1. 捕获当前画布快照（`captureSnapshot()`）
2. 更新当前任务的 canvasData
3. 加载目标任务的 canvasData 到画布
4. 设置 activeTaskId

### 历史恢复

1. 捕获当前快照并保存
2. 从 history[index] 恢复 canvasData
3. 设置 activeTaskId

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
