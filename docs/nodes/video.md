# Video 节点

## 概述

Video 节点执行 AI 视频生成。支持文生视频和图生视频，采用异步任务 + 轮询模式。

## 文件位置

`src/canvas/nodes/VideoNode.tsx`

## 数据类型

```typescript
interface VideoNodeData extends BaseNodeData {
  modelId?: string;        // 模型 ID（默认 "agnes-video-v2.0"）
  prompt: string;          // 视频描述
  width: number;           // 宽度（默认 768）
  height: number;          // 高度（默认 1152）
  numFrames: number;       // 总帧数（默认 121）
  fps: number;             // 帧率（默认 24）
  mode: "normal" | "keyframe"; // 生成模式
  seed?: number;           // 随机种子
  taskId?: string;         // 异步任务 ID
  taskProgress: number;    // 任务进度 0-100
  outputUrl?: string;      // 视频 URL
  outputBlobKey?: string;  // IndexedDB Blob 键
  coverImageUrl?: string;  // 封面图 URL
  duration?: number;       // 视频时长
}
```

## 默认值

```typescript
{
  label: "Video Generation",
  modelId: "agnes-video-v2.0",
  prompt: "",
  width: 768,
  height: 1152,
  numFrames: 121,
  fps: 24,
  mode: "normal",
  taskProgress: 0,
  executionStatus: "idle",
  executionLogs: [],
}
```

## 界面

### 节点卡片

- **图标**：🎬 Film（琥珀 `text-amber-400`）
- **边框**：`border-amber-800/60`
- **内容**：
  - 模型标签
  - prompt textarea
  - 参数行：W / H / FPS 数字输入
  - 进度条（执行中时显示百分比 + 加载动画）
  - 输出视频播放器

### PropertiesPanel 扩展字段

- Prompt textarea
- System Prompt
- 分辨率 W × H
- FPS / Frames
- Mode 选择（normal / keyframe）
- Seed 输入
- 任务 ID / 进度显示
- 视频输出播放器

## Handle 配置

| Handle ID | 方向 | 数据类型 | 位置 |
|-----------|------|----------|------|
| `text-in` | target | text | 左侧 |
| `image-in` | target | image | 左侧（偏移 -mt-4） |
| `video-in` | target | video | 左侧（偏移 -mt-8） |
| `video-out` | source | video | 右侧 |

## 工作流执行

### 异步流程

Video 是唯一使用异步任务模式的节点：

1. **创建任务** — 调用 `AgnesAdapter.createVideoTask()` → 获取 `taskId`
2. **轮询** — 每 3 秒调用 `AgnesAdapter.pollVideoTask()`
3. **超时** — 最长 10 分钟
4. **完成** — 更新 outputUrl / coverImageUrl / duration

### 输入解析

1. 收集 `text-in` 的文本输出作为 prompt
2. 收集 `image-in` 的图像 URL
3. 如果有多个上游图像 → 使用 `imageUrls`（多图/关键帧模式）
4. 如果单个上游图像 → 使用 `imageUrl`（图生视频）

### API 调用

**创建任务** (`/videos`)：

```typescript
{
  model: "agnes-video-v2.0",
  prompt: videoPrompt,
  num_frames: 121,
  frame_rate: 24,
  width: 768,
  height: 1152,
  image: imageUrl,         // 单图模式
  // 或
  extra_body: {
    image: [url1, url2],   // 多图模式
    mode: "keyframes",
  },
}
```

**轮询** (`/videos/${taskId}`)：

返回状态映射：
- `pending` / `queued` → pending
- `processing` / `running` → processing
- `completed` / `succeeded` → completed
- `failed` / `cancelled` → failed

### 进度显示

节点卡片上实时显示：
- 加载旋转动画
- 百分比文字
- 进度条（宽度百分比动画）

### 取消

通过 `AbortController` 支持取消轮询。