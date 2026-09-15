// ────────────────────────────────────────────────────────────────────────────
// src/components/LogViewerPanel.tsx
// 设置 → 日志：运行日志查看器（DevTools 风格，可展开条目查看完整请求/响应）。
// 数据源为 lib/logger 的内存环形缓冲，经 useSyncExternalStore 订阅实时刷新。
// ────────────────────────────────────────────────────────────────────────────

import { useMemo, useState, useSyncExternalStore } from "react";
import { ChevronDown, ChevronRight, Copy, Download, Trash2 } from "lucide-react";
import { useT, type TranslationKey } from "@/i18n";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  clearLog,
  exportLog,
  getLogSnapshot,
  subscribeLog,
  type LogEntry,
  type LogLevel,
} from "@/lib/logger";

const LEVELS: Array<LogLevel | "all"> = ["all", "debug", "info", "warn", "error"];
const SCOPES = ["all", "trace", "llm", "image", "video", "app"] as const;

const LEVEL_CLASS: Record<LogLevel, string> = {
  debug: "text-ink-4",
  info: "text-info",
  warn: "text-warn",
  error: "text-danger",
};

const LEVEL_BADGE: Record<LogLevel, string> = {
  debug: "border-line text-ink-4",
  info: "border-info/40 text-info",
  warn: "border-warn/50 text-warn",
  error: "border-danger/50 text-danger",
};

