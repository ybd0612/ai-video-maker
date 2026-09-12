// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/PromptField.tsx
// Reusable prompt text field with an inline AI polish / undo action.
// ────────────────────────────────────────────────────────────────────────────

import { AiPolishField } from "@/components/ui/AiPolishField";

interface PromptFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** 润色所用的专家系统提示词；提供后输入框内显示「润色」按钮 */
  systemPrompt?: string;
  placeholder?: string;
  rows?: number;
  /** Color accent: "violet" for visual, "amber" for motion, "red" for negative */
  color?: "violet" | "amber" | "red" | "sky";
  /** 值变化时清空撤销栈（如切换镜头） */
  resetKey?: string;
}

const FOCUS_COLORS = {
  violet: "focus:border-accent",
  amber: "focus:border-warn",
  red: "focus:border-danger",
  sky: "focus:border-info",
};

export function PromptField({
  label,
  value,
  onChange,
  systemPrompt,
  placeholder,
  rows = 2,
  color = "violet",
  resetKey,
}: PromptFieldProps) {
  return (
    <div className="space-y-1">
      <label className="text-[0.6875rem] font-medium text-ink-4">
        {label}
      </label>
      <AiPolishField
        value={value}
        onChange={onChange}
        systemPrompt={systemPrompt}
        placeholder={placeholder}
        rows={rows}
        focusClass={FOCUS_COLORS[color]}
        resetKey={resetKey}
      />
    </div>
  );
}
