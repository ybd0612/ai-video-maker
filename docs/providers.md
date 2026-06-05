# AI Provider 架构

## 概述

wxhb 通过抽象 `ModelProvider` 接口解耦 AI 模型调用，当前唯一实现为 `AgnesAdapter`。

## 文件位置

- `src/providers/types.ts` — 抽象接口和类型定义
- `src/providers/agnes/AgnesAdapter.ts` — Agnes AI 适配器实现
- `src/canvas/types.ts` — `MODEL_REGISTRY` 模型注册表

## 类型系统

### Modality

```typescript
type Modality = "text" | "image" | "video";
```

### 执行模式

```typescript
type ExecutionMode = "sync" | "async";
```

- **sync** — 同步返回结果（text, image）
- **async** — 创建任务 + 轮询（video）

### 任务状态

```typescript
type TaskStatus = "pending" | "processing" | "completed" | "failed";
```

## ModelProvider 接口

```typescript
interface ModelProvider {
  readonly name: string;

  discover(apiKey, baseUrl): Promise<AIModel[]>;
  generateText(apiKey, baseUrl, params: TextParams): Promise<TextResult>;
  generateImage(apiKey, baseUrl, params: ImageParams): Promise<ImageResult>;
  createVideoTask(apiKey, baseUrl, params: VideoParams): Promise<string>;
  pollVideoTask(apiKey, baseUrl, taskId): Promise<VideoTaskStatus>;
}
```

### 方法说明

| 方法 | 模态 | 模式 | 返回 |
|------|------|------|------|
| `discover` | 全部 | — | 可用模型列表 |
| `generateText` | text | sync | TextResult（content + finishReason） |
| `generateImage` | image | sync | ImageResult（url + revisedPrompt） |
| `createVideoTask` | video | async | taskId 字符串 |
| `pollVideoTask` | video | async | VideoTaskStatus（status + progress + videoUrl） |

## 输入参数

### TextParams

```typescript
{
  model: string;
  prompt: string;
  systemPrompt?: string;
  temperature?: number;   // 默认 0.7
  maxTokens?: number;     // 默认 1024
  stream?: boolean;       // 默认 false
  extraBody?: Record<string, unknown>;
}
```

### ImageParams

```typescript
{
  model: string;
  prompt: string;
  inputImageUrl?: string;  // 图生图
  size?: string;           // 默认 "1024x1024"
  quality?: string;
  responseFormat?: "url" | "b64_json";
  n?: number;
  extraBody?: Record<string, unknown>;
}
```

### VideoParams

```typescript
{
  model: string;
  prompt: string;
  imageUrl?: string;       // 单图（图生视频）
  imageUrls?: string[];    // 多图（关键帧）
  width?: number;
  height?: number;
  numFrames?: number;
  fps?: number;
  mode?: string;           // "normal" | "keyframe"
  seed?: number;
  extraBody?: Record<string, unknown>;
}
```

## AgnesAdapter 实现

### API 端点

| 功能 | 方法 | 端点 |
|------|------|------|
| 模型发现 | GET | `{baseUrl}/models` |
| 文本生成 | POST | `{baseUrl}/chat/completions` |
| 图像生成 | POST | `{baseUrl}/images/generations` |
| 创建视频任务 | POST | `{baseUrl}/videos` |
| 轮询视频任务 | GET | `{baseUrl}/videos/{taskId}` |

### 认证

所有请求通过 `Authorization: Bearer {apiKey}` 头认证。

### 文本生成

标准 OpenAI 兼容格式：
```json
{
  "model": "agnes-2.0-flash",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ],
  "temperature": 0.7,
  "max_tokens": 1024,
  "stream": false
}
```

### 图像生成

```json
{
  "model": "agnes-image-2.1-flash",
  "prompt": "...",
  "size": "1024x1024",
  "return_base64": true,
  "image": ["input_image_url"],  // 图生图
  "extra_body": {}
}
```

注意：始终使用 `return_base64: true`，不使用 `response_format`。

### 视频任务创建

```json
{
  "model": "agnes-video-v2.0",
  "prompt": "...",
  "num_frames": 121,
  "frame_rate": 24,
  "width": 768,
  "height": 1152,
  "image": "single_image_url",  // 单图模式
  // 或
  "extra_body": {
    "image": ["url1", "url2"],
    "mode": "keyframes"
  }
}
```

### 视频状态映射

| API 返回 | 内部状态 |
|----------|----------|
| pending, queued | pending |
| processing, running | processing |
| completed, succeeded | completed |
| failed, cancelled | failed |

## 模型注册表

```typescript
// src/canvas/types.ts
const MODEL_REGISTRY: Record<Modality, ModelEntry[]> = {
  text: [
    { id: "agnes-2.0-flash", name: "Agnes 2.0 Flash", modality: "text" },
  ],
  image: [
    { id: "agnes-image-2.1-flash", name: "Agnes Image 2.1 Flash", modality: "image" },
  ],
  video: [
    { id: "agnes-video-v2.0", name: "Agnes Video v2.0", modality: "video" },
  ],
};
```

### 工具函数

- `getDefaultModelId(modality)` — 获取某模态的默认模型 ID
- `getModelNameById(id)` — 根据 ID 查找显示名称

## 扩展指南

### 替换模型

1. 修改 `MODEL_REGISTRY` 中对应模态的条目
2. 节点组件的 Model 下拉会自动更新

### 接入新 Provider

1. 实现 `ModelProvider` 接口
2. 在 `useWorkflowRunner.ts` 中替换 AgnesAdapter 调用
3. 或通过工厂模式动态选择 provider
