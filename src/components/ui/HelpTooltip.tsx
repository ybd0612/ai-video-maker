import { useState, useRef, useEffect, useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { HelpCircle } from "lucide-react";

/**
 * HelpTooltip — 问号图标 + 悬浮提示
 *
 * 使用 portal 渲染到 body，不受父容器 overflow 和 z-index 限制。
 */
export function HelpTooltip({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<number | null>(null);

  const show = useCallback(() => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({
        top: rect.top - 8,
        left: rect.left + rect.width / 2,
      });
    }
    setVisible(true);
  }, []);

  const hide = useCallback(() => {
    timerRef.current = window.setTimeout(() => setVisible(false), 100);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <span
      ref={triggerRef}
      className="inline-flex items-center"
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      <HelpCircle
        size={12}
        className="cursor-help text-slate-600 transition hover:text-slate-400"
      />
      {visible &&
        createPortal(
          <span
            className="fixed z-[9999] w-52 -translate-x-1/2 -translate-y-full rounded-lg border border-slate-600 bg-slate-800 px-2.5 py-2 text-[11px] leading-relaxed text-slate-300 shadow-xl"
            style={{ top: pos.top, left: pos.left, pointerEvents: "none" }}
          >
            {children}
            <span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-slate-600" />
          </span>,
          document.body,
        )}
    </span>
  );
}