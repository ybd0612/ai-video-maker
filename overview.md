# wxhb 项目结构与复用性重构概览

## 已完成

本轮按低风险到高风险分批完成 5 批重构：

1. 删除不再需要的 `src/providers/` 模型抽象层，统一视频帧数规则，并复用角色完整提示词构造。
2. 将 `scriptService` 收敛到 `services/ai` 的统一文本调用入口，使分镜生成进入统一限流器；同时补齐视频尺寸参数透传。
3. 删除 `ProjectWorkspace` 中与向导重复的失败重试和单镜头生成实现，右侧编辑器统一调用 `useWizardActions`。
4. 清理确认无引用的服务包装函数和辅助函数。
5. 抽取 `useWizardActions` 中重复的角色合并与图片生成请求构造逻辑。

## 提交记录

- `9fc43c4` 重构：清理无用模型抽象并统一帧数规则
- `30ce5ac` 重构：统一分镜文本调用与视频尺寸参数
- `c03886e` 重构：收敛旧版镜头重生成入口
- `1d67f57` 清理：移除未使用的服务包装函数
- `673019d` 重构：抽取向导角色与图片生成复用逻辑
- `7045644` 文档：记录项目结构重构结果

## 验证与遗留

- `tsc --noEmit`：通过。
- `git diff --check`：通过。
- Vite 已完成源码模块转换，但构建清理既有 `dist/assets` 时被 safe-delete/文件占用中止；未擅自删除目录。
- Playwright 因清理 `test-results` 时同类 safe-delete 中止，未执行测试。
- 未继续改动 Zustand store 的 active/byId 双 API，也未抽取 `StepImages`/`StepVideos` 通用壳，避免本轮扩大回归范围。
- 当前工作区有未跟踪的 `.workbuddy/`、`playwright-report/`、`test-results/`，它们属于工具/测试产物，后续提交业务改动时不要误提交。
