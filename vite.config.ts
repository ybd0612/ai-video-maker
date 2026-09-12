import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { debugDumpPlugin } from "./vite-plugins/debugDumpPlugin";

export default defineConfig({
  // 相对路径 base：兼容 GitHub Pages 子路径（https://<user>.github.io/<repo>/）
  // 与自定义域名；构建产物资源引用变为 ./assets/...
  base: "./",
  // debugDumpPlugin：仅 dev server 生效（apply:"serve"），接收脱敏后的 store
  // 快照写入 debug-dump/state.json，供 AI 助手本地调试读取真实浏览器数据。
  plugins: [react(), tailwindcss(), debugDumpPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    host: "127.0.0.1",
    open: true,
    proxy: {
      // 视频/图片输出域名代理（规避浏览器 CORS）。
      // 实测中国站成片地址域名为 cos-platform-outputs.agnes-ai.cn（见 docs/video-generation-investigation-2026-08-18.md），
      // 旧域名 platform-outputs.agnes-ai.space 已失效，勿改回。
      "/cdn-proxy": {
        target: "https://cos-platform-outputs.agnes-ai.cn",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/cdn-proxy/, ""),
      },
      // FFmpeg 核心文件走国内 npm 镜像，代理后变为同源请求，避免 CORS 和跨境下载慢。
      "/ffmpeg-core": {
        target: "https://cdn.npmmirror.com",
        changeOrigin: true,
        rewrite: (p) => p.replace(
          /^\/ffmpeg-core\/@ffmpeg\/core@(\d+\.\d+\.\d+)\/dist/,
          "/packages/@ffmpeg/core/$1/files/dist",
        ),
      },
    },
  },
  preview: {
    port: 5180,
    strictPort: true,
  },
});
