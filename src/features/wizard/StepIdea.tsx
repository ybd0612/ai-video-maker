// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/StepIdea.tsx
// Step 1: 输入视频想法（框内一键润色 / 撤销）+ 画幅比例 + 提取角色与资产。
// ────────────────────────────────────────────────────────────────────────────

import { useState, useRef, useEffect } from "react";
import { useProjectStore, selectActiveProject } from "@/stores/projectStore";
import type { AspectRatio } from "@/stores/projectStore";
import { useT } from "@/i18n";
import { Sparkles, Loader2, Monitor, Smartphone, Square } from "lucide-react";
import { useWizardActions } from "./useWizardActions";
import { AiPolishField } from "@/components/ui/AiPolishField";
import { buildIdeaPolishPrompt } from "@/lib/promptRules";

interface StepIdeaProps {
  onGenerated?: () => void;
}

export function StepIdea({ onGenerated }: StepIdeaProps) {
  const t = useT();
  const project = useProjectStore(selectActiveProject);
  const createProject = useProjectStore((s) => s.createProject);
  const updateProject = useProjectStore((s) => s.updateProject);
  const { extractCharactersFromIdea } = useWizardActions();
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 提取进行中的权威信号在 store（scripting 覆盖视觉方向链 + 资产链全程）：
  // 本地 isGenerating 会随切页卸载丢失，返回本页时若只看本地态，按钮又可点击 → 并发跑第二轮提取。
  const generating = isGenerating || project?.status === "scripting";

  // Initialize from project store, fallback to empty
  const [prompt, setPrompt] = useState(project?.ideaPrompt ?? "");
  const [selectedAspectRatio, setSelectedAspectRatio] = useState<AspectRatio>(
    project?.aspectRatio ?? "16:9",
  );

  const aspectRatio = project?.aspectRatio ?? selectedAspectRatio;

  // Reset local state when active project changes (e.g., creating/switching projects)
  // 重置加载/错误状态，避免上个项目的生成中状态卡住新项目的输入框
  const prevProjectIdRef = useRef(project?.id);
  useEffect(() => {
    if (project?.id !== prevProjectIdRef.current) {
      prevProjectIdRef.current = project?.id;
      setPrompt(project?.ideaPrompt ?? "");
      setSelectedAspectRatio(project?.aspectRatio ?? "16:9");
      setIsGenerating(false);
      setError(null);
    }
  }, [project?.id, project?.ideaPrompt, project?.aspectRatio]);

  // Persist prompt to store (debounced via useEffect)
  const promptRef = useRef(prompt);
  promptRef.current = prompt;
  useEffect(() => {
    const timer = setTimeout(() => {
      if (promptRef.current !== (project?.ideaPrompt ?? "")) {
        updateProject({ ideaPrompt: promptRef.current });
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [prompt, project?.ideaPrompt, updateProject]);

  // Sync prompt when project changes (e.g., switching projects)
  useEffect(() => {
    if (project?.ideaPrompt !== undefined && project.ideaPrompt !== promptRef.current) {
      setPrompt(project.ideaPrompt);
    }
  }, [project?.ideaPrompt]);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setIsGenerating(true);
    setError(null);
    let targetId: string | undefined;
    try {
      // Create project if one doesn't exist. Preserve the aspect ratio selected
      // before creation; updateProject() cannot write without an active project.
      let currentProject = project;
      if (!currentProject) {
        const title = prompt.trim().slice(0, 30) || t("pipeline.newProject");
        currentProject = createProject(title);
        updateProject({
          ideaPrompt: prompt.trim(),
          aspectRatio: selectedAspectRatio,
        });
      }
      targetId = currentProject.id;
      const done = await extractCharactersFromIdea(prompt.trim());
      if (!done) return; // 用户在确认弹窗中取消了重新提取，停留在想法步骤
      onGenerated?.();
    } catch (err) {
      // 仅当仍停留在发起项目时才展示错误，避免旧项目的错误污染已切换到的新项目
      if (useProjectStore.getState().activeProjectId === targetId) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      // 同理：只有仍在发起项目上才复位加载态，避免覆盖新项目自己的生成状态
      if (useProjectStore.getState().activeProjectId === targetId) {
        setIsGenerating(false);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !generating && prompt.trim()) {
      e.preventDefault();
      handleGenerate();
    }
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 py-8">
      {/* Title */}
      <div className="flex items-center justify-center gap-3">
        <h2 className="text-lg font-bold text-ink">
          {t("wizard.enterIdea")}
        </h2>
      </div>

      {/* Prompt textarea（框内右下角：润色 / 撤销） */}
      <div className="relative">
        <AiPolishField
          value={prompt}
          onChange={setPrompt}
          systemPrompt={buildIdeaPolishPrompt()}
          resetKey={project?.id}
          onKeyDown={handleKeyDown}
          placeholder={t("wizard.ideaPlaceholder")}
          rows={7}
          disabled={generating}
          appearanceClass="rounded-xl border border-line bg-raised text-sm text-ink placeholder:text-ink-5"
        />

        {/* Generating overlay */}
        {generating && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-surface/80 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-6 w-6 animate-spin text-success" />
              <span className="text-sm text-success">{t("wizard.generating")}</span>
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
            onClick={() => {
              setSelectedAspectRatio(value);
              if (project) updateProject({ aspectRatio: value });
            }}
            className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm transition ${
              aspectRatio === value
                ? "border-success bg-success-deep/30 text-success"
                : "border-line bg-raised text-ink-3 hover:border-line-strong"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Generate button */}
      <button
        onClick={handleGenerate}
        disabled={!prompt.trim() || generating}
        className="mx-auto flex items-center gap-2 rounded-xl bg-success-solid px-8 py-3 text-sm font-semibold text-white transition hover:bg-success-solid disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {generating ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Sparkles className="h-4 w-4" />
        )}
        {t("wizard.extractAndContinue")}
      </button>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-danger bg-danger-deep/30 p-3 text-sm text-danger">
          {error}
        </div>
      )}
    </div>
  );
}
