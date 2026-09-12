// ────────────────────────────────────────────────────────────────────────────
// src/features/script/ScriptPanel.tsx
// Input area for the user prompt + "generate" button + loading overlay.
// 主题输入框带框内「润色 / 撤销」（AiPolishField）。
// ────────────────────────────────────────────────────────────────────────────

import { useState, useEffect } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { useT } from "@/i18n";
import { AiPolishField } from "@/components/ui/AiPolishField";
import { SYSTEM_PROMPT_MAIN_PROMPT } from "@/services/chatService";

interface ScriptPanelProps {
  onGenerate: (prompt: string) => void;
  isGenerating: boolean;
  promptOverride?: string;
}

export function ScriptPanel({ onGenerate, isGenerating, promptOverride }: ScriptPanelProps) {
  const [prompt, setPrompt] = useState("");
  const t = useT();

  // Sync external override into local state
  useEffect(() => {
    if (promptOverride !== undefined) {
      setPrompt(promptOverride);
    }
  }, [promptOverride]);

  const handleSubmit = () => {
    const trimmed = prompt.trim();
    if (!trimmed || isGenerating) return;
    onGenerate(trimmed);
  };

  return (
    <div className="flex flex-col gap-3 p-4">
      <h2 className="text-sm font-semibold text-ink">
        {t("pipeline.scriptPanelTitle")}
      </h2>
      <p className="text-xs text-ink-4">
        {t("pipeline.scriptPanelHint")}
      </p>
      <div className="relative">
        <AiPolishField
          value={prompt}
          onChange={setPrompt}
          systemPrompt={SYSTEM_PROMPT_MAIN_PROMPT}
          resetKey={promptOverride}
          placeholder={t("pipeline.scriptPlaceholder")}
          rows={6}
          disabled={isGenerating}
          appearanceClass="rounded-lg border border-line bg-raised text-sm text-ink placeholder:text-ink-5"
        />
        {/* Loading overlay */}
        {isGenerating && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-lg bg-surface/80 backdrop-blur-sm">
            <Loader2 size={24} className="animate-spin text-success" />
            <div className="flex flex-col items-center gap-1.5">
              <span className="text-sm font-medium text-success">
                {t("pipeline.genCallingModel")}
              </span>
              <span className="text-xs text-ink-4">
                {t("pipeline.generating")}
              </span>
            </div>
          </div>
        )}
      </div>
      <button
        onClick={handleSubmit}
        disabled={!prompt.trim() || isGenerating}
        className="flex items-center justify-center gap-2 rounded-lg bg-success-solid px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-success-solid disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isGenerating ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            {t("pipeline.generating")}
          </>
        ) : (
          <>
            <Sparkles size={14} />
            {t("pipeline.generateScript")}
          </>
        )}
      </button>
    </div>
  );
}
