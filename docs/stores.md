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
- **备份**：`saveBackup()` / `loadBackup()` 将图数据备份到 localStorage（键名 `wxhb-canvas-backup`），启动时可自动恢复丢失的任务

### 状态

```typescript
interface CanvasState {
  nodes: StoreNode[];  // Node<Record<string, unknown>>[]
  edges: Edge[];
  viewport: Viewport;  // { x, y, zoom }
}
```

### 版本迁移

`version: 2`，migrate 函数将 v1 的 `width` / `height` 字段迁移为统一的 `size` 字符串。

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
| `clearAll()` | 清空 IndexedDB（graphStore + blobStore）并重置状态 |

### Blob 存储

图片和视频输出存储为 URL（由 AI 模型返回），不存储为 base64 或二进制 Blob。大二进制通过独立的 IndexedDB 实例管理：

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
  folderId: string | null; // null = 根级别
  canvasData: CanvasSnapshot;
  createdAt: number;
  updatedAt: number;
}

interface Folder {
  id: string;              // "folder__{timestamp}_{counter}"
  name: string;
  createdAt: number;
}

interface CanvasSnapshot {
  nodes: Node[];
  edges: Edge[];
  viewport: Viewport;
  capturedAt: number;
}
```

### 状态

```typescript
interface TaskState {
  tasks: Task[];
  folders: Folder[];
  activeTaskId: string | null;
}
```

### 版本迁移

`version: 2`，migrate 函数将 v1 的 `width` / `height` 字段迁移为统一的 `size` 字符串。

### 文件夹操作

| 方法 | 说明 |
|------|------|
| `createFolder(name)` | 创建文件夹 |
| `renameFolder(id, name)` | 重命名文件夹 |
| `deleteFolder(id)` | 删除文件夹（其下任务移至根级别） |

### 任务操作

| 方法 | 说明 |
|------|------|
| `createTask(name, canvasData, folderId?)` | 创建新任务并设为激活 |
| `updateTask(id, updates)` | 更新任务字段（包括 canvasData） |
| `deleteTask(id)` | 删除任务 |
| `moveTask(taskId, folderId)` | 移动任务到指定文件夹（null = 根级别） |
| `setActiveTaskId(id)` | 设置激活任务 |
| `getTaskById(id)` | 查询任务 |

### ID 生成

```typescript
function newId(prefix: string): string {
  counter += 1;
  return `${prefix}__${Date.now()}_${counter}`;
}
```

- Task: `newId("task")` → `task__1717800000000_1`
- Folder: `newId("folder")` → `folder__1717800000000_2`