import { useState, useEffect, useCallback, type ReactNode } from "react";

/**
 * Lightbox — 点击图片放大展示
 *
 * 包裹任意子元素，点击时弹出全屏遮罩展示原图。
 * 图片自适应屏幕，支持滚轮缩放，点击遮罩或图片均可关闭。
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

  const handleOpen = useCallback(() => {
    setScale(1);
    setOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
    setScale(1);
  }, []);

  // Escape key to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, handleClose]);

  // Prevent page scroll when lightbox is open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

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
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={handleClose}
          onWheel={handleWheel}
        >
          <img
            src={src}
            alt={alt ?? ""}
            style={{ transform: `scale(${scale})`, transition: "transform 0.05s ease-out" }}
            className="max-h-[90vh] max-w-[90vw] object-contain select-none"
            draggable={false}
          />
        </div>
      )}
    </>
  );
}