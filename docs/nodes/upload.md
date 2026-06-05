# Upload 节点

## 概述

Upload 节点用于上传本地图片到画布，输出 base64 数据供下游 Image 节点使用（图生图）。不执行任何 AI 调用。

## 文件位置

`src/canvas/nodes/UploadNode.tsx`

## 数据类型

```typescript
interface UploadNodeData extends BaseNodeData {
  base64Data?: string;  // data:image/png;base64,... 格式
  fileName?: string;    // 原始文件名
  fileType?: string;    // MIME 类型
  fileSize?: number;    // 文件大小（字节）
}
```

## 默认值

```typescript
{
  label: "Upload Image",
  executionStatus: "idle",
  executionLogs: [],
}
```

## 界面

### 节点卡片

- **图标**：📤 Upload（玫瑰 `text-rose-400`）
- **边框**：`border-rose-800/60`（有图片时变为 `border-rose-500/80`）
- **运行按钮**：不显示（`runnable={false}`）
- **内容**：

**空状态**：
- 虚线拖放区域
- 提示文字："拖放图片或点击上传"
- 支持格式提示："PNG, JPG, WebP, GIF"

**已上传**：
- 文件名 + 大小显示
- ✕ 清除按钮
- 图片预览

### 交互

- **点击** — 触发隐藏的 `<input type="file">`
- **拖放** — 支持拖拽图片文件到节点上
- **清除** — 重置所有数据 + 清空 input

## 支持的文件格式

```typescript
const ACCEPTED = "image/png,image/jpeg,image/webp,image/gif";
```

## 文件读取

使用 `FileReader.readAsDataURL()` 将文件转为 base64 data URL：

```typescript
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
```

## 文件大小显示

```typescript
function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
```

## Handle 配置

| Handle ID | 方向 | 数据类型 | 位置 |
|-----------|------|----------|------|
| `image-out` | source | image | 右侧 |

## 与 Image 节点的配合

Upload → Image 连接流程：

1. 用户在 Upload 节点上传图片 → 存储为 base64
2. 连接 Upload 的 `image-out` 到 Image 的 `image-in`
3. 工作流执行时，Image 节点检测到上游 Upload 节点
4. `gatherInputs()` 收集 Upload 的 `base64Data` 作为 `imageInputs[0]`
5. AgnesAdapter 将 base64 data URL 作为 `image` 参数发送
6. Image 节点进入图生图模式