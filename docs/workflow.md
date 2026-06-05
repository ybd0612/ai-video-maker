# 工作流执行引擎

## 概述

工作流执行引擎负责按拓扑顺序执行画布上的节点，支持循环检测、局部执行和级联失败。

## 文件位置

`src/canvas/hooks/useWorkflowRunner.ts`

## 核心算法

### 1. 循环检测 — DFS 白/灰/黑着色

```typescript
function detectCycle(nodes, edges): { hasCycle: boolean; cyclePath: string[] }
```

- **白色 (0)** — 未访问
- **灰色 (1)** — 正在访问（在当前 DFS 栈中）
- **黑色 (2)** — 已完成

当 DFS 遇到灰色节点时，说明发现环路。通过 parent 指针回溯得到环路路径。

如果检测到循环，引擎拒绝执行并返回 cyclePath 供 UI 显示。

### 2. 拓扑排序 — Kahn 算法 (BFS)

```typescript
function topoSort(nodes, edges): string[]
```

1. 计算每个节点的入度
2. 将入度为 0 的节点入队
3. BFS：出队一个节点 → 加入排序结果 → 其邻居入度减 1 → 入度为 0 的入队
4. 最终得到执行顺序

### 3. 下游发现 — BFS

```typescript
function findDownstream(startId, edges): Set<string>
```

从指定节点出发，BFS 遍历所有下游节点。用于局部执行：只执行 startNodeId 及其下游。

### 4. 上游输入收集

```typescript
function gatherInputs(nodeId, edges): { textInputs: string[]; imageInputs: string[]; videoInputs: string[] }
```

遍历所有指向 nodeId 的边，根据 targetHandle 类型分类收集上游输出：
- `text-in` → 从上游读取 `prompt` 或 `output`
- `image-in` → 从上游读取 `outputUrl` 或 `base64Data`
- `video-in` → 从上游读取 `outputUrl`

## 执行流程

### 入口

```typescript
const { run, cancel } = useWorkflowRunner();
```

- `run(opts?)` — 启动执行（自动取消上一次未完成的执行）
- `cancel()` — 通过 AbortController 取消

### runWorkflow 内部流程

1. **前置检查**
   - 检查 API Key 是否配置
   - 检查是否有节点
   - 循环检测
2. **确定执行范围**
   - 如果指定了 `startNodeId`，用 `findDownstream()` 只取相关节点
   - 否则执行全部节点
3. **拓扑排序**
4. **重置执行状态**
5. **逐节点执行**

### 节点执行分支

#### Prompt 节点
不执行 API 调用，仅标记为 success。数据在 gatherInputs 时被读取。

#### Text 节点
```
gatherInputs → AgnesAdapter.generateText() → 更新 output
```

#### Image 节点
```
gatherInputs → AgnesAdapter.generateImage() → 更新 outputUrl
```

#### Video 节点（异步）
```
gatherInputs → AgnesAdapter.createVideoTask() → 轮询 → 更新 outputUrl
```

轮询参数：
- 间隔：3 秒
- 超时：10 分钟
- 支持 AbortController 取消

#### Upload 节点
不执行 API 调用，标记为 success。base64 数据在 gatherInputs 时被读取。

### 错误处理

#### 级联失败

当节点执行失败时：
1. 标记当前节点为 failed + 设置 errorMessage
2. BFS 找出所有下游节点
3. 所有下游节点标记为 failed + errorMessage = "Upstream node failed"
4. 中断执行

#### 错误日志

每个失败操作都通过 `cascadeNodeStates()` 写入 executionLogs。

### 执行结果

```typescript
interface WorkflowRunResult {
  success: boolean;
  executedNodeIds: string[];
  failedNodeId?: string;
  error?: string;
}
```

## 选项

```typescript
interface WorkflowRunOptions {
  startNodeId?: string;  // 局部执行起点
  signal?: AbortSignal;  // 取消信号
}
```

## 常量

| 常量 | 值 | 说明 |
|------|-----|------|
| `VIDEO_POLL_INTERVAL_MS` | 3000 | 视频轮询间隔 |
| `VIDEO_POLL_TIMEOUT_MS` | 600000 (10min) | 视频轮询超时 |
