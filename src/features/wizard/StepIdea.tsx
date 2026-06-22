// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/StepIdea.tsx
// Step 1: Input topic/idea, select aspect ratio, generate storyboard.
// ────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import { useProjectStore, selectActiveProject } from "@/stores/projectStore";
import { useT } from "@/i18n";
import { Sparkles, Loader2, Monitor, Smartphone, Square } from "lucide-react";
import { useWizardActions } from "./useWizardActions";

interface StepIdeaProps {
  onGenerated?: () => void;
}

export function StepIdea({ onGenerated }: StepIdeaProps) {
  const t = useT();
  const project = useProjectStore(selectActiveProject);
  const updateProject = useProjectStore((s) => s.updateProject);
  const { generateAndAdvance } = useWizardActions();
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const aspectRatio = project?.aspectRatio ?? "16:9";

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setIsGenerating(true);
    setError(null);
    try {
      await generateAndAdvance(prompt.trim());
      onGenerated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !isGenerating && prompt.trim()) {
      e.preventDefault();
      handleGenerate();
    }
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 py-8">
      {/* Title */}
      <div className="text-center">
        <h2 className="text-lg font-bold text-slate-100">
          {t("wizard.enterIdea")}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {t("wizard.ideaPlaceholder")}
        </p>
      </div>

      {/* Prompt input */}
      <div className="relative">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("wizard.ideaPlaceholder")}
          rows={5}
          disabled={isGenerating}
          className="w-full resize-none rounded-xl border border-slate-700 bg-slate-800 p-4 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
        />
        {isGenerating && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-slate-900/80 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-2">
              <Loader2 size={24} className="animate-spin text-emerald-400" />
              <span className="text-sm text-emerald-300">{t("wizard.generating")}</span>
            </div>
          </div>
        )}
      </div>

      {/* Aspect ratio selector */}
      <div className="flex items-center justify-center gap-3">
        {([
          { value: "16:9", icon: Monitor, label: "16:9" },
          { value: "9:16", icon: Smartphone, label: "9:16" },
          { value: "1:1", icon: Square, label: "1:1" },
        ] as const).map(({ value, icon: Icon, label }) => (
          <button
            key={value}
            onClick={() => updateProject({ aspectRatio: value })}
            className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm transition ${
              aspectRatio === value
                ? "border-emerald-500 bg-emerald-950/30 text-emerald-400"
                : "border-slate-700 bg-slate-800 text-slate-400 hover:border-slate-600"
            }`}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

      {/* Generate button */}
      <button
        onClick={handleGenerate}
        disabled={!prompt.trim() || isGenerating}
        className="mx-auto flex items-center gap-2 rounded-xl bg-emerald-600 px-8 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isGenerating ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <Sparkles size={16} />
        )}
        {t("wizard.generate")}
      </button>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/30 p-3 text-sm text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}
