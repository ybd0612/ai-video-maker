import { useState, useEffect, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * Lightbox — 点击图片放大展示
 *
 * 包裹任意子元素，点击时弹出全屏遮罩展示原图。
 * 点击遮罩或按 Escape 关闭。
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

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  return (
    <>
      <div
        className="cursor-pointer transition hover:opacity-80"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
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
          >
            <motion.img
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              src={src}
              alt={alt ?? ""}
              className="max-h-[90vh] max-w-[90vw] rounded-lg border border-slate-700 object-contain shadow-2xl"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}