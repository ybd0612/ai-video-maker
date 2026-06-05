# Text 节点

## 概述

Text 节点执行 LLM 文本生成。接收上游提示词或使用自身 prompt，调用文本模型生成结果。

## 文件位置

`src/canvas/nodes/TextNode.tsx`

## 数据类型

```typescript
interface TextNodeData extends BaseNodeData {
  modelId?: string;       // 模型 ID（默认 "agnes-2.0-flash"）
  prompt: string;         // 用户输入的提示词
  systemPrompt?: string;  // 系统提示词
  temperature: number;    // 生成温度（0-2，默认 0.7）
  maxTokens: number;      // 最大 token 数（默认 1024）
  output?: string;        // 生成的文本结果
  finishReason?: string;  // 完成原因
}
```

## 默认值

```typescript
{
  label: "Text Generation",
  modelId: "agnes-2.0-flash",
  prompt: "",
  systemPrompt: "",
  temperature: 0.7,
  maxTokens: 1024,
  executionStatus: "idle",
  executionLogs: [],
}
```

## 界面

### 节点卡片

- **图标**：🔤 Type（天蓝 `text-sky-400`）
- **边框**：`border-sky-800/60`
- **内容**：
  - 模型标签（固定显示 "agnes-2.0-flash"）
  - prompt textarea
  - 参数行：Temperature + MaxTokens 数字输入
  - 输出区（当 output 存在时显示）

### PropertiesPanel 扩展字段

- Model 下拉（从 MODEL_REGISTRY.text 读取）
- System Prompt textarea
- Temperature 滑块/输入
- Max Tokens 输入
- 文本输出预览区

## Handle 配置

| Handle ID | 方向 | 数据类型 | 位置 |
|-----------|------|----------|------|
| `text-in` | target | text | 左侧 |
| `text-out` | source | text | 右侧 |

## 工作流执行

### 输入解析

1. 遍历所有指向该节点 `text-in` 的边
2. 收集上游节点的文本输出（Prompt.prompt / Text.output）
3. 如果有上游输入，使用拼接后的文本作为 prompt
4. 否则使用节点自身的 `prompt` 字段

### API 调用

通过 `AgnesAdapter.generateText()` 调用 `/chat/completions`：

```typescript
{
  model: data.modelId ?? "agnes-2.0-flash",
  messages: [
    { role: "system", content: systemPrompt },  // 如果有
    { role: "user", content: prompt },
  ],
  temperature,
  max_tokens: maxTokens,
  stream: false,
}
```

### 结果处理

成功时更新节点数据：
- `output` → 生成的文本
- `finishReason` → 完成原因
- `executionStatus` → "success"

失败时级联标记下游为 failed。