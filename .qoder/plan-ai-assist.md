# AI 辅助提示词优化功能实现计划

## Context

项目是一个 AI 一键成片 Pipeline 工具。用户在 ShotEditor 中编辑分镜的文案（scriptText）和画面描述（visualPrompt），在 ScriptPanel 中输入视频主题。当前这些字段只能手动编辑，缺少 AI 辅助优化能力。

**设计原则**：简单优先 — 一键生成流程完全不变，AI 辅助是纯可选增强。

## 功能概述

在每个输入框旁添加 ✨ 按钮，点击后从右侧滑出 AI 对话抽屉，用户可与 AI 多轮对话优化内容，满意后点击"应用"替换输入框。

## 文件变更清单

| 步骤 | 文件 | 操作 | 说明 |
|------|------|------|------|
| 1 | `src/i18n/index.ts` | 修改 | 新增 14 个 aiAssist.* 翻译键（zh + en） |
| 2 | `src/services/chatService.ts` | 新建 | 多轮对话 API 调用 + 系统提示词定义 |
| 3 | `src/components/ui/AiAssistDrawer.tsx` | 新建 | 可复用的 AI 对话抽屉组件 |
| 4 | `src/features/shots/ShotEditor.tsx` | 修改 | 添加 2 个 ✨ 按钮 + 1 个回调 prop |
| 5 | `src/features/script/ScriptPanel.tsx` | 修改 | 添加 1 个 ✨ 按钮 + promptOverride prop |
| 6 | `src/pages/ProjectWorkspace.tsx` | 修改 | 状态管理 + Drawer 渲染 + 回调路由 |

## 实现细节

### Task 1: i18n 翻译键

在 `zh` 和 `en` 字典中各新增 14 个键（`aiAssist.title`, `aiAssist.placeholder`, `aiAssist.send`, `aiAssist.apply`, `aiAssist.applied`, `aiAssist.thinking`, `aiAssist.close`, `aiAssist.error`, `aiAssist.currentContent`, `aiAssist.newConversation`, `aiAssist.optimizeScriptText`, `aiAssist.optimizeVisualPrompt`, `aiAssist.optimizeMainPrompt`, `aiAssist.emptyField`）。

### Task 2: chatService.ts

- **接口**：`ChatMessage { role, content }`, `ChatOptions { apiKey, baseUrl, messages }`, `ChatResult { content }`
- **API 调用**：复用 `/chat/completions` 端点，镜像 `scriptService.ts` 的 fetch + Content-Type 校验模式
- **模型**：`MODELS.text`（agnes-2.0-flash）
- **无重试**：对话是自由文本，无需 JSON 解析重试
- **导出 3 组系统提示词常量**：
  - `SYSTEM_PROMPT_SCRIPT_TEXT` — 短视频文案优化专家（中文）
  - `SYSTEM_PROMPT_VISUAL_PROMPT` — AI 图像提示词工程师（英文）
  - `SYSTEM_PROMPT_MAIN_PROMPT` — 视频创意策划师（中文）

### Task 3: AiAssistDrawer 组件

**Props**: `open`, `onClose`, `currentValue`, `fieldName`, `systemPrompt`, `onApply`

**内部状态**（组件级 useState，不持久化）：
- `messages: ChatMessage[]` — 对话历史（上限 10 条）
- `input: string` — 输入框文本
- `isLoading: boolean` — API 调用中
- `error: string | null`

**UI 结构**：
```
┌─────────────────────────┐
│ [字段名] AI 优化     [X] │
├─────────────────────────┤
│ 当前内容: [只读预览框]   │
├─────────────────────────┤
│                         │
│ 👤 用户消息（右对齐）    │
│ 🤖 AI 回复（左对齐）     │
│    [应用] 按钮           │
│                         │
├─────────────────────────┤
│ [输入框]         [发送]  │
└─────────────────────────┘
```

**动画**：`framer-motion` 的 `AnimatePresence` + `motion.div`，从右侧滑入（同 SettingsDialog 模式），z-index 90（低于 SettingsDialog 的 100）。

**对话初始化**：打开时将 currentValue 作为上下文注入首条消息（不在 UI 显示）。

**应用机制**：每条 AI 回复旁有独立的 [应用] 按钮，用户可浏览多个建议后选择满意的。

### Task 4: ShotEditor 修改

- 新增 prop: `onOpenAiAssist: (field: "scriptText" | "visualPrompt", value: string) => void`
- scriptText label 旁添加 ✨ 按钮 → `onOpenAiAssist("scriptText", shot.scriptText)`
- visualPrompt label 旁添加 ✨ 按钮 → `onOpenAiAssist("visualPrompt", shot.visualPrompt)`
- **不添加任何状态或 Drawer 渲染** — ShotEditor 保持纯编辑器

### Task 5: ScriptPanel 修改

- 新增 props: `onOpenAiAssist: (value: string) => void`, `promptOverride?: string`
- 标题旁添加 ✨ 按钮（仅 prompt 非空时显示）
- `useEffect` 监听 `promptOverride` 变化同步内部 state

### Task 6: ProjectWorkspace 编排

- 新增 `aiAssistTarget` state（字段类型、shotId、当前值、系统提示词）
- `handleOpenShotAiAssist(field, value)` — 根据字段选择对应系统提示词
- `handleAiAssistApply(value)` — 路由回 `updateShot()` 或 ScriptPanel override
- 渲染 `<AiAssistDrawer />` 在页面根级别

## 验证方案

1. **TypeScript 编译**：`npx tsc --noEmit` 无错误
2. **一键生成不受影响**：不点击 ✨ 按钮，完整走一遍 Pipeline（脚本→图片→视频→拼接）确认无回归
3. **AI 辅助功能**：
   - 在 ShotEditor 的文案字段点击 ✨ → 抽屉滑出 → 输入优化需求 → AI 返回 → 点击应用 → 输入框更新
   - 在画面描述字段重复上述流程
   - 在 ScriptPanel 主题字段重复上述流程
4. **i18n 切换**：切换中/英文后，抽屉内所有文本正确翻译
5. **边界情况**：空字段时点击 ✨、对话超过 10 条时旧消息被裁剪、切换 shot 时抽屉关闭
