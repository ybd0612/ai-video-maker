import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/globals.css";
import App from "./App";
import { useProjectStore } from "@/stores/projectStore";
import { setupDevDump, setupLogDump } from "@/lib/devDump";
import { setupLogPersistence } from "@/lib/logger";

// 日志持久化：从 localStorage 恢复历史 + 页面隐藏/卸载时立即落盘。
// 生产构建同样生效（DEV 之外也要能刷新后查日志）。
setupLogPersistence();

// Expose store for debugging / browser automation
(window as unknown as Record<string, unknown>).__projectStore = useProjectStore;

// DEV-ONLY: mirror sanitized store snapshots to debug-dump/state.json
// (via the debugDumpPlugin Vite middleware) for local debugging.
if (import.meta.env.DEV) {
  setupDevDump();
  setupLogDump();
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
