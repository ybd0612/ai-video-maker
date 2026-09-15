// ────────────────────────────────────────────────────────────────────────────
// src/components/LogConsoleDock.tsx
// 主界面底部停靠的日志控制台（Chrome DevTools 风格）。
// - 顶边可拖拽调整高度（持久化到 settingsStore.logPanelHeight）
// - 头部：级别/来源筛选、关键字搜索、展开/收起全部、复制/导出/清空、关闭
// - 条目：点击展开完整请求/响应 JSON；点 #traceId 只看该链路
// 数据源为 lib/logger 的内存环形缓冲，经 useSyncExternalStore 实时刷新。
// ────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  Download,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { useT, type TranslationKey } from "@/i18n";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  clearLog,
  exportLog,
  getLogSnapshot,
  renderLogMessage,
  subscribeLog,
  type LogEntry,
  type LogLevel,
} from "@/lib/logger";

const LEVELS: Array<LogLevel | "all"> = ["all", "debug", "info", "warn", "error"];
const SCOPES = ["all", "trace", "llm", "image", "video", "app"] as const;

const MIN_HEIGHT = 120;
const MAX_HEIGHT_RATIO = 0.75;

const LEVEL_TEXT: Record<LogLevel, string> = {
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

/** 可搜索文本（含 data 的 JSON，便于直接搜提示词或错误） */
function searchableText(entry: LogEntry): string {
  return [entry.scope, entry.message, entry.data ? JSON.stringify(entry.data) : ""]
    .join(" ")
    .toLowerCase();
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 py-0.5 text-[0.625rem] transition ${
        active ? "bg-accent-solid text-white" : "text-ink-4 hover:bg-raised"
      }`}
    >
      {children}
    </button>
  );
}

export function LogConsoleDock() {
  const t = useT();
  const entries = useSyncExternalStore(subscribeLog, getLogSnapshot, getLogSnapshot);
  const height = useSettingsStore((s) => s.logPanelHeight);
  const setHeight = useSettingsStore((s) => s.setLogPanelHeight);
  const setShowLogPanel = useSettingsStore((s) => s.setShowLogPanel);
  const persistLog = useSettingsStore((s) => s.persistLog);

  const [level, setLevel] = useState<LogLevel | "all">("all");
  const [scope, setScope] = useState<(typeof SCOPES)[number]>("all");
  const [query, setQuery] = useState("");
  const [traceFilter, setTraceFilter] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState(false);
  const dragState = useRef<{ startY: number; startHeight: number } | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries
      .filter((e) => (level === "all" ? true : e.level === level))
      .filter((e) => (scope === "all" ? true : e.scope === scope))
      .filter((e) => (traceFilter ? e.traceId === traceFilter : true))
      .filter((e) => (q ? searchableText(e).includes(q) : true))
      .slice()
      .reverse(); // 最新在前（DevTools 习惯）
  }, [entries, level, scope, query, traceFilter]);

  const errorCount = useMemo(() => entries.filter((e) => e.level === "error").length, [entries]);
  const expandableIds = useMemo(
    () => filtered.filter((e) => e.data && Object.keys(e.data).length > 0).map((e) => e.id),
    [filtered],
  );

  /* ── 拖拽调整高度 ─────────────────────────────────────────────────────── */
  const handleDragStart = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      dragState.current = { startY: event.clientY, startHeight: height };
      const maxHeight = Math.round(window.innerHeight * MAX_HEIGHT_RATIO);
      const onMove = (moveEvent: MouseEvent) => {
        const state = dragState.current;
        if (!state) return;
        // 面板在底部：鼠标上移 → 变高
        const next = state.startHeight + (state.startY - moveEvent.clientY);
        setHeight(Math.min(maxHeight, Math.max(MIN_HEIGHT, Math.round(next))));
      };
      const onUp = () => {
        dragState.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [height, setHeight],
  );

  useEffect(() => () => {
    dragState.current = null;
  }, []);

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** 词典缺失时回退到原始值，避免界面上出现 "log.scope.xxx" 这种裸 key */
  const labelOr = useCallback(
    (key: string, fallback: string) => {
      const label = t(key as TranslationKey);
      return label === key ? fallback : label;
    },
    [t],
  );

  /** 日志消息按当前语言渲染（logmsg.* key → 译文，其余原样） */
  const localizeMessage = useCallback(
    (message: string) => renderLogMessage(message, (key) => t(key as TranslationKey)),
    [t],
  );

  const handleExport = () => {
    const blob = new Blob([exportLog(localizeMessage)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wxhb-log-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(exportLog(localizeMessage));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const allExpanded = expandableIds.length > 0 && expandableIds.every((id) => expanded.has(id));

  return (
    <section
      className="flex shrink-0 flex-col border-t border-line bg-app"
      style={{ height }}
      aria-label={t("log.title")}
    >
      {/* 拖拽把手 */}
      <div
        onMouseDown={handleDragStart}
        title={t("log.dragHint")}
        className="group flex h-1.5 shrink-0 cursor-row-resize items-center justify-center bg-line-soft transition hover:bg-accent/40"
      >
        <span className="h-0.5 w-10 rounded-full bg-line-strong transition group-hover:bg-accent" />
      </div>

      {/* 头部工具栏 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-2 py-1">
        <span className="flex items-center gap-1.5 text-[0.6875rem] font-semibold text-ink">
          {t("log.title")}
          {persistLog && (
            <span title={t("log.persistedMark")} className="text-ink-5">
              <Save size={10} />
            </span>
          )}
          {errorCount > 0 && (
            <span className="rounded border border-danger/50 px-1 text-[0.5625rem] text-danger">
              {errorCount}
            </span>
          )}
        </span>

        <div className="flex overflow-hidden rounded border border-line">
          {LEVELS.map((lv) => (
            <Chip key={lv} active={level === lv} onClick={() => setLevel(lv)}>
              {lv === "all" ? t("log.all") : t(`log.level.${lv}` as TranslationKey)}
            </Chip>
          ))}
        </div>

        <div className="flex overflow-hidden rounded border border-line">
          {SCOPES.map((sc) => (
            <Chip key={sc} active={scope === sc} onClick={() => setScope(sc)}>
              {sc === "all" ? t("log.all") : t(`log.scope.${sc}` as TranslationKey)}
            </Chip>
          ))}
        </div>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("log.search")}
          className="min-w-32 flex-1 rounded border border-line bg-raised px-2 py-0.5 text-[0.625rem] text-ink placeholder:text-ink-5 focus:border-accent focus:outline-none"
        />

        <span className="text-[0.625rem] text-ink-5">{t("log.count", { count: filtered.length })}</span>

        <button
          type="button"
          onClick={() => setExpanded(allExpanded ? new Set() : new Set(expandableIds))}
          disabled={expandableIds.length === 0}
          title={allExpanded ? t("log.collapseAll") : t("log.expandAll")}
          className="rounded p-1 text-ink-4 hover:bg-raised disabled:opacity-40"
        >
          {allExpanded ? <ChevronsDownUp size={11} /> : <ChevronsUpDown size={11} />}
        </button>
        <button
          type="button"
          onClick={handleCopy}
          title={t("log.copy")}
          className="rounded p-1 text-ink-4 hover:bg-raised"
        >
          <Copy size={11} />
        </button>
        <button
          type="button"
          onClick={handleExport}
          title={t("log.export")}
          className="rounded p-1 text-ink-4 hover:bg-raised"
        >
          <Download size={11} />
        </button>
        <button
          type="button"
          onClick={() => clearLog()}
          title={t("log.clear")}
          className="rounded p-1 text-danger hover:bg-raised"
        >
          <Trash2 size={11} />
        </button>
        <button
          type="button"
          onClick={() => setShowLogPanel(false)}
          title={t("log.close")}
          className="rounded p-1 text-ink-4 hover:bg-raised"
        >
          <X size={12} />
        </button>
        {copied && <span className="text-[0.625rem] text-success">{t("log.copied")}</span>}
      </div>

      {import.meta.env.DEV && (
        <p className="border-b border-line-soft bg-raised/40 px-2 py-0.5 text-[0.625rem] text-ink-5">
          {t("log.localHint")}
        </p>
      )}

      {traceFilter && (
        <div className="flex items-center gap-2 border-b border-line-soft bg-accent-deep/20 px-2 py-0.5 text-[0.625rem] text-accent">
          <span className="truncate">
            {t("log.onlyThisTrace")}: {traceFilter}
          </span>
          <button type="button" onClick={() => setTraceFilter(null)} className="shrink-0 underline">
            {t("log.exitTraceFilter")}
          </button>
        </div>
      )}

      {/* 条目列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto font-mono text-[0.6875rem]">
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
                  className={`flex items-start gap-2 px-2 py-0.5 ${hasData ? "cursor-pointer hover:bg-raised" : ""}`}
                >
                  <span className="w-3 shrink-0 pt-0.5 text-ink-5">
                    {hasData ? (isOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />) : null}
                  </span>
                  <span className="shrink-0 text-ink-5">{timeLabel(entry.ts)}</span>
                  <span className={`w-11 shrink-0 rounded border px-1 text-center text-[0.5625rem] ${LEVEL_BADGE[entry.level]}`}>
                    {labelOr(`log.level.${entry.level}`, entry.level)}
                  </span>
                  <span className="w-10 shrink-0 text-ink-4">
                    {labelOr(`log.scope.${entry.scope}`, entry.scope)}
                  </span>
                  <span className={`min-w-0 flex-1 whitespace-pre-wrap break-all ${LEVEL_TEXT[entry.level]}`}>
                    {localizeMessage(entry.message)}
                  </span>
                  {typeof entry.durationMs === "number" && (
                    <span className="shrink-0 text-ink-5">{entry.durationMs}ms</span>
                  )}
                  {entry.traceId && (
                    <button
                      type="button"
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
                  <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all border-t border-line-soft/60 bg-surface px-3 py-1.5 text-[0.625rem] text-ink-2">
                    {JSON.stringify(entry.data, null, 2)}
                  </pre>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
