import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "@/styles/globals.css";
import App from "./App";
import { useCanvasStore } from "@/stores/canvasStore";

// Expose store for debugging / browser automation
(window as unknown as Record<string, unknown>).__canvasStore = useCanvasStore;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);