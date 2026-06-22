// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/ShotCard.tsx
// Generic shot card for wizard steps. Shows summary + expandable detail.
// ────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import type { Shot } from "@/stores/projectStore";
import { useT } from "@/i18n";
import { ChevronDown, RefreshCw, Trash2, Loader2, Check, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

type ShotCardMode = "storyboard" | "image" | "video";

interface ShotCardProps {
  shot: Shot;
  mode: ShotCardMode;
  onReroll?: () => void;
  onDelete?: () => void;
  isGenerating?: boolean;
  children?: React.ReactNode;
}

const STATUS_ICONS: Record<string, { icon: typeof Check; color: string }> = {
  idle: { icon: ChevronDown, color: "text-slate-500" },
  scripting: { icon: Loader2, color: "text-sky-400 animate-spin" },
  scripted: { icon: Check, color: "text-sky-400" },
  imaging: { icon: Loader2, color: "text-violet-400 animate-spin" },
  imaged: { icon: Check, color: "text-violet-400" },
  videoing: { icon: Loader2, color: "text-amber-400 animate-spin" },
  videoed: { icon: Check, color: "text-amber-400" },
  failed: { icon: AlertCircle, color: "text-red-400" },
};

export function ShotCard({
  shot,
  mode,
  onReroll,
  onDelete,
  isGenerating,
  children,
}: ShotCardProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const statusInfo = STATUS_ICONS[shot.status] ?? STATUS_ICONS.idle;
  const StatusIcon = statusInfo.icon;

  // Summary text based on mode
  const summary = (() => {
    switch (mode) {
      case "storyboard":
        return shot.scriptText.slice(0, 60) || t("wizard.promptSubject");
      case "image":
        return shot.imageUrl ? "✅" : shot.visualPrompt.slice(0, 40);
      case "video":
        return shot.videoUrl ? "✅" : shot.motionPrompt.slice(0, 40);
    }
  })();

  return (
    <div className="flex flex-col rounded-lg border border-slate-700 bg-slate-900/50 overflow-hidden transition hover:border-slate-600">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 px-3 py-2 text-left"
      >
        {/* Shot number */}
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[10px] font-bold text-slate-400">
          {shot.index + 1}
        </span>

        {/* Status icon */}
        <StatusIcon size={12} className={`shrink-0 ${statusInfo.color}`} />

        {/* Summary */}
        <span className="flex-1 truncate text-[11px] text-slate-400">
          {summary}
        </span>

        {/* Image thumbnail for image/video modes */}
        {(mode === "image" || mode === "video") && shot.imageUrl && (
          <div className="h-8 w-8 shrink-0 overflow-hidden rounded border border-slate-700">
            <img
              src={shot.imageUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          </div>
        )}

        {/* Progress for videoing */}
        {shot.status === "videoing" && (shot.videoProgress ?? 0) > 0 && (
          <span className="text-[10px] text-amber-400">
            {shot.videoProgress}%
          </span>
        )}

        {/* Expand indicator */}
        <motion.div
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: 0.15 }}
        >
          <ChevronDown size={12} className="text-slate-600" />
        </motion.div>
      </button>

      {/* Expandable detail */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="border-t border-slate-700/30 px-3 py-2 space-y-2">
              {children}

              {/* Action buttons */}
              <div className="flex items-center gap-2 pt-1">
                {onReroll && (
                  <button
                    onClick={onReroll}
                    disabled={isGenerating}
                    className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-emerald-400 hover:bg-emerald-950/30 transition disabled:opacity-50"
                  >
                    <RefreshCw size={10} className={isGenerating ? "animate-spin" : ""} />
                    {t("wizard.reroll")}
                  </button>
                )}
                {onDelete && (
                  <button
                    onClick={onDelete}
                    className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-red-400 hover:bg-red-950/30 transition"
                  >
                    <Trash2 size={10} />
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
