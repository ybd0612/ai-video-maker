# 视频生成一直未成功 — 全面调研报告

> **归档说明（2026-09-21 迁入 `docs/history/`，正文自该日起冻结）**
> 顶部修订（哪些仍有效）：**第七节「成片地址在响应顶层 `url`」与第八节「提示词被兜底文案覆盖」两条实测结论仍有效**，
> 并已沉淀为现行规则（`docs/execution-flow.md` §7 与 `AGENTS.md` 向导可靠性铁律）。
> 其余部分已过期：① 第二、三节基于 `agnes-video-v2.0` 的 `num_frames`（8n+1）/`frame_rate`/`width`/`height`
> 参数体系已随模型升级到 `agnes-video-2.5-flash` 整体废弃（现用 `mode` + `size:"720P"` + `aspect_ratio` + `seconds`）；
> ② 第四节修复落在 `useWizardActions.ts`，该文件现已拆为 `useScriptActions` / `useAssetActions` /
> `useImageActions` / `useVideoActions` 四个域，自身只剩 35 行门面；③ `calcNumFrames` 与 `translateToMotion` 均已删除。

> 调研日期：2026-08-18
> 结论：官方视频实际生成成功（token 已消耗），问题全部出在前端链路，已定位 4 个根因并修复。

## 一、调研方法

- 逐行审查整条链路：`StepVideos`（自动触发）→ `useWizardActions.generateVideosForStep`（任务编排）→ `videoService.generateVideo`（创建任务 + 轮询）→ 状态写回。
- 对照 Agnes 中国站官方文档（https://agnes-ai.cn/zh-Hans/docs/agnes-video-v20）逐项核对端点、参数、响应字段。
- 分析 React effect 重入、AbortController 共享、状态机卡死等时序问题。

## 二、已验证正确的部分（排除嫌疑）

| 项目 | 代码 | 官方要求 | 结论 |
|---|---|---|---|
| 创建端点 | `POST https://api.agnes-ai.cn/v1/videos` | `POST /v1/videos` | ✅ 一致 |
| 轮询端点 | `GET https://api.agnes-ai.cn/agnesapi?video_id=` | `GET /agnesapi?video_id=` | ✅ 一致 |
| 模型名 | `agnes-video-v2.0` | `agnes-video-v2.0` | ✅ 一致 |
| 帧数规则 | `calcNumFrames` 8n+1、≤441 | 8n+1、≤441 | ✅ 一致 |
| 时长兜底 | `duration` 非法值回退 5 | 3/5/8 秒 | ✅ 不会出现 0 或负数 |
| 认证 | `Bearer <apiKey>` | 相同 | ✅ 一致 |

## 三、根因清单（按影响排序）

### 🔴 根因 1（致命）：StepVideos 自动触发 effect 重入，批量任务被误杀

**证据链**：
1. `StepVideos.tsx` 的自动触发 effect 依赖 `[videoGenerationStarted, shots.length]`。
2. `generateVideosForStep` 内部调用 `setVideoGenerationStartedByProjectId(true)` → `videoGenerationStarted` 变化 → **effect 再次执行**。
3. 第二次执行时 `ensureAbortController()` 会 **abort 第一次的 signal**（共享 abortRef）。
4. 第一次的任务若已 POST 创建服务端任务并进入轮询，会被取消，抛出“视频轮询已取消”。
5. 任务 catch 后重试循环开头 `if (signal?.aborted) return` 直接退出 → **shot 卡在 videoing**。
6. 第二次调用重新创建服务端任务 → **重复消耗 token**（与“官方 token 消耗了”吻合）。
7. 而第二次调用的过滤条件 `status !== "videoing"` 把卡住的 shot 排除 → **无人再轮询 → 永久“加载中”**。

### 🔴 根因 2（致命，已于提交 ccf874b 修复）：完成响应 URL 解析错误

**证据链**：
1. Agnes 官方完成响应的成片 URL 位于 `metadata.url`（文档明确：`metadata.url` 仅在 status=completed 时可用）。
2. 旧代码只读取 `video_url` / `output.video_url` → 解析为空。
3. `videoUrl=""` 时 break 后抛 `VideoTaskCreatedError("视频生成超时…")` → 前端标记 **failed**。
4. 即：官方已生成成功，前端却显示失败。

### 🟠 根因 3（高）：刷新/切走后 videoing 状态永久卡死

**证据链**：
1. `shot.status="videoing"` 持久化到 localStorage。
2. 刷新后 JS 任务终止，但状态仍为 `videoing`。
3. 重新进入 StepVideos，自动触发被 `status !== "videoing"` 过滤 → **永远无法恢复**。

### 🟠 根因 4（高）：失败批量重试无并发控制

**证据链**：
1. StepVideos “重试失败”按钮用 `forEach` 并发调用 `rerollVideo`。
2. 每个 rerollVideo 同步把 shot 置为 `videoing` → 界面同时显示多个“生成中”。
3. 实际请求虽受 RPM=1 串行，但 UI 状态全部提前变 videoing（与“多个都是生成中”反馈吻合）。

