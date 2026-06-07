# Image 节点

## 概述

Image 节点执行 AI 图像生成。支持文生图（text-to-image）和图生图（image-to-image）两种模式，以及批量生成。

## 文件位置

`src/canvas/nodes/ImageNode.tsx`

## 数据类型

```typescript
interface ImageNodeData extends BaseNodeData {
  modelId?: string;         // 模型 ID（默认 "agnes-image-2.1-flash"）
  prompt: string;           // 图像描述提示词
  size: string;             // 图像尺寸（"1024x1024"、"576x1024" 等）
  count: number;            // 批量生成数量（1-10，默认 1）
  quality: string;          // 质量（"standard"）
  outputUrl?: string;       // 第一张生成的图像 URL
  outputUrls?: string[];    // 所有生成的图像 URL
  revisedPrompt?: string;   // 模型修正后的 prompt
}
```

## 默认值

```typescript
{
  label: "Image Generation",
  modelId: "agnes-image-2.1-flash",
  prompt: "",
  size: "1024x1024",
  count: 1,
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
  - prompt textarea（图生图模式下 placeholder 不同）
  - 尺寸选择下拉
  - 输出图像预览 / 生成中占位

### 尺寸选项

按比例从小到大排列：

```
9:16 (576x1024), 9:16 (648x1152), 2:3 (682x1024), 3:4 (768x1024), 9:16 (864x1536),
1:1 (1024x1024), 4:3 (1024x768), 3:2 (1024x682), 16:9 (1024x576),
16:9 (1152x648), 16:9 (1536x864), Auto
```

### 图生图模式

当有上游图像连接时：
1. 自动检测 `image-in` Handle 的连接
2. 读取上游 ImageNode 的 `outputUrl` 或 UploadNode 的 `base64Data`
3. 显示输入图像预览和连接状态
4. prompt placeholder 变为 "描述如何转换输入图像..."
5. 边框高亮为更亮的紫色

### 批量生成

当 `count > 1` 时，工作流执行引擎会循环调用生成接口，收集所有图像 URL 到 `outputUrls[]` 数组。节点卡片和属性面板以网格形式展示多张图片。

## Handle 配置

| Handle ID | 方向 | 数据类型 | 位置 |
|-----------|------|----------|------|
| `text-in` | target | text | 左侧 |
| `image-in` | target | image | 左侧（偏移 -mt-4） |
| `image-out` | source | image | 右侧 |

## 工作流执行

### 输入解析

1. 收集 `text-in` 连接的上游文本输出作为 prompt
2. 收集 `image-in` 连接的上游图像 URL 作为输入图片
3. 如果有上游文本，拼接后作为 prompt；否则使用节点自身 prompt
4. 如果两者都为空 → 抛出 "No prompt text available" 错误

### API 调用

通过 `AgnesAdapter.generateImage()` 调用 `/images/generations`：

```json
{
  "model": "agnes-image-2.1-flash",
  "prompt": "...",
  "size": "1024x1024",
  "image": ["input_image_url"],
  "extra_body": {}
}
```

注意：图片返回为 URL，不再使用 `return_base64: true`。如果返回的 URL 不以 `http://` 或 `https://` 开头，会自动补上 `https://` 前缀。

### 结果处理

- `outputUrl` → 第一张图像的 URL
- `outputUrls` → 所有图像 URL 数组（批量生成时）
- `revisedPrompt` → 模型修正后的 prompt（如果有）