function timeLabel(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** 日志内容 → 可搜索文本（含 data 的 JSON，便于搜提示词/错误） */
function searchableText(entry: LogEntry): string {
  return [
    entry.scope,
    entry.message,
    entry.data ? JSON.stringify(entry.data) : "",
  ].join(" ").toLowerCase();
}

export function LogViewerPanel() {
  const t = useT();
  const entries = useSyncExternalStore(subscribeLog, getLogSnapshot, getLogSnapshot);
  const loggingEnabled = useSettingsStore((s) => s.loggingEnabled);
  const setLoggingEnabled = useSettingsStore((s) => s.setLoggingEnabled);

  const [level, setLevel] = useState<LogLevel | "all">("all");
  const [scope, setScope] = useState<(typeof SCOPES)[number]>("all");
  const [query, setQuery] = useState("");
  const [traceFilter, setTraceFilter] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries
      .filter((e) => (level === "all" ? true : e.level === level))
      .filter((e) => (scope === "all" ? true : e.scope === scope))
      .filter((e) => (traceFilter ? e.traceId === traceFilter : true))
      .filter((e) => (q ? searchableText(e).includes(q) : true))
      .slice()
      .reverse(); // 最新在前
  }, [entries, level, scope, query, traceFilter]);

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleExport = () => {
    const blob = new Blob([exportLog()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wxhb-log-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(exportLog());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div>
        <label className="text-sm font-medium text-ink">{t("log.title")}</label>
        <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-ink-5">{t("log.hint")}</p>
      </div>

      {/* 开关 + 操作 */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex select-none items-center gap-1.5 text-[0.6875rem] text-ink-3">
          <input
            type="checkbox"
            checked={loggingEnabled}
            onChange={(e) => setLoggingEnabled(e.target.checked)}
            className="h-3 w-3 accent-accent"
          />
          {t("log.enable")}
        </label>
        <span className="flex-1" />
        <button onClick={handleCopy} className="flex items-center gap-1 rounded border border-line px-2 py-1 text-[0.625rem] text-ink-3 hover:bg-raised">
          <Copy size={10} />
          {copied ? t("log.copied") : t("log.copy")}
        </button>
        <button onClick={handleExport} className="flex items-center gap-1 rounded border border-line px-2 py-1 text-[0.625rem] text-ink-3 hover:bg-raised">
          <Download size={10} />
          {t("log.export")}
        </button>
        <button onClick={() => clearLog()} className="flex items-center gap-1 rounded border border-line px-2 py-1 text-[0.625rem] text-danger hover:bg-raised">
          <Trash2 size={10} />
          {t("log.clear")}
        </button>
      </div>

      {/* 筛选 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <span className="text-[0.625rem] text-ink-5">{t("log.filterLevel")}</span>
          <div className="flex overflow-hidden rounded border border-line">
            {LEVELS.map((lv) => (
              <button
                key={lv}
                onClick={() => setLevel(lv)}
                className={`px-2 py-0.5 text-[0.625rem] transition ${
                  level === lv ? "bg-accent-solid text-white" : "text-ink-4 hover:bg-raised"
                }`}
              >
                {lv === "all" ? t("log.all") : t(`log.level.${lv}` as TranslationKey)}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[0.625rem] text-ink-5">{t("log.filterScope")}</span>
          <div className="flex overflow-hidden rounded border border-line">
            {SCOPES.map((sc) => (
              <button
                key={sc}
                onClick={() => setScope(sc)}
                className={`px-2 py-0.5 text-[0.625rem] transition ${
                  scope === sc ? "bg-accent-solid text-white" : "text-ink-4 hover:bg-raised"
                }`}
              >
                {sc === "all" ? t("log.all") : t(`log.scope.${sc}` as TranslationKey)}
              </button>
            ))}
          </div>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("log.search")}
          className="min-w-40 flex-1 rounded border border-line bg-raised px-2 py-1 text-[0.625rem] text-ink placeholder:text-ink-5 focus:border-accent focus:outline-none"
        />
      </div>

      {traceFilter && (
        <div className="flex items-center gap-2 rounded border border-accent/40 bg-accent-deep/20 px-2 py-1 text-[0.625rem] text-accent">
          <span className="truncate">{t("log.onlyThisTrace")}: {traceFilter}</span>
          <button onClick={() => setTraceFilter(null)} className="shrink-0 underline">
            {t("log.exitTraceFilter")}
          </button>
        </div>
      )}

      <p className="text-[0.625rem] text-ink-5">{t("log.count", { count: filtered.length })}</p>

      {/* 列表 */}
      <div className="max-h-[55vh] min-h-40 overflow-y-auto rounded border border-line bg-app font-mono text-[0.6875rem]">
        {filtered.length === 0 ? (
          <p className="p-3 text-center text-ink-5">{t("log.empty")}</p>
        ) : (
          filtered.map((entry) => {
            const isOpen = expanded.has(entry.id);
            const hasData = Boolean(entry.data && Object.keys(entry.data).length > 0);
            return (
              <div key={entry.id} className="border-b border-line-soft/60 last:border-b-0">
                <div
                  role={hasData ? "button" : undefined}
                  tabIndex={hasData ? 0 : undefined}
                  onClick={() => hasData && toggle(entry.id)}
                  onKeyDown={(e) => {
                    if (hasData && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      toggle(entry.id);
                    }
                  }}
                  className={`flex items-start gap-2 px-2 py-1 ${hasData ? "cursor-pointer hover:bg-raised" : ""}`}
                >
                  <span className="w-3 shrink-0 pt-0.5 text-ink-5">
                    {hasData ? (isOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />) : null}
                  </span>
                  <span className="shrink-0 text-ink-5">{timeLabel(entry.ts)}</span>
                  <span className={`w-9 shrink-0 rounded border px-1 text-center text-[0.5625rem] uppercase ${LEVEL_BADGE[entry.level]}`}>
                    {entry.level}
                  </span>
                  <span className="w-10 shrink-0 text-ink-4">{entry.scope}</span>
                  <span className={`min-w-0 flex-1 whitespace-pre-wrap break-all ${LEVEL_CLASS[entry.level]}`}>
                    {entry.message}
                  </span>
                  {typeof entry.durationMs === "number" && (
                    <span className="shrink-0 text-ink-5">{entry.durationMs}ms</span>
                  )}
                  {entry.traceId && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setTraceFilter(entry.traceId ?? null);
                      }}
                      title={`${t("log.traceLabel")}: ${entry.traceId}`}
                      className="shrink-0 rounded border border-line px-1 text-[0.5625rem] text-ink-5 hover:text-accent"
                    >
                      #{entry.traceId}
                    </button>
                  )}
                </div>
                {isOpen && entry.data && (
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all border-t border-line-soft/60 bg-surface px-3 py-2 text-[0.625rem] text-ink-2">
                    {JSON.stringify(entry.data, null, 2)}
                  </pre>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
