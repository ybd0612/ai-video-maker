# 状态管理

## 概述

wxhb 使用 3 个 Zustand store 管理全局状态，各自有不同的持久化策略。

## 文件位置

```
src/stores/
├── canvasStore.ts    # 画布状态 → IndexedDB (localForage)
├── settingsStore.ts  # 应用设置 → localStorage
└── taskStore.ts      # 任务管理 → localStorage
```

---

## canvasStore — 画布状态

### 持久化

- **后端**：IndexedDB（通过 localForage）
- **实例名**：`wxhb`
- **存储名**：`canvas-graph`（图数据）、`canvas-blobs`（二进制）
- **策略**：Zustand persist + 自定义 localForage adapter

### 状态

```typescript
interface CanvasState {
  nodes: StoreNode[];  // Node<Record<string, unknown>>[]
  edges: Edge[];
  viewport: Viewport;  // { x, y, zoom }
}
```

### Graph 操作

| 方法 | 说明 |
|------|------|
| `setNodes(nodes)` | 批量设置节点 |
| `setEdges(edges)` | 批量设置边 |
| `setViewport(viewport)` | 设置视口 |
| `addNode(node)` | 追加一个节点 |
| `removeNode(nodeId)` | 删除节点及其关联边 |
| `updateNodeData(nodeId, data)` | 部分更新节点 data 字段 |

### 执行状态操作

| 方法 | 说明 |
|------|------|
| `setNodeExecutionStatus(id, status)` | 设置单个节点状态 |
| `appendNodeLog(id, log)` | 追加执行日志 |
| `setNodeErrorMessage(id, msg)` | 设置错误信息 |
| `cascadeNodeStates(updates)` | 批量更新多个节点状态+日志 |
| `resetExecutionStates()` | 重置所有节点为 idle + 清空日志 |

### 快照操作

| 方法 | 说明 |
|------|------|
| `loadSnapshot(snap)` | 从快照恢复（设置 canvasLoadInProgress 标志） |
| `clearAll()` | 清空 IndexedDB + 重置状态 |

### Blob 存储

大二进制（图片/视频）不放入 store state，通过独立的 IndexedDB 实例管理：

```typescript
// 导出函数
persistBlob(key, data): Promise<string>   // 存储，返回 key
retrieveBlob(key): Promise<Blob | ArrayBuffer | null>  // 读取
deleteBlob(key): Promise<void>  // 删除
```

Blob 实例：`wxhb` → `canvas-blobs`

### canvasLoadInProgress 标志

导出的布尔标志，防止 loadSnapshot 期间的 auto-save 覆盖加载数据。恢复后 200ms 自动重置。

---

## settingsStore — 应用设置

### 持久化

- **后端**：localStorage
- **键名**：`wxhb-settings`

### 状态

```typescript
interface SettingsState {
  showGrid: boolean;      // 默认 true
  showMinimap: boolean;   // 默认 true
  snapToGrid: boolean;    // 默认 false
  darkMode: boolean;      // 默认 true
  language: Language;      // "zh" | "en"，默认 "zh"
  settingsDialogOpen: boolean;
  providerConfig: {
    apiKey: string;
    baseUrl: string;      // 默认 "https://apihub.agnes-ai.com/v1"
  };
}
```

### 操作

| 方法 | 说明 |
|------|------|
| `toggleGrid()` | 切换网格显示 |
| `toggleMinimap()` | 切换缩略图 |
| `toggleSnapToGrid()` | 切换吸附网格 |
| `toggleDarkMode()` | 切换暗色模式 |
| `setLanguage(lang)` | 设置语言 |
| `setSettingsDialogOpen(open)` | 控制设置对话框 |
| `setProviderConfig(config)` | 更新 API 配置（部分合并） |

---

## taskStore — 任务管理

### 持久化

- **后端**：localStorage
- **键名**：`wxhb-tasks`

### 数据模型

```typescript
interface Task {
  id: string;              // "task__{timestamp}_{counter}"
  name: string;
  description: string;
  canvasData: CanvasSnapshot;
  history: HistoryEntry[]; // 最多 20 条
  createdAt: number;
  updatedAt: number;
}

interface CanvasSnapshot {
  nodes: Node[];
  edges: Edge[];
  viewport: Viewport;
  capturedAt: number;
}

interface HistoryEntry {
  canvasData: CanvasSnapshot;
  savedAt: number;
  label: string;
}
```

### 状态

```typescript
interface TaskState {
  tasks: Task[];
  activeTaskId: string | null;
}
```

### 操作

| 方法 | 说明 |
|------|------|
| `createTask(name, canvasData, desc?)` | 创建新任务并设为激活 |
| `updateTask(id, updates)` | 更新任务（canvasData 变更时自动推历史） |
| `deleteTask(id)` | 删除任务 |
| `setActiveTaskId(id)` | 设置激活任务 |
| `getTaskById(id)` | 查询任务 |
| `pushHistory(taskId, label?)` | 手动推入历史快照 |
| `restoreFromHistory(taskId, index)` | 从历史恢复（当前状态推入历史） |

### 历史回溯机制

- `updateTask()` 更新 canvasData 时，自动将旧数据推入 history
- `restoreFromHistory()` 恢复前，将当前状态推入 history（防止丢失）
- history 最多保留 20 条（`slice(-20)`）
- 每条 history 的 label 默认为保存时间

### ID 生成

```typescript
function newId(): string {
  counter += 1;
  return `task__${Date.now()}_${counter}`;
}
```
