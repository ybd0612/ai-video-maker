import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";

/**
 * Lightbox — 点击图片放大展示
 *
 * 包裹任意子元素，点击时弹出全屏遮罩展示原图。
 * 图片自适应屏幕，支持滚轮缩放，点击遮罩关闭。
 */
export function Lightbox({
  src,
  alt,
  children,
}: {
  src: string | undefined;
  alt?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [scale, setScale] = useState(1);
  const overlayRef = useRef<HTMLDivElement>(null);

  const handleOpen = useCallback(() => {
    setScale(1);
    setOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, handleClose]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setScale((s) => {
      const next = e.deltaY < 0 ? s * 1.15 : s / 1.15;
      return Math.min(Math.max(next, 0.1), 10);
    });
  }, []);

  return (
    <>
      <div
        className="cursor-pointer transition hover:opacity-80"
        onClick={(e) => {
          e.stopPropagation();
          handleOpen();
        }}
      >
        {children}
      </div>

      {open && src && (
        <div
          ref={overlayRef}
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.8)", backdropFilter: "blur(4px)" }}
          onClick={handleClose}
          onWheel={handleWheel}
        >
          <img
            src={src}
            alt={alt ?? ""}
            style={{ transform: `scale(${scale})`, transition: "transform 0.05s ease-out" }}
            className="max-h-[90vh] max-w-[90vw] rounded-lg border border-slate-700 object-contain shadow-2xl select-none"
            draggable={false}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}