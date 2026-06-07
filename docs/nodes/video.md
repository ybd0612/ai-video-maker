# Video 节点

## 概述

Video 节点执行 AI 视频生成。支持文生视频和图生视频，采用异步任务 + 轮询模式，支持批量生成。

## 文件位置

`src/canvas/nodes/VideoNode.tsx`

## 数据类型

```typescript
interface VideoNodeData extends BaseNodeData {
  modelId?: string;         // 模型 ID（默认 "agnes-video-v2.0"）
  prompt: string;           // 视频描述
  negativePrompt?: string;  // 负面提示词
  size: string;             // 尺寸（"1280x720"、"720x1280" 等）
  count: number;            // 批量生成数量（1-5，默认 1）
  numFrames: number;        // 总帧数（从 duration + fps 自动计算）
  fps: number;              // 帧率（24 / 30 / 60）
  mode: "normal" | "keyframe"; // 生成模式
  seed?: number;            // 随机种子（0 = 随机，传 undefined 给 API）
  taskId?: string;          // 异步任务 ID
  taskProgress: number;     // 任务进度 0-100
  outputUrl?: string;       // 第一个视频 URL
  outputUrls?: string[];    // 所有视频 URL
  coverImageUrl?: string;   // 封面图 URL
  coverImageUrls?: string[]; // 所有封面图 URL
  duration?: number;        // 视频时长（秒）
}
```

## 默认值

```typescript
{
  label: "Video Generation",
  modelId: "agnes-video-v2.0",
  prompt: "",
  size: "1280x720",
  count: 1,
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
  - 参数行：Size 下拉 / FPS 下拉 / Duration 下拉
  - 进度条（执行中时显示百分比 + 加载动画）
  - 输出视频播放器

### PropertiesPanel 扩展字段

- Prompt textarea
- Negative Prompt textarea
- Size 下拉（预设尺寸：1280x720、720x1280、1024x1024、1792x1024、1024x1792、Auto）
- FPS 下拉（24 / 30 / 60）
- Duration 下拉（3 / 5 / 10 / 18 秒）
- NumFrames 显示（通过 `calcNumFrames(duration, fps)` 自动计算）
- Count 数字输入（1-5，批量生成数量）
- Seed 数字输入（0 = 随机）
- Mode 选择（normal / keyframe）
- 任务 ID / 进度显示
- 视频输出播放器（多个视频时循环显示，来自 `outputUrls[]`）

### 尺寸选项

```
横屏 1280x720, 竖屏 720x1280, 方形 1024x1024, 宽屏 1792x1024, 1024x1792, Auto
```

### 帧数计算

通过 `calcNumFrames(duration, fps)` 函数自动计算，规则为 `numFrames = duration * fps + 1`，并约束在合法范围内。

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

### 批量生成

当 `count > 1` 时，工作流执行引擎会循环创建多个任务并分别轮询，收集所有视频 URL 到 `outputUrls[]` 和封面图到 `coverImageUrls[]`。

### 输入解析

1. 收集 `text-in` 的文本输出作为 prompt
2. 收集 `image-in` 的图像 URL
3. 如果有多个上游图像 → 使用 `imageUrls`（多图/关键帧模式）
4. 如果单个上游图像 → 使用 `imageUrl`（图生视频）

### API 调用

**创建任务** (`/videos`)：

```json
{
  "model": "agnes-video-v2.0",
  "prompt": "...",
  "negative_prompt": "...",
  "num_frames": 121,
  "frame_rate": 24,
  "width": 1280,
  "height": 720,
  "seed": null,
  "image": "single_image_url",
  "extra_body": {
    "image": ["url1", "url2"],
    "mode": "keyframes"
  }
}
```

注意：`width` / `height` 从 `size` 字符串解析（如 `"1280x720"` → `width: 1280, height: 720`）。`seed` 为 0 时传 `undefined`（随机）。

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