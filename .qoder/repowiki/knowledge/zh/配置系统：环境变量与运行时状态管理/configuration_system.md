该应用采用**双层配置架构**，结合了构建时环境变量（Build-time Env Vars）和运行时用户持久化配置（Runtime User Config）。

### 1. 配置分层策略
- **基础层 (Environment Variables)**: 使用 Vite 的标准 `import.meta.env` 机制。通过 `.env.example` 定义默认值，主要用于开发环境的初始化和 CI/CD 流程。所有变量均以 `VITE_` 前缀暴露给客户端。
- **运行时层 (User Settings Store)**: 核心业务配置（如 API Key、Base URL）由 `zustand` 管理的 `settingsStore` 承载。该层配置通过 `persist` 中间件持久化到浏览器的 `localStorage`（Key: `wxhb-settings`），优先级高于环境变量，允许用户在 UI 中动态修改并即时生效。

### 2. 关键配置项
- **API 凭证**: `apiKey` 和 `baseUrl` 是驱动 AI 服务（Agnes AI）的核心。虽然 `.env` 提供了 `VITE_AGNES_API_KEY`，但应用逻辑倾向于从 `settingsStore` 读取用户输入的密钥，以支持多租户或临时切换场景。
- **模型标识符**: 文本、图像和视频的模型 ID 被集中定义在 `src/lib/models.ts` 的 `MODELS` 常量中。这是一种“代码即配置”的模式，目前未开放给用户动态修改，需通过代码更新。
- **国际化与主题**: `language` (zh/en) 和 `darkMode` 同样存储在 `settingsStore` 中，实现跨会话的用户偏好保持。

### 3. 架构约定
- **配置解析工具**: `src/lib/resolveBaseUrl.ts` 提供了一个简单的工具函数，用于标准化 API 地址（去除尾部斜杠），确保 fetch 请求的健壮性。
- **适配器模式**: `src/providers/agnes/AgnesAdapter.ts` 作为具体的服务提供者，其构造函数或方法调用依赖于从 Store 中提取的配置，实现了配置与业务逻辑的解耦。
- **验证机制**: 在 `SettingsDialog.tsx` 中集成了基础的 URL 格式校验和非空检查，防止无效配置进入存储层。

### 4. 开发者指南
- **新增配置项**: 若需增加全局配置，应首先在 `settingsStore.ts` 中定义 State 和 Action，并在 `SettingsDialog.tsx` 中提供 UI 入口。避免直接在组件中硬编码配置值。
- **环境变量使用**: 仅将那些不需要用户干预、且在不同部署环境（Dev/Prod）中固定的值放入 `.env` 文件。
- **安全性注意**: 由于是纯前端应用，所有配置最终都会暴露在客户端。严禁在 `.env` 或 Store 中存储真正的后端私钥，目前的 API Key 模式适用于直接调用第三方公开网关的场景。