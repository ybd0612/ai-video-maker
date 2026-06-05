# wxhb 设计文档

按功能模块划分的详细设计文档，供查阅和提需求参考。

## 文档目录

### 总览
- [系统架构](./architecture.md) — 技术栈、项目结构、数据流总览、模块依赖关系

### 画布核心
- [画布工作区](./canvas.md) — React Flow 集成、拖拽添加、坐标转换、视图同步
- [连接规则](./connections.md) — Handle 类型、连接校验矩阵、端口配置
- [连线样式](./edges.md) — TypedEdge 实现、颜色映射、动画

### 节点系统
- [节点总览](./nodes/README.md) — 节点架构、NodeShell 公共组件、StatusBadge
- [Prompt 节点](./nodes/prompt.md) — 文本输入源节点
- [Text 节点](./nodes/text.md) — 文本生成节点
- [Image 节点](./nodes/image.md) — 图像生成节点
- [Video 节点](./nodes/video.md) — 视频生成节点
- [Upload 节点](./nodes/upload.md) — 本地图片上传节点

### 工作流引擎
- [工作流执行](./workflow.md) — 拓扑排序、循环检测、级联失败、视频轮询

### AI Provider
- [Provider 架构](./providers.md) — ModelProvider 接口、AgnesAdapter 实现、模型注册表

### 状态管理
- [Store 设计](./stores.md) — canvasStore / settingsStore / taskStore 三个 Zustand store

### UI 组件
- [组件文档](./components.md) — Sidebar、TaskManager、SettingsDialog、PropertiesPanel

### 国际化
- [i18n 系统](./i18n.md) — 翻译字典、useT hook、翻译键规范

## 用户指南
- [使用指南](./USER_GUIDE.md) — 面向终端用户的操作手册
