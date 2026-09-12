// ────────────────────────────────────────────────────────────────────────────
// src/lib/devDump.ts
// DEV-ONLY: keeps a local snapshot of the Zustand stores on disk so the AI
// assistant can read real browser data during local debugging.
//
// Flow: store change → debounce → sanitize → POST /__debug/dump
// The Vite plugin (vite-plugins/debugDumpPlugin.ts, apply:"serve") writes the
// payload to debug-dump/state.json. Production builds never register this.
// ────────────────────────────────────────────────────────────────────────────

import { useProjectStore } from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { sanitizeForDump } from "@/lib/dumpSanitize";

const DUMP_ENDPOINT = "/__debug/dump";
const DEBOUNCE_MS = 800;
/** Matches the limit enforced by the Vite plugin. */
const MAX_PAYLOAD_BYTES = 20 * 1024 * 1024;

export function setupDevDump(): void {
  if (!import.meta.env.DEV) return;

  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  let pending = false;

  const buildPayload = (): Record<string, unknown> =>
    sanitizeForDump({
      project: useProjectStore.getState(),
      settings: useSettingsStore.getState(),
    });

  const post = async (): Promise<void> => {
    if (inFlight) {
      pending = true;
      return;
    }
    inFlight = true;
    try {
      const body = JSON.stringify(buildPayload());
      if (body.length > MAX_PAYLOAD_BYTES) {
        console.debug("[devDump] payload too large, skipped");
        return;
      }
      await fetch(DUMP_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
    } catch (err) {
      // Never disturb the app: dump is best-effort debug tooling.
      console.debug("[devDump] dump failed:", err);
    } finally {
      inFlight = false;
      if (pending) {
        pending = false;
        schedule();
      }
    }
  };

  const schedule = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void post();
    }, DEBOUNCE_MS);
  };

  useProjectStore.subscribe(schedule);
  useSettingsStore.subscribe(schedule);
  // Drop an initial snapshot right after hydration.
  void post();
}
