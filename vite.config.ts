import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
    },
  },
  preview: {
    port: 5180,
    strictPort: true,
  },
});
