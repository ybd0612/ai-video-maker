// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/ExpandableSection.tsx
// 折叠三档的唯一实现（2026-09-24 双栏改造：从死代码改为详情区提示词块的默认档）。
// 档 2 = 折叠到 3 行（line-clamp-3，与 lib/collapse 的 COLLAPSED_LINES 同值）；
// 档 3 = 展开全文。展开态是组件本地 state：详情页切镜时靠父级 key 重挂载复位，
// 因此不提供 defaultExpanded —— 默认一律折叠，行为可预测。
// 标题行整行可点（与本项目「进入编辑 = 点整张卡」同一交互约定）。
// ────────────────────────────────────────────────────────────────────────────

import { useState, type ReactNode } from "react";
import { useT } from "@/i18n";
import { shouldOfferExpand } from "@/lib/collapse";
import { ChevronDown } from "lucide-react";

interface ExpandableSectionProps {
  title: string;
  text: string;
  children?: ReactNode;
}

export function ExpandableSection({ title, text, children }: ExpandableSectionProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const offerExpand = shouldOfferExpand(text);
  if (!text.trim() && !children) return null;

  return (
    <div className="rounded-md border border-line bg-surface/50">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={offerExpand ? expanded : undefined}
        onClick={() => { if (offerExpand) setExpanded((v) => !v); }}
        onKeyDown={(e) => {
          if (!offerExpand) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
        title={offerExpand ? t(expanded ? "section.collapse" : "section.expand") : undefined}
        className={[
          "flex w-full items-center justify-between gap-2 rounded-t-md px-3 py-2 text-left",
          offerExpand ? "cursor-pointer focus:border-accent focus:outline-none" : "cursor-default",
        ].join(" ")}
      >
        <span className="text-xs font-medium text-ink-2">{title}</span>
        {offerExpand && (
          <ChevronDown
            size={14}
            className={`shrink-0 text-ink-4 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
          />
        )}
      </div>

      <div className={`border-t border-line-soft px-3 py-2 text-[0.6875rem] text-ink-3 ${expanded ? "whitespace-pre-wrap" : "line-clamp-3 whitespace-pre-wrap"}`}>
        {text}
        {children}
      </div>
    </div>
  );
}
