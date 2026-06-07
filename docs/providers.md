# AI Provider 架构

## 概述

wxhb 通过抽象 `ModelProvider` 接口解耦 AI 模型调用，当前唯一实现为 `AgnesAdapter`。

> **重要架构说明**：当前 `useWorkflowRunner` 中有独立的 REST 调用函数（`callTextAPI` / `callImageAPI` / `callVideoCreateAPI` / `callVideoPollAPI`），直接通过 `fetch` 调用 Agnes API。`AgnesAdapter` 虽然实现了完整的 `ModelProvider` 接口，但 runner 并未调用它。两套实现功能重复，未来应统一。

## 文件位置

- `src/providers/types.ts` — 抽象接口和类型定义
- `src/providers/agnes/AgnesAdapter.ts` — Agnes AI 适配器实现
- `src/canvas/types.ts` — `MODEL_REGISTRY` 模型注册表
- `src/canvas/hooks/useWorkflowRunner.ts` — 实际 REST 调用层（独立于 Adapter）

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
  quality?: string;        // 当前 runner 未传入此参数
  responseFormat?: "url" | "b64_json";
  n?: number;
  extraBody?: Record<string, unknown>;
}
```

> **注意**：`quality` 参数在 `ImageParams` 接口中定义，但 `useWorkflowRunner` 的 `callImageAPI()` 实际未使用它。`AgnesAdapter.generateImage()` 也未使用。当前图像 API 始终使用默认质量。

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

## 实际 REST 调用层（useWorkflowRunner 内部）

工作流引擎直接实现了 4 个 REST 函数，是实际的 API 调用路径：

### callTextAPI()

POST `{baseUrl}/chat/completions`

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

### callImageAPI()

POST `{baseUrl}/images/generations`

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

### callVideoCreateAPI()

POST `{baseUrl}/videos`

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

注意：`width` / `height` 从 `size` 字符串解析。`seed` 为 0 时传 `undefined`（随机）。`negative_prompt` 字段会被包含在请求中。

### callVideoPollAPI()

GET `{baseUrl}/videos/{taskId}`

状态映射：

| API 返回 | 内部状态 |
|----------|----------|
| pending, queued | pending |
| processing, running | processing |
| completed, succeeded | completed |
| failed, cancelled | failed |

## AgnesAdapter 实现

`AgnesAdapter` 实现了 `ModelProvider` 接口的全部 5 个方法，逻辑与 runner 内部的 REST 函数基本一致。主要差异：

| 特性 | runner 内部函数 | AgnesAdapter |
|------|----------------|-------------|
| 调用者 | useWorkflowRunner 直接调用 | 未被调用（待重构） |
| 模型发现 | 无 | `discover()` 方法 |
| 错误消息前缀 | `Text API` / `Image API` | `Text API error` / `Image API error` |

### 认证

所有请求通过 `Authorization: Bearer {apiKey}` 头认证。

## ProviderConfig 接口冲突

项目中存在两个同名但不同的 `ProviderConfig`：

| 位置 | 字段 | 用途 |
|------|------|------|
| `providers/types.ts` | `apiKey`, `baseUrl`, `modelOverrides?` | 理论上的完整配置 |
| `stores/settingsStore.ts` | `apiKey`, `baseUrl` | 实际存储的配置 |

`settingsStore` 中的版本是实际使用的，`providers/types.ts` 中的 `modelOverrides` 字段当前未被任何代码使用。

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
2. 重构 `useWorkflowRunner` 中的 `callTextAPI` / `callImageAPI` / `callVideoCreateAPI` / `callVideoPollAPI` 为调用 adapter 方法
3. 或在 runner 中注入 provider 实例