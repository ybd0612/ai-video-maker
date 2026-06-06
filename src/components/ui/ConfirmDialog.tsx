import { useCallback, useState, useRef, useEffect, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useT } from "@/i18n";

/* ── Types ──────────────────────────────────────────────────────────────── */

interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "default";
}

type ResolveFn = (result: boolean) => void;

/* ── Singleton state ────────────────────────────────────────────────────── */

let showConfirmGlobal: ((opts: ConfirmOptions) => Promise<boolean>) | null = null;

/**
 * Call from anywhere in the app to show a styled confirm dialog.
 * Returns `true` if user confirmed, `false` if cancelled.
 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  if (!showConfirmGlobal) return Promise.resolve(false);
  return showConfirmGlobal(options);
}

/* ── Provider component — mount once at the app root ────────────────────── */

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<ResolveFn | null>(null);

  const showConfirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setOptions(opts);
    });
  }, []);

  useEffect(() => {
    showConfirmGlobal = showConfirm;
    return () => { showConfirmGlobal = null; };
  }, [showConfirm]);

  const handleClose = useCallback((result: boolean) => {
    resolveRef.current?.(result);
    resolveRef.current = null;
    setOptions(null);
  }, []);

  /* Close on Escape */
  useEffect(() => {
    if (!options) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [options, handleClose]);

  const variant = options?.variant ?? "default";
  const isDanger = variant === "danger";

  return (
    <>
      {children}

      <AnimatePresence>
        {options && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => handleClose(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="mb-2 text-sm font-bold text-slate-100">{options.title}</h3>
              <div className="mb-5 text-xs leading-relaxed text-slate-400">
                {options.message}
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => handleClose(false)}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-1.5 text-[11px] font-medium text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
                >
                  {options.cancelLabel ?? t("dialog.cancel")}
                </button>
                <button
                  onClick={() => handleClose(true)}
                  autoFocus
                  className={`rounded-lg px-3.5 py-1.5 text-[11px] font-semibold text-white transition ${
                    isDanger
                      ? "bg-red-600 hover:bg-red-500"
                      : "bg-emerald-600 hover:bg-emerald-500"
                  }`}
                >
                  {options.confirmLabel ?? t("dialog.confirm")}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}