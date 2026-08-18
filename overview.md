# 画幅比例不可点击问题修复

## 完成内容
- 修复“输入想法/视频”页面在尚未创建项目时，画幅比例按钮点击后没有任何视觉或状态反馈的问题。
- 新增页面本地画幅选择状态；未创建项目时先保存选择，点击“下一步”创建项目时再写入项目。
- 已存在项目时仍直接同步更新项目画幅比例。

## 本轮附加修复
- 修复资产角色按名称（忽略首尾空格和大小写）去重，避免重复生成同一角色。
- 免费套餐视频并发调整为 1；付费/企业套餐保持 2，界面不会提前把多个视频都标记为生成中。
- 视频单任务轮询从 10 分钟延长到 30 分钟，任务注册等待从 30 秒延长到 2 分钟。
- 服务端任务已创建但轮询超时不再标记为 failed，也不创建重复任务，保留 videoing 状态。
- 修复 Agnes 完成响应解析：官方成片地址位于 `metadata.url`，同时兼容旧版 `video_url` / `output.url` 字段。
- 只有任务明确 `failed` / `cancelled` 才显示失败；已创建但仍可能运行的任务继续保持生成状态。
- 全面调研视频生成失败根因（报告：docs/video-generation-investigation-2026-08-18.md），修复：
  - StepVideos 自动触发 effect 重入导致任务被误杀/重复创建（去掉 videoGenerationStarted 依赖）；
  - 批量生成加幂等守卫 + 独立 AbortController（模块级 activeVideoTasks 注册表）；
  - 刷新后残留 videoing 自动重置为 imaged 重新接管（解决永久加载中）；
  - rerollVideo 独立 controller，服务端任务仍运行时不误报失败；
  - “重试失败”改走并发受控的批量生成。
- 全面修复同类问题：
  - StepImages 同样存在 effect 重入缺陷（图片请求被误杀/重复生成）→ 依赖修复 + 幂等守卫 + 独立 controller + 刷新恢复 imaging；
  - StepAssets 的 assetGenerationStarted 刷新后卡 true 导致按钮永久转圈 → 挂载重置 + 幂等守卫；
  - “全部重新生成/重试失败”全部改走批量生成（消除 forEach 并发）；
  - 移除 ProjectWorkspace 的 retryFailedVideos 自动重试入口（与向导双入口冲突，会重复创建服务端任务）；
  - StepVideos 增加免费档排队提示（约 1 分钟/条）。

## 验证结果
- TypeScript 类型检查通过。
- `git diff --check` 通过。
- Vite 生产构建通过；仅保留已有的 chunk 体积提示。

## 备注
- `.workbuddy/` 为工作区工具数据，未纳入提交。
