import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/globals.css";
import App from "./App";
import { useProjectStore } from "@/stores/projectStore";
import { setupDevDump } from "@/lib/devDump";

// Expose store for debugging / browser automation
(window as unknown as Record<string, unknown>).__projectStore = useProjectStore;

// DEV-ONLY: mirror sanitized store snapshots to debug-dump/state.json
// (via the debugDumpPlugin Vite middleware) for local debugging.
if (import.meta.env.DEV) {
  setupDevDump();
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
