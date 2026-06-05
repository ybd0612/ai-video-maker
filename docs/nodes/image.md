# Image 节点

## 概述

Image 节点执行 AI 图像生成。支持文生图（text-to-image）和图生图（image-to-image）两种模式。

## 文件位置

`src/canvas/nodes/ImageNode.tsx`

## 数据类型

```typescript
interface ImageNodeData extends BaseNodeData {
  modelId?: string;         // 模型 ID（默认 "agnes-image-2.1-flash"）
  prompt: string;           // 图像描述提示词
  size: string;             // 图像尺寸
  quality: string;          // 质量（"standard"）
  outputUrl?: string;       // 生成的图像 URL 或 base64
  outputBlobKey?: string;   // IndexedDB Blob 存储键
  revisedPrompt?: string;   // 模型修正后的 prompt
  inputImageUrl?: string;   // 手动输入的参考图 URL
}
```

## 默认值

```typescript
{
  label: "Image Generation",
  modelId: "agnes-image-2.1-flash",
  prompt: "",
  size: "1024x1024",
  quality: "standard",
  executionStatus: "idle",
  executionLogs: [],
}
```

## 界面

### 节点卡片

- **图标**：🖼️ ImageIcon（紫色 `text-violet-400`）
- **边框**：`border-violet-800/60`（有输入图像时变为 `border-violet-500/80`）
- **内容**：
  - 模型标签 + img2img 模式指示
  - 上游图像预览（如果通过 image-in 连接）
  - 手动输入 URL 折叠区（无上游连接时可用）
  - prompt textarea（图生图模式下 placeholder 不同）
  - 尺寸选择下拉
  - 输出图像预览 / 生成中占位

### 尺寸选项

```
512x512, 768x768, 1024x1024, 1024x1792, 1792x1024
```

### 图生图模式

当有上游图像连接时：
1. 自动检测 `image-in` Handle 的连接
2. 读取上游 ImageNode 的 `outputUrl` 或 UploadNode 的 `base64Data`
3. 显示输入图像预览和连接状态
4. prompt placeholder 变为 "描述如何转换输入图像..."
5. 边框高亮为更亮的紫色

## Handle 配置

| Handle ID | 方向 | 数据类型 | 位置 |
|-----------|------|----------|------|
| `text-in` | target | text | 左侧 |
| `image-in` | target | image | 左侧（偏移 -mt-4） |
| `image-out` | source | image | 右侧 |

## 工作流执行

### 输入解析

1. 收集 `text-in` 连接的上游文本输出作为 prompt
2. 收集 `image-in` 连接的上游图像 URL 作为 inputImageUrl
3. 如果有上游文本，拼接后作为 prompt；否则使用节点自身 prompt
4. 如果两者都为空 → 抛出 "No prompt text available" 错误

### API 调用

通过 `AgnesAdapter.generateImage()` 调用 `/images/generations`：

```typescript
{
  model: "agnes-image-2.1-flash",
  prompt: imagePrompt,
  size: "1024x1024",
  return_base64: true,
  image: [inputImageUrl],  // 如果有图生图输入
  extra_body: {},
}
```

### 结果处理

- `outputUrl` → 图像 URL 或 base64 数据
- `revisedPrompt` → 模型修正后的 prompt（如果有）