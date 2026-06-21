// ────────────────────────────────────────────────────────────────────────────
// src/features/script/ScriptPanel.tsx
// Input area for the user prompt + "generate" button + loading overlay.
// ────────────────────────────────────────────────────────────────────────────

import { useState, useEffect } from "react";
import { Sparkles, Loader2, Wand2 } from "lucide-react";
import { useT } from "@/i18n";

interface ScriptPanelProps {
  onGenerate: (prompt: string) => void;
  isGenerating: boolean;
  onOpenAiAssist: (currentValue: string) => void;
  promptOverride?: string;
}

export function ScriptPanel({ onGenerate, isGenerating, onOpenAiAssist, promptOverride }: ScriptPanelProps) {
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
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">
          {t("pipeline.scriptPanelTitle")}
        </h2>
        {prompt.trim() && (
          <button
            onClick={() => onOpenAiAssist(prompt)}
            className="rounded p-1 text-slate-600 transition hover:bg-slate-700 hover:text-emerald-400"
            title={t("aiAssist.optimizeMainPrompt")}
          >
            <Wand2 size={13} />
          </button>
        )}
      </div>
      <p className="text-xs text-slate-500">
        {t("pipeline.scriptPanelHint")}
      </p>
      <div className="relative">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t("pipeline.scriptPlaceholder")}
          rows={6}
          disabled={isGenerating}
          className="w-full resize-none rounded-lg border border-slate-700 bg-slate-800 p-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
        />
        {/* Loading overlay */}
        {isGenerating && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-lg bg-slate-900/80 backdrop-blur-sm">
            <Loader2 size={24} className="animate-spin text-emerald-400" />
            <div className="flex flex-col items-center gap-1.5">
              <span className="text-sm font-medium text-emerald-300">
                {t("pipeline.genCallingModel")}
              </span>
              <span className="text-xs text-slate-500">
                {t("pipeline.generating")}
              </span>
            </div>
          </div>
        )}
      </div>
      <button
        onClick={handleSubmit}
        disabled={!prompt.trim() || isGenerating}
        className="flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
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
