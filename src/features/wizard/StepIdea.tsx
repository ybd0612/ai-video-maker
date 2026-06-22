// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/StepIdea.tsx
// Step 1: Input topic/idea, select aspect ratio, generate storyboard.
// AI refine is integrated into the textarea — one ✨ button to refine.
// ────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import { useProjectStore, selectActiveProject } from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useT } from "@/i18n";
import { Sparkles, Loader2, Monitor, Smartphone, Square, Wand2 } from "lucide-react";
import { useWizardActions } from "./useWizardActions";
import { chatCompletion } from "@/services/chatService";

interface StepIdeaProps {
  onGenerated?: () => void;
}

export function StepIdea({ onGenerated }: StepIdeaProps) {
  const t = useT();
  const project = useProjectStore(selectActiveProject);
  const updateProject = useProjectStore((s) => s.updateProject);
  const providerConfig = useSettingsStore((s) => s.providerConfig);
  const { generateAndAdvance } = useWizardActions();
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const aspectRatio = project?.aspectRatio ?? "16:9";

  /** Ask AI to refine the current idea, replace textarea content */
  const handleRefine = async () => {
    if (!prompt.trim() || isRefining || !providerConfig.apiKey) return;
    setIsRefining(true);
    try {
      const systemPrompt = `你是一位专业的短视频创意策划师。用户给你一段初步的视频想法，请帮助完善和细化。

要求：
- 帮助用户明确视频主题、情感基调、视觉风格
- 补充具体的场景建议和叙事方向
- 建议要具体、有画面感、可操作
- 直接返回完善后的想法文本，不要加任何解释说明或前缀
- 保持用户原始意图，只做补充和润色
- 回复不超过 200 字`;

      const result = await chatCompletion({
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
      });

      setPrompt(result.content);
    } catch {
      // Silently fail — user can retry
    } finally {
      setIsRefining(false);
    }
  };

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

      {/* Prompt input with integrated AI refine */}
      <div className="relative">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("wizard.ideaPlaceholder")}
          rows={5}
          disabled={isGenerating || isRefining}
          className="w-full resize-none rounded-xl border border-slate-700 bg-slate-800 p-4 pr-12 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
        />

        {/* AI refine button — inside textarea, top-right */}
        <button
          onClick={handleRefine}
          disabled={!prompt.trim() || isRefining || isGenerating || !providerConfig.apiKey}
          className="absolute right-3 top-3 flex items-center gap-1 rounded-lg bg-slate-700/80 px-2 py-1 text-[11px] text-emerald-400 transition hover:bg-emerald-900/50 hover:text-emerald-300 disabled:opacity-30 disabled:cursor-not-allowed backdrop-blur-sm"
          title={t("wizard.chatWithAi") || "AI 完善想法"}
        >
          {isRefining ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Wand2 size={12} />
          )}
          {isRefining ? (t("wizard.aiThinking") || "完善中...") : (t("wizard.chatWithAi") || "AI 完善")}
        </button>

        {/* Generating overlay */}
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
