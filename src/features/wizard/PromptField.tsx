// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/PromptField.tsx
// Reusable prompt text field with optional AI assist button.
// ────────────────────────────────────────────────────────────────────────────

import { Sparkles } from "lucide-react";

interface PromptFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onAiAssist?: () => void;
  placeholder?: string;
  rows?: number;
  /** Color accent: "violet" for visual, "amber" for motion, "red" for negative */
  color?: "violet" | "amber" | "red" | "sky";
}

const FOCUS_COLORS = {
  violet: "focus:border-violet-500",
  amber: "focus:border-amber-500",
  red: "focus:border-red-500",
  sky: "focus:border-sky-500",
};

export function PromptField({
  label,
  value,
  onChange,
  onAiAssist,
  placeholder,
  rows = 2,
  color = "violet",
}: PromptFieldProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-medium text-slate-500">
          {label}
        </label>
        {onAiAssist && (
          <button
            onClick={onAiAssist}
            className="rounded p-0.5 text-slate-600 transition hover:bg-slate-700 hover:text-emerald-400"
            title="AI 优化"
          >
            <Sparkles size={11} />
          </button>
        )}
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className={`w-full resize-none rounded-md border border-slate-700 bg-slate-800 p-2 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none ${FOCUS_COLORS[color]}`}
      />
    </div>
  );
}
