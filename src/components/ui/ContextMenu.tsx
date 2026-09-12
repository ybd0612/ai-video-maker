import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface ContextMenuItem {
  label: string;
  icon?: ReactNode;
  color?: string;
  onClick: () => void;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.isComposing) onClose();
    };
    document.addEventListener("pointerdown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("pointerdown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[9999] min-w-[160px] rounded-lg border border-line bg-surface/95 py-1 shadow-xl backdrop-blur-sm"
      style={{ left: x, top: y }}
    >
      {items.map((item, i) => (
        <button
          key={i}
          onClick={() => {
            item.onClick();
            onClose();
          }}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-ink-2 transition hover:bg-hover/60 hover:text-white"
        >
          {item.icon && <span className={item.color ?? "text-ink-4"}>{item.icon}</span>}
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}