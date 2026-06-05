# Prompt 节点

## 概述

Prompt 节点是自由文本输入源，用于向下游提供提示词。它不执行任何 AI 调用，纯粹作为数据源。

## 文件位置

`src/canvas/nodes/PromptNode.tsx`

## 数据类型

```typescript
interface PromptNodeData extends BaseNodeData {
  prompt: string;              // 用户输入的提示词文本
  systemPrompt?: string;       // 可选的系统提示词（在 PropertiesPanel 编辑）
  outputModality: Modality;    // 输出模态提示："text" | "image" | "video"
}
```

## 默认值

```typescript
{
  label: "Prompt",
  prompt: "",
  systemPrompt: "",
  outputModality: "text",
  executionStatus: "idle",
  executionLogs: [],
}
```

## 界面

### 节点卡片

- **图标**：💬 MessageSquare（翡翠绿 `text-emerald-400`）
- **边框**：`border-emerald-800/60`
- **内容**：一个 `textarea` 输入提示词
- **运行按钮**：不显示（`runnable={false}`，因为 Prompt 不需要执行）

### PropertiesPanel 扩展字段

- **System Prompt** — 可选的系统提示词 textarea
- **Output Modality** — 下拉选择 `text` / `image` / `video`

## Handle 配置

| Handle ID | 方向 | 数据类型 | 位置 |
|-----------|------|----------|------|
| `prompt-out` | source | text | 右侧 |

## 工作流语义

Prompt 节点在工作流执行时：

1. 读取 `prompt` 字段内容
2. 如果有 `systemPrompt`，一并传递给下游
3. 输出文本供下游 Text / Image / Video 节点作为 prompt 使用

`gatherInputs()` 会将上游连接的 text 输出与 Prompt 自身的 prompt 合并。