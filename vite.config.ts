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
      "/cdn-proxy": {
        target: "https://platform-outputs.agnes-ai.space",
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
