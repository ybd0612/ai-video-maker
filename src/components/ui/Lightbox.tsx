import { useState, useEffect, useCallback, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";

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

  const handleOpen = useCallback(() => {
    setScale(1);
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      setScale((s) => {
        const next = e.deltaY < 0 ? s * 1.15 : s / 1.15;
        return Math.min(Math.max(next, 0.2), 10);
      });
    },
    [],
  );

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

      <AnimatePresence>
        {open && src && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            onWheel={handleWheel}
          >
            <motion.img
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: "tween", duration: 0 }}
              src={src}
              alt={alt ?? ""}
              className="max-h-[90vh] max-w-[90vw] rounded-lg border border-slate-700 object-contain shadow-2xl select-none"
              draggable={false}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
