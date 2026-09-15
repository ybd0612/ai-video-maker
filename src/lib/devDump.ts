// ────────────────────────────────────────────────────────────────────────────
// src/lib/devDump.ts
// DEV-ONLY: keeps a local snapshot of the Zustand stores on disk so the AI
// assistant can read real browser data during local debugging.
//
// Flow: store change → debounce → sanitize → POST /__debug/dump
// The Vite plugin (vite-plugins/debugDumpPlugin.ts, apply:"serve") writes the
// payload to debug-dump/state.json. Production builds never register this.
//
// 同时提供运行日志落盘：logger 的新增条目经 250ms 合并后 POST /__debug/log，
// 由插件以 NDJSON 追加写入 debug-dump/runtime.log（生成环境不可用，改用面板导出）。
// ────────────────────────────────────────────────────────────────────────────

import { useProjectStore } from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { sanitizeForDump } from "@/lib/dumpSanitize";
import { getLogSnapshot, logger, subscribeLog, type LogEntry } from "@/lib/logger";

const DUMP_ENDPOINT = "/__debug/dump";
const LOG_ENDPOINT = "/__debug/log";
/** 日志落盘合批窗口：既能近实时看到卡住的调用，又避免每条一次请求 */
const LOG_FLUSH_MS = 250;
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

/**
 * DEV-ONLY: 资产提取原始响应留痕（LLM 间歇性异常输出的事后取证现场）。
 * 经 Vite 插件写入 debug-dump/extract-logs/extract-<ts>.json；best-effort，
 * 失败仅 console.debug，绝不影响提取主流程。生产构建不调用。
 */
export async function dumpExtractLog(payload: {
  idea: string;
  raw: string;
  /** 模型返回的 token 用量（观察 max_tokens 边界用） */
  usage?: { promptTokens?: number; completionTokens?: number };
}): Promise<void> {
  // 统一进日志流：面板可见 + 落进 runtime.log（与 extract-logs/ 文件同步取证）
  logger.warn("llm", "资产提取原始响应留痕（JSON 解析异常取证）", {
    ideaChars: payload.idea.length,
    raw: payload.raw,
    ...payload.usage,
  });
  if (!import.meta.env.DEV) return;
  try {
    await fetch("/__debug/extract-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ at: new Date().toISOString(), ...payload }),
    });
  } catch (err) {
    console.debug("[devDump] extract log failed:", err);
  }
}

/* ── 运行日志落盘（DEV） ─────────────────────────────────────────────────── */

/** 本次页面会话标识：写入每行日志，便于在 runtime.log 中区分刷新边界 */
const LOG_SESSION = Math.random().toString(36).slice(2, 10);

/**
 * DEV-ONLY: 把 logger 的新增条目增量写入 debug-dump/runtime.log（NDJSON）。
 * best-effort：失败仅 console.debug，绝不影响主流程；生成构建不注册。
 * 生成环境要看日志请用日志面板的「导出 JSON」。
 */
export function setupLogDump(): void {
  if (!import.meta.env.DEV) return;

  let lastId = 0;
  let pending: LogEntry[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = async (): Promise<void> => {
    timer = undefined;
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    try {
      await fetch(LOG_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session: LOG_SESSION, entries: batch }),
      });
    } catch (err) {
      console.debug("[devDump] log flush failed:", err);
    }
  };

  subscribeLog(() => {
    const all = getLogSnapshot();
    const fresh = all.filter((entry) => entry.id > lastId);
    if (fresh.length === 0) return;
    lastId = fresh[fresh.length - 1].id;
    pending.push(...fresh);
    if (timer === undefined) timer = setTimeout(() => void flush(), LOG_FLUSH_MS);
  });

  logger.info("app", "页面会话开始", { sessionId: LOG_SESSION });
}
