import { defineConfig } from "vitest/config";
import path from "node:path";

// 单元测试专用配置（不使用浏览器环境）。
// 仅复用 vite 的 @ 路径别名；不加载 react / tailwind 插件 —— 单元测试只覆盖纯逻辑，
// 不渲染组件，避免无谓的构建开销。
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    // 纯 Node 环境：不引入 jsdom/happy-dom。
    // 需要 localStorage 的用例由 tests/helpers/localStorage.ts 手写轻量桩。
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
    restoreMocks: true,
  },
});
