# WXHB 使用指南

## 目录

1. [环境准备](#1-环境准备)
2. [安装与启动](#2-安装与启动)
3. [配置 API](#3-配置-api)
4. [画布操作](#4-画布操作)
5. [创建工作流](#5-创建工作流)
6. [运行工作流](#6-运行工作流)
7. [节点详解](#7-节点详解)
8. [模型替换](#8-模型替换)
9. [故障排查](#9-故障排查)

---

## 1. 环境准备

- **Node.js** ≥ 18（推荐 18.20+）
- **npm** ≥ 9
- 一个 Agnes AI API Key（从 https://agnes-ai.com 获取）

## 2. 安装与启动

```bash
cd wxhb
npm install
npm run dev
```

浏览器打开 `http://127.0.0.1:3000`。

生产构建：

```bash
npm run build
npm run preview
```

预览服务器运行在 `http://127.0.0.1:5180`。

## 3. 配置 API

1. 点击左侧边栏**底部**的 **⚙ 设置** 按钮
2. 填写：

   | 字段 | 值 |
   |------|-----|
   | API Key | 你的 Agnes API Key（`sk-...`） |
   | API Base URL | `https://apihub.agnes-ai.com/v1` |

3. 点击 **Test Connection** — 看到绿色 "Connection OK" 即为成功
4. 设置会自动保存到浏览器 localStorage，不会上传

## 4. 画布操作

### 添加节点

在画布空白处 **右键点击**，弹出节点创建菜单，选择要添加的节点类型：

- 🟢 **Prompt** — 文本输入源
- 🔵 **Text** — 文本生成
- 🟣 **Image** — 图像生成
- 🟡 **Video** — 视频生成
- 📤 **Upload** — 图片上传

### 连接节点

从一个节点的 **右侧输出端口** 拖向另一个节点的 **左侧输入端口**。

连接规则：

| 源端口 | → | 目标端口 |
|--------|---|----------|
| text-out | → | text-in, prompt-in |
| image-out | → | image-in, video-in |
| video-out | → | video-in |

不合规的连接会被自动拒绝。

### 画布导航

- **鼠标拖拽** — 平移画布
- **滚轮** — 缩放
- **点击节点** — 选中，右侧面板显示属性编辑器
- **点击空白** — 取消选中

### 删除

- 选中节点后按 `Delete` 键
- 选中连线后按 `Delete` 键

## 5. 创建工作流

### 示例 1：Prompt → Text（最简单）

1. 右键画布空白处，添加一个 **Prompt** 节点
2. 右键添加一个 **Text** 节点
3. 从 Prompt 的输出端口连到 Text 的输入端口
4. 在 Text 节点中输入 prompt（或留空，自动使用上游 Prompt 节点的内容）
5. 点击 **▶ Run Workflow**

### 示例 2：Prompt → Text → Image

1. 创建 Prompt → Text 链路
2. 再添加一个 **Image** 节点
3. 从 Text 的输出端口连到 Image 的 `text-in` 端口
4. Image 节点会使用上游 Text 的输出作为 prompt
5. 点击 **▶ Run Workflow**

### 示例 3：Prompt → Image → Video

1. 添加 Prompt 和 Image 节点，连接
2. 添加 Video 节点
3. 从 Image 的 `image-out` 连到 Video 的 `image-in`（图生视频）
4. 从 Prompt 或 Text 的 `text-out` 连到 Video 的 `text-in`（提供文本 prompt）
5. 点击 **▶ Run Workflow**

## 6. 运行工作流

- 点击画布底部的 **▶ Run Workflow** 按钮
- 工作流按拓扑排序顺序执行
- 每个节点显示执行状态：
  - ⚪ 空闲（idle）
  - 🟡 执行中（pending，带旋转动画）
  - 🟢 成功（success）
  - 🔴 失败（failed，显示错误信息）
- 如果某个节点失败，所有下游节点自动标记为失败（级联中断）
- 右侧面板显示每个节点的执行日志

### 视频节点特殊行为

视频生成是异步的，系统会自动轮询任务状态（每 3 秒一次，最长 10 分钟）。节点上显示进度百分比。

## 7. 节点详解

### Prompt 节点

| 参数 | 说明 |
|------|------|
| System Prompt | 可选的系统提示词 |
| Output Modality | 输出类型（text / image / video），供下游参考 |

### Text 节点

| 参数 | 说明 | 默认值 |
|------|------|--------|
| Model | 文本模型 | agnes-2.0-flash |
| Prompt | 输入提示词 | 空（可用上游替代） |
| System Prompt | 系统提示词 | 空 |
| Temperature | 生成温度 | 0.7 |
| Max Tokens | 最大 token 数 | 1024 |

### Image 节点

| 参数 | 说明 | 默认值 |
|------|------|--------|
| Model | 图像模型 | agnes-image-2.1-flash |
| Prompt | 图像描述 | 空 |
| Size | 图像尺寸（下拉选择） | 1024x1024 |
| Count | 批量生成数量 | 1（范围 1-10） |
| Quality | 质量 | standard |

尺寸选项（按比例从小到大）：
```
9:16 (576x1024), 9:16 (648x1152), 2:3 (682x1024), 3:4 (768x1024), 9:16 (864x1536),
1:1 (1024x1024), 4:3 (1024x768), 3:2 (1024x682), 16:9 (1024x576),
16:9 (1152x648), 16:9 (1536x864), Auto
```

当 Count > 1 时，生成多张图片并以网格展示。

### Video 节点

| 参数 | 说明 | 默认值 |
|------|------|--------|
| Model | 视频模型 | agnes-video-v2.0 |
| Prompt | 视频描述 | 空 |
| Negative Prompt | 负面提示词（排除不想要的内容） | 空 |
| Size | 分辨率（下拉选择） | 1280x720 |
| FPS | 帧率（下拉选择） | 24（可选 24/30/60） |
| Duration | 时长（下拉选择） | 自动（可选 3/5/10/18 秒） |
| Frames | 总帧数（自动计算） | 121 |
| Count | 批量生成数量 | 1（范围 1-5） |
| Seed | 随机种子 | 0（= 随机） |

尺寸选项：
```
横屏 1280x720, 竖屏 720x1280, 方形 1024x1024, 宽屏 1792x1024, 1024x1792, Auto
```

帧数通过 Duration × FPS 自动计算，无需手动设置。Seed 设为 0 表示随机。

## 8. 模型替换

### 方式 1：节点级替换（推荐）

每个节点的属性面板中都有 **Model** 下拉框，直接选择即可。适合临时测试不同模型。

### 方式 2：修改注册表

编辑 `src/canvas/types.ts` 中的 `MODEL_REGISTRY`：

```typescript
export const MODEL_REGISTRY: Record<Modality, ModelEntry[]> = {
  text: [
    { id: "your-model-id", name: "显示名称", modality: "text" },
  ],
  image: [
    { id: "your-model-id", name: "显示名称", modality: "image" },
  ],
  video: [
    { id: "your-model-id", name: "显示名称", modality: "video" },
  ],
};
```

修改后重新构建即可。

### 方式 3：接入非 Agnes API

实现 `src/providers/types.ts` 中的 `ModelProvider` 接口：

```typescript
export interface ModelProvider {
  readonly name: string;
  generateText(apiKey: string, baseUrl: string, params: TextParams): Promise<TextResult>;
  generateImage(apiKey: string, baseUrl: string, params: ImageParams): Promise<ImageResult>;
  createVideoTask(apiKey: string, baseUrl: string, params: VideoParams): Promise<string>;
  pollVideoTask(apiKey: string, baseUrl: string, taskId: string): Promise<VideoTaskStatus>;
}
```

然后在工作流 runner 中替换对应的调用。

## 9. 故障排查

| 问题 | 解决方案 |
|------|----------|
| Test Connection 失败 | 检查 API Key 是否正确，Base URL 是否为 `https://apihub.agnes-ai.com/v1` |
| "API key is not configured" | 打开 Settings 填入 Key 并保存 |
| "Workflow contains a cycle" | 检查连线是否有循环（A→B→A） |
| "No prompt text available" | 节点的 prompt 为空，且没有上游输入 |
| 图像生成 400 错误 | 确认使用 `agnes-image-2.1-flash`，不要手动设置 `response_format` |
| 视频超时 | 视频生成最长 10 分钟，复杂场景可能超时；尝试降低分辨率或帧数 |
| 页面空白 | 打开浏览器控制台（F12）查看错误信息 |
| 设置不保存 | 确认浏览器未禁用 localStorage（隐私模式可能受限） |