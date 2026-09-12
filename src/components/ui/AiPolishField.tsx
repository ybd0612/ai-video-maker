// ────────────────────────────────────────────────────────────────────────────
// src/components/ui/AiPolishField.tsx
// 输入框内嵌「润色 / 撤销」按钮：
//   - 润色：一键把当前内容交给该字段的专家角色优化，结果自动回填
//   - 撤销：逐步回退到上一次润色前的内容
// 按钮浮在输入框右下角，不占用额外垂直空间。
// ────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Sparkles, Undo2 } from "lucide-react";
import { useT } from "@/i18n";
import { useSettingsStore } from "@/stores/settingsStore";
import { polishText } from "@/services/chatService";
import { resolvePolishSystemPrompt } from "@/lib/promptRules";

interface AiPolishFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** 润色所用的专家系统提示词；未提供时不显示润色按钮 */
  systemPrompt?: string;
  placeholder?: string;
  /** 多行模式的行数（默认 2） */
  rows?: number;
  /** 单行输入模式（使用 input 而非 textarea） */
  singleLine?: boolean;
  disabled?: boolean;
  /** 透明背景的内联样式（用于卡片内直接编辑），默认带边框与底色 */
  bare?: boolean;
  /** 焦点边框色，例如 "focus:border-accent" */
  focusClass?: string;
  /** 该值变化时清空撤销栈（如切换镜头 / 资产 / 项目） */
  resetKey?: string;
  /** 覆盖输入框外观类（颜色 / 边框 / 背景）；内边距与布局由组件统一控制 */
  appearanceClass?: string;
  /** 键盘事件透传（如 Enter 提交） */
  onKeyDown?: (
    e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => void;
}

/** 默认外观：带边框与底色（抽屉 / 表单场景） */
const BOXED_APPEARANCE =
  "rounded-md border border-line bg-raised text-xs text-ink placeholder:text-ink-5";
/** 默认外观：透明背景（卡片内联编辑场景） */
const BARE_APPEARANCE =
  "bg-transparent text-xs text-ink-2 placeholder:text-ink-5";

/** 内嵌操作按钮：纯图标 + 固定方形尺寸（不显示文字，含义靠 title 提示） */
const ACTION_BUTTON =
  "pointer-events-auto flex h-5 w-5 items-center justify-center rounded border border-line-strong/70 bg-surface/85 text-ink-3 backdrop-blur-sm transition disabled:cursor-not-allowed disabled:opacity-40";

export function AiPolishField({
  value,
  onChange,
  systemPrompt,
  placeholder,
  rows = 2,
  singleLine = false,
  disabled = false,
  bare = false,
  focusClass = "focus:border-success",
  resetKey,
  appearanceClass,
  onKeyDown,
}: AiPolishFieldProps) {
  const t = useT();
  const apiKey = useSettingsStore((s) => s.providerConfig.apiKey);
  const baseUrl = useSettingsStore((s) => s.providerConfig.baseUrl);
  const language = useSettingsStore((s) => s.language);

  /** 撤销栈：每次润色前压入原文快照 */
  const [history, setHistory] = useState<string[]>([]);
  const [polishing, setPolishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 切换镜头 / 资产 / 项目时清空撤销栈与错误提示，避免跨对象串用
  useEffect(() => {
    setHistory([]);
    setError(null);
  }, [resetKey]);

  // 润色请求可能在组件卸载后返回，避免对已卸载组件写状态
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const canPolish =
    !!systemPrompt && !!value.trim() && !disabled && !polishing && !!apiKey;

  const handlePolish = useCallback(async () => {
    if (!canPolish || !systemPrompt) return;
    const snapshot = value;
    setPolishing(true);
    setError(null);
    try {
      const polished = await polishText({
        apiKey,
        baseUrl,
        value: snapshot,
        // 走规则注册表解析：传入文本命中内置 polish 条目时，取用户覆盖后的生效版本
        systemPrompt: resolvePolishSystemPrompt(systemPrompt),
        language,
      });
      if (!mountedRef.current) return;
      const next = polished.trim();
      // 内容无实质变化时不入栈，避免出现「撤销后内容不变」的空步骤
      if (next && next !== snapshot.trim()) {
        setHistory((prev) => [...prev, snapshot]);
        onChange(next);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (mountedRef.current) setPolishing(false);
    }
  }, [canPolish, systemPrompt, value, apiKey, baseUrl, language, onChange]);

  const handleUndo = useCallback(() => {
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    setHistory((prev) => prev.slice(0, -1));
    setError(null);
    onChange(previous);
  }, [history, onChange]);

  // 布局类统一由组件控制，避免与调用方传入外观类发生 padding 冲突
  // 多行：底部留出 pb-9 给图标按钮 + 与下边框的间距；单行：右侧留出 pr-16
  const layoutClass = singleLine
    ? "w-full py-1.5 pl-2 pr-16"
    : "w-full resize-none px-2 pt-2 pb-9";
  const inputClass = `${appearanceClass ?? (bare ? BARE_APPEARANCE : BOXED_APPEARANCE)} ${layoutClass} ${
    disabled ? "opacity-50" : ""
  } focus:outline-none ${focusClass}`;

  const commonProps = {
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange(e.target.value),
    onKeyDown,
    placeholder,
    disabled,
    className: inputClass,
  };

  return (
    <div className="relative">
      {singleLine ? (
        <input type="text" {...commonProps} />
      ) : (
        <textarea rows={rows} {...commonProps} />
      )}

      {/* 内嵌操作区：纯图标。多行贴右下角（与下边框留出间距），单行垂直居中 */}
      {(systemPrompt || history.length > 0) && (
        <div
          className={`pointer-events-none absolute flex items-center gap-1 ${
            singleLine ? "right-2 top-1/2 -translate-y-1/2" : "bottom-2.5 right-2.5"
          }`}
        >
          {history.length > 0 && (
            <button
              type="button"
              onClick={handleUndo}
              disabled={disabled || polishing}
              className={`${ACTION_BUTTON} hover:border-warn/70 hover:text-warn`}
              title={t("polish.undo")}
            >
              <Undo2 size={12} />
            </button>
          )}
          {systemPrompt && (
            <button
              type="button"
              onClick={handlePolish}
              disabled={!canPolish}
              className={`${ACTION_BUTTON} ${
                canPolish ? "hover:border-success/70 hover:text-success" : ""
              }`}
              title={
                apiKey
                  ? polishing
                    ? t("polish.running")
                    : t("polish.action")
                  : t("polish.needApiKey")
              }
            >
              {polishing ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Sparkles size={12} />
              )}
            </button>
          )}
        </div>
      )}

      {/* 失败原因（不弹窗，就地提示） */}
      {error && (
        <p className="mt-1 truncate text-[0.625rem] text-danger" title={error}>
          {error}
        </p>
      )}
    </div>
  );
}
