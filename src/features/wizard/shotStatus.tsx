// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/shotStatus.tsx
// 镜头状态 → 图标 + 语义色（列表卡 ShotListSection 与镜头卡 ShotCard 共用）。
// 此前该映射只存在于 ShotCard 内部，分镜列表化后避免两处各写一份。
// ────────────────────────────────────────────────────────────────────────────

import { AlertCircle, Check, ChevronDown, Loader2 } from "lucide-react";

export const SHOT_STATUS_ICONS: Record<string, { icon: typeof Check; color: string }> = {
  idle: { icon: ChevronDown, color: "text-ink-4" },
  scripting: { icon: Loader2, color: "text-info animate-spin" },
  scripted: { icon: Check, color: "text-info" },
  imaging: { icon: Loader2, color: "text-accent animate-spin" },
  imaged: { icon: Check, color: "text-accent" },
  videoing: { icon: Loader2, color: "text-warn animate-spin" },
  videoed: { icon: Check, color: "text-warn" },
  failed: { icon: AlertCircle, color: "text-danger" },
};

/** 取状态图标信息，未登记状态回落到 idle */
export function shotStatusInfo(status: string) {
  return SHOT_STATUS_ICONS[status] ?? SHOT_STATUS_ICONS.idle;
}
