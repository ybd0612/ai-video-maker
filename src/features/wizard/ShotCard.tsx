// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/ShotCard.tsx
// Generic shot card for wizard steps. Shows summary + expandable detail.
// ────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import type { Shot } from "@/stores/projectStore";
import type { AspectRatio } from "@/stores/projectTypes";
import { ASPECT_RATIO_CSS, resolveAspect } from "@/lib/mediaLayout";
import { useT } from "@/i18n";
import { ChevronDown, RefreshCw, Trash2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Lightbox } from "@/components/ui/Lightbox";
import { shotStatusInfo } from "./shotStatus";
import { WizardMessages } from "./WizardMessages";

type ShotCardMode = "storyboard" | "image" | "video";

interface ShotCardProps {
  shot: Shot;
  mode: ShotCardMode;
  /** 项目画幅：决定卡头缩略图的宽高比，缺省回落 16:9 */
  aspect?: AspectRatio;
  onReroll?: () => void;
  onDelete?: () => void;
  isGenerating?: boolean;
  children?: React.ReactNode;
}

export function ShotCard({
  shot,
  mode,
  aspect,
  onReroll,
  onDelete,
  isGenerating,
  children,
}: ShotCardProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const statusInfo = shotStatusInfo(shot.status);
  const StatusIcon = statusInfo.icon;

  // Summary text based on mode
  const summary = (() => {
    switch (mode) {
      case "storyboard":
        return shot.scriptText.slice(0, 60) || t("wizard.promptSubject");
      case "image":
        return shot.scriptText.slice(0, 50) || shot.visualPrompt.slice(0, 40);
      case "video":
        return shot.scriptText.slice(0, 50) || shot.motionPrompt.slice(0, 40);
    }
  })();

  return (
    <div className="flex flex-col rounded-lg border border-line bg-surface/50 overflow-hidden transition hover:border-line-strong">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 px-3 py-2 text-left"
      >
        {/* Shot number */}
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-raised text-[0.625rem] font-bold text-ink-3">
          {shot.index + 1}
        </span>

        {/* Status icon */}
        <StatusIcon size={12} className={`shrink-0 ${statusInfo.color}`} />

        {/* Summary */}
        <span className="flex-1 truncate text-[0.6875rem] text-ink-3">
          {summary}
        </span>

        {/* Image thumbnail for image/video modes（点击放大查看） */}
        {(mode === "image" || mode === "video") && shot.imageUrl && (
          <div className={`h-8 shrink-0 overflow-hidden rounded-sm border border-line-soft ${ASPECT_RATIO_CSS[resolveAspect(aspect)]}`}>
            <Lightbox src={shot.imageUrl} alt={`Shot ${shot.index + 1}`}>
              <img
                src={shot.imageUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            </Lightbox>
          </div>
        )}

        {/* Progress for videoing */}
        {shot.status === "videoing" && (shot.videoProgress ?? 0) > 0 && (
          <span className="text-[0.625rem] text-warn">
            {shot.videoProgress}%
          </span>
        )}

        {/* Expand indicator */}
        <motion.div
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: 0.15 }}
        >
          <ChevronDown size={12} className="text-ink-5" />
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
            <div className="border-t border-line/30 px-3 py-2 space-y-2">
              {children}

              {/* 失败原因（分镜/图片/视频生成失败均可显示） */}
              <WizardMessages error={shot.error} />

              {/* Action buttons */}
              <div className="flex items-center gap-2 pt-1">
                {onReroll && (
                  <button
                    onClick={onReroll}
                    disabled={isGenerating}
                    className="flex items-center gap-1 rounded px-2 py-1 text-[0.625rem] text-success hover:bg-success-deep/30 transition disabled:opacity-50"
                  >
                    <RefreshCw size={10} className={isGenerating ? "animate-spin" : ""} />
                    {t("wizard.reroll")}
                  </button>
                )}
                {onDelete && (
                  <button
                    onClick={onDelete}
                    className="flex items-center gap-1 rounded px-2 py-1 text-[0.625rem] text-danger hover:bg-danger-deep/30 transition"
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
