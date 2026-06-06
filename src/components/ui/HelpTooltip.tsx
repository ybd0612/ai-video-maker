import { useState, useRef, useEffect, type ReactNode } from "react";
import { HelpCircle } from "lucide-react";

/**
 * HelpTooltip — 问号图标 + 悬浮提示
 *
 * 在标签旁边显示一个问号图标，鼠标悬浮时弹出详细说明。
 */
export function HelpTooltip({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<number | null>(null);

  const show = () => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    setVisible(true);
  };

  const hide = () => {
    timerRef.current = window.setTimeout(() => setVisible(false), 100);
  };

  useEffect(() => {
    return () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <span
      className="relative inline-flex items-center"
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      <HelpCircle
        size={12}
        className="cursor-help text-slate-600 transition hover:text-slate-400"
      />
      {visible && (
        <span
          className="absolute bottom-full left-1/2 z-[90] mb-1.5 w-52 -translate-x-1/2 rounded-lg border border-slate-600 bg-slate-800 px-2.5 py-2 text-[11px] leading-relaxed text-slate-300 shadow-xl"
          style={{ pointerEvents: "none" }}
        >
          {children}
          <span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-slate-600" />
        </span>
      )}
    </span>
  );
}