# 连接规则

## 概述

节点之间通过 Handle（端口）连接。每个 Handle 有类型约束，只有允许的类型组合才能建立连线。

## 文件位置

- `src/canvas/types.ts` — Handle 定义和连接规则矩阵
- `src/canvas/validateConnection.ts` — 校验逻辑

## Handle 类型系统

### 数据类型

Handle 有 4 种数据类型（`dataType`）：

| 类型 | 含义 | 颜色 |
|------|------|------|
| `text` | 文本数据流 | 天蓝 `#38bdf8` |
| `image` | 图像数据流 | 紫色 `#a78bfa` |
| `video` | 视频数据流 | 琥珀 `#fbbf24` |
| `prompt` | 提示词输入 | 翡翠绿 `#34d399` |

> **注意**：`prompt` 类型在 `ALLOWED_CONNECTIONS` 中定义了 `text → prompt` 规则，但当前没有任何 Handle 实际使用 `dataType: "prompt"`。Prompt 节点的 `prompt-out` Handle 的 `dataType` 为 `"text"`。因此 `text → prompt` 规则实际上是死代码，不影响当前行为。

### 方向

每个 Handle 有方向属性：
- `source` — 输出端口（节点右侧）
- `target` — 输入端口（节点左侧）

## 各节点的 Handle 配置

### Prompt 节点

| Handle ID | 方向 | 数据类型 |
|-----------|------|----------|
| `prompt-out` | source | text |

### Upload 节点

| Handle ID | 方向 | 数据类型 |
|-----------|------|----------|
| `image-out` | source | image |

### Text 节点

| Handle ID | 方向 | 数据类型 |
|-----------|------|----------|
| `text-in` | target | text |
| `text-out` | source | text |

### Image 节点

| Handle ID | 方向 | 数据类型 |
|-----------|------|----------|
| `image-in` | target | image |
| `text-in` | target | text |
| `image-out` | source | image |

### Video 节点

| Handle ID | 方向 | 数据类型 |
|-----------|------|----------|
| `video-in` | target | video |
| `image-in` | target | image |
| `text-in` | target | text |
| `video-out` | source | video |

## 允许的连接矩阵

定义在 `ALLOWED_CONNECTIONS` 中：

| 源端口类型 | → | 目标端口类型 | 说明 |
|-----------|---|-------------|------|
| text | → | text | 文本 → 文本（串联 LLM） |
| text | → | prompt | 文本 → 提示词（死规则，见上文注释） |
| image | → | image | 图像 → 图像（串联处理） |
| image | → | video | 图像 → 视频（图生视频） |
| video | → | video | 视频 → 视频（串联处理） |

### 不被允许的连接示例

- text → image（文本不能直接连图像输入）
- text → video（文本不能直接连视频的 image-in）
- video → image
- video → text
- prompt → anything（prompt 节点只有输出，没有输入）

## 校验逻辑

### validateCanvasConnection()

```typescript
function validateCanvasConnection(
  connection: Connection,
  nodes: Node[],
  existingEdges?: Edge[],
): boolean
```

校验步骤：
1. **自连检查** — source === target → 拒绝
2. **Handle 解析** — 根据 nodeId + handleId + direction 找到 HandleSpec
3. **重复检查** — 如果已有相同的 source + target + sourceHandle + targetHandle → 拒绝
4. **规则匹配** — 在 `ALLOWED_CONNECTIONS` 中查找 sourceDataType + targetDataType 组合

### explainRejection()

返回人类可读的拒绝原因字符串，用于调试和用户提示。校验逻辑与 `validateCanvasConnection` 一致。

## 上游输入的工作流语义

连接不仅约束 UI，还在工作流执行时决定数据流向：

- **text-in** 接收上游的文本输出（LLM 结果或 Prompt 文本），拼接后作为下游节点的 prompt
- **image-in** 接收上游的图像 URL，用于图生图或图生视频
- **video-in** 接收上游的视频 URL（目前用于串联）

`gatherInputs()` 函数在 `useWorkflowRunner.ts` 中实现，遍历所有指向当前节点的边，按 handle 类型收集上游输出。