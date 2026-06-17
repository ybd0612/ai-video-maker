// ────────────────────────────────────────────────────────────────────────────
// src/features/script/ScriptPanel.tsx
// Input area for the user prompt + "generate script" button.
// ────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { useT } from "@/i18n";

interface ScriptPanelProps {
  onGenerate: (prompt: string) => void;
  isGenerating: boolean;
}

export function ScriptPanel({ onGenerate, isGenerating }: ScriptPanelProps) {
  const [prompt, setPrompt] = useState("");
  const t = useT();

  const handleSubmit = () => {
    const trimmed = prompt.trim();
    if (!trimmed || isGenerating) return;
    onGenerate(trimmed);
  };

  return (
    <div className="flex flex-col gap-3 p-4">
      <h2 className="text-sm font-semibold text-slate-200">
        {t("pipeline.scriptPanelTitle")}
      </h2>
      <p className="text-xs text-slate-500">
        {t("pipeline.scriptPanelHint")}
      </p>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={t("pipeline.scriptPlaceholder")}
        rows={6}
        className="w-full resize-none rounded-lg border border-slate-700 bg-slate-800 p-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
      />
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
