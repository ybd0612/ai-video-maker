# 视频生成一直未成功 — 全面调研报告

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

## 六、后续建议（未实施）

1. 若仍出现单个镜头失败，可增加“查看服务端任务 ID + 手动重查”入口，便于与 Agnes 后台核对。
2. 进入项目页自动重试失败视频（`pipelineService.retryFailedVideos`）仍是旧入口，建议后续统一走 wizard 视频步骤。
3. 免费档视频生成约 1 次/分钟（RPM=1），4-8 个镜头需排队 4-8 分钟以上，属正常现象，可在 UI 提示预计等待时间。
