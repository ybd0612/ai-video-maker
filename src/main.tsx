import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/globals.css";
import App from "./App";
import { useProjectStore } from "@/stores/projectStore";

// Expose store for debugging / browser automation
(window as unknown as Record<string, unknown>).__projectStore = useProjectStore;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