## 四、修复内容

| 修复 | 文件 |
|---|---|
| 批量生成加**幂等守卫**（模块级 `activeVideoTasks` 注册表）：同项目已有任务在跑时不重复启动 | useWizardActions.ts |
| 批量生成改用**独立 AbortController**，不再共享 abortRef 误杀其他任务 | useWizardActions.ts |
| 挂载恢复：注册表为空时，把残留 `videoing` 重置为 `imaged` 重新接管（解决刷新卡死） | useWizardActions.ts |
| `rerollVideo` 改用独立 controller；服务端任务仍在运行时保持 videoing，不误报失败 | useWizardActions.ts |
| StepVideos 自动触发 effect 依赖去掉 `videoGenerationStarted`，只触发一次 | StepVideos.tsx |
| “重试失败”改走 `generateVideosForStep`（并发受控、幂等） | StepVideos.tsx |
| 完成响应优先解析 `metadata.url`（已在上轮提交） | videoService.ts |

## 五、验证

- TypeScript 类型检查 ✅
- `git diff --check` ✅
- Vite 生产构建 ✅（仅原有 chunk 体积提示）

## 六、遗留问题全面修复（本轮 fa3cc00 之后追加）

| 遗留问题 | 修复 |
|---|---|
| StepImages 存在与视频相同的 effect 重入缺陷（依赖 imageGenerationStarted），图片请求被误杀并重复生成 | 依赖去掉 imageGenerationStarted；批量图片生成加幂等守卫 + 独立 controller；刷新后残留 imaging 重置为 scripted |
| StepAssets 的 assetGenerationStarted 刷新后卡 true，按钮永久禁用转圈（用户此前反馈“资产第一个自动在加载”） | 挂载时重置卡住的 flag；资产生成加幂等守卫 + 独立 controller |
| StepVideos “全部重新生成”用 forEach 并发，全部立即显示生成中 | 改为清空 videoUrl 后走批量生成（幂等 + 并发受控） |
| StepImages “重试失败/全部重新生成”用 forEach 并发 | 改为走批量生成 |
| ProjectWorkspace 进入页面自动重试（retryFailedVideos）与向导批量生成双入口并行，可能重复创建服务端视频任务 | 移除该自动重试入口，统一由向导视频步骤接管；清理不再使用的 abortRef/ensureAbortController |
| 免费档视频排队无提示 | StepVideos 显示“N 个排队中，免费档约 1 分钟/条” |

## 七、决定性证据补充：实际响应成片地址在顶层 `url` 字段

用户提供真实成功响应（已脱敏），关键结构：

```json
{
  "id": "video_xxx",
  "status": "completed",
  "internal_status": "completed",
  "progress": 100,
  "url": "https://cos-platform-outputs.agnes-ai.cn/videos/agnes-video-v2.0/video_xxx.mp4",
  "seconds": "4.7",
  "size": "704x1280"
}
```

**结论**：
- 中国站实际实现与官方文档示例（`metadata.url`）**不一致**——成片地址在**顶层 `url` 字段**。
- 此前解析链（`metadata.url` / `video_url` / `output.video_url`）均无法命中 → 轮询成功但提取不到 URL → 状态无法更新。
- 已修复：解析链改为 `url`（顶层）→ `metadata.url` → `video_url` → `output.url` → `output.video_url` → `remixed_from_video_id`；成功状态同时识别 `internal_status: "completed"`；`seconds` 转数字。
- 这是“官方已成功但前端无回显”的最终根因，现已彻底解决。

## 八、提示词被兜底文案覆盖（用户实测请求体）

用户实测视频请求体：

```json
{ "prompt": "Camera slowly pans, gentle movement", "width": 720, "height": 1280, "num_frames": 113, "frame_rate": 24 }
```

**根因**：`StepStoryboard.handleGenerateStoryboard` 在 `generateStoryboard` 之后又对每个分镜调用 `translateToMotion`（用单镜头 scriptText 重新翻译并覆盖 visualPrompt/motionPrompt）。该函数使用裸 `JSON.parse`，AI 返回稍带格式差异即失败 → 落入兜底文案 `"Camera slowly pans, gentle movement"`，把 AI 生成的完整英文提示词覆盖。

**修复**：
- 移除 StepStoryboard 中的 translateToMotion 覆盖步骤——`generateScript` 输出的分镜已含 AI 生成的完整英文双提示词（system prompt 明确要求完整动态描述）。
- 清理孤儿代码：`translateToMotion` 函数与 `MotionTranslationResult` 接口从 scriptService 移除。
- 附带收益：每个分镜少一次文本模型调用（省 token）。

## 九、后续建议（未实施）

1. 若仍出现单个镜头失败，可增加“查看服务端任务 ID + 手动重查”入口，便于与 Agnes 后台核对。
2. ProjectWorkspace 的“一键成片 / 重试失败”仍是 pipelineService 旧路径，未与向导批量生成统一，如需完全收敛可后续处理。
