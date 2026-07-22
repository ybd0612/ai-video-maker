// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/StepIdea.tsx
// Step 1: Multi-turn AI brainstorm + aspect ratio + extract characters.
// ────────────────────────────────────────────────────────────────────────────

import { useState, useRef, useEffect } from "react";
import { useProjectStore, selectActiveProject } from "@/stores/projectStore";
import type { ChatTurn } from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useT } from "@/i18n";
import {
  Sparkles, Loader2, Monitor, Smartphone, Square, Send, Bot, User,
  History,
} from "lucide-react";
import { useWizardActions } from "./useWizardActions";
import { chatCompletion } from "@/services/chatService";

const IDEA_SYSTEM_PROMPT = `你是一位专业的短视频创意策划师。用户正在构思一个短视频的主题和想法，你需要帮助用户逐步完善。

核心规则：
- 每次回复必须是一段完整的视频想法/描述，包含之前所有的修改和补充
- 不要只回复增量改动，而是输出当前最新的完整版本
- 用户可以直接复制你的回复作为最终想法

内容要求：
- 帮助用户明确视频主题、情感基调、视觉风格
- 提供具体的场景建议和叙事方向
- 建议要具体、有画面感、可操作
- 每次回复不超过 200 字
- 如果用户的想法已经足够好，告诉他们可以点击"下一步"进入资产准备
- 如果用户提出修改意见，在完整版本中体现修改`;

interface StepIdeaProps {
  onGenerated?: () => void;
}

export function StepIdea({ onGenerated }: StepIdeaProps) {
  const t = useT();
  const project = useProjectStore(selectActiveProject);
  const createProject = useProjectStore((s) => s.createProject);
  const updateProject = useProjectStore((s) => s.updateProject);
  const providerConfig = useSettingsStore((s) => s.providerConfig);
  const { extractCharactersFromIdea } = useWizardActions();
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize from project store, fallback to empty
  const [prompt, setPrompt] = useState(project?.ideaPrompt ?? "");
  const [chatHistory, setChatHistory] = useState<ChatTurn[]>(project?.ideaChatHistory ?? []);
  const [chatInput, setChatInput] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);

  const aspectRatio = project?.aspectRatio ?? "16:9";

  // Reset local state when active project changes (e.g., creating/switching projects)
  // 重置加载/错误状态，避免上个项目的生成中状态卡住新项目的输入框
  const prevProjectIdRef = useRef(project?.id);
  useEffect(() => {
    if (project?.id !== prevProjectIdRef.current) {
      prevProjectIdRef.current = project?.id;
      setPrompt(project?.ideaPrompt ?? "");
      setChatHistory(project?.ideaChatHistory ?? []);
      setChatInput("");
      setShowHistory(false);
      setIsGenerating(false);
      setIsRefining(false);
      setError(null);
    }
  }, [project?.id, project?.ideaPrompt, project?.ideaChatHistory]);

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

  // Persist chatHistory to store immediately on change
  const chatHistoryRef = useRef(chatHistory);
  chatHistoryRef.current = chatHistory;
  useEffect(() => {
    updateProject({ ideaChatHistory: chatHistory.length > 0 ? chatHistory : undefined });
  }, [chatHistory, updateProject]);

  // Sync chatHistory when project changes (e.g., switching projects)
  useEffect(() => {
    const projectHistory = project?.ideaChatHistory ?? [];
    if (JSON.stringify(chatHistoryRef.current) !== JSON.stringify(projectHistory)) {
      setChatHistory(projectHistory);
    }
  }, [project?.ideaChatHistory]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  const systemPrompt = IDEA_SYSTEM_PROMPT;

  /** Send a message in the conversation */
  const handleChatSend = async () => {
    const input = chatInput.trim();
    if (!input || isRefining || !providerConfig.apiKey) return;

    // Include current textarea content so AI knows what to refine
    const contextContent = prompt.trim()
      ? `当前想法：\n${prompt.trim()}\n\n调整要求：${input}`
      : input;

    // Display only the user's adjustment input in chat history
    const displayMsg: ChatTurn = { role: "user", content: input };
    // But send full context to AI
    const apiMsg: ChatTurn = { role: "user", content: contextContent };

    const newHistory = [...chatHistory, displayMsg];
    setChatHistory(newHistory);
    setChatInput("");
    setIsRefining(true);

    try {
      const messages = [
        { role: "system" as const, content: systemPrompt },
        ...chatHistory.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
        { role: "user" as const, content: apiMsg.content },
      ];

      const result = await chatCompletion({
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        messages,
      });

      const assistantMsg: ChatTurn = { role: "assistant", content: result.content };
      setChatHistory((prev) => [...prev, assistantMsg]);
      // Auto-apply: AI always outputs the complete idea
      setPrompt(result.content);
    } catch {
      setChatHistory((prev) => [...prev, { role: "assistant", content: "请求失败，请重试。" }]);
    } finally {
      setIsRefining(false);
      // Auto-focus chat input so user can continue typing
      requestAnimationFrame(() => chatInputRef.current?.focus());
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setIsGenerating(true);
    setError(null);
    let targetId: string | undefined;
    try {
      // Create project if one doesn't exist
      let currentProject = project;
      if (!currentProject) {
        const title = prompt.trim().slice(0, 30) || t("pipeline.newProject");
        currentProject = createProject(title);
        // Update the project with the idea prompt
        updateProject({ ideaPrompt: prompt.trim() });
      }
      targetId = currentProject.id;
      await extractCharactersFromIdea(prompt.trim());
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
    if (e.key === "Enter" && !e.shiftKey && !isGenerating && prompt.trim()) {
      e.preventDefault();
      handleGenerate();
    }
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 py-8">
      {/* Title + history icon */}
      <div className="flex items-center justify-center gap-3">
        <h2 className="text-lg font-bold text-slate-100">
          {t("wizard.enterIdea")}
        </h2>
        {chatHistory.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="text-slate-600 transition hover:text-slate-400"
              title={t("wizard.chatHistory" as any) || "对话历史"}
            >
              <History size={14} />
            </button>
            {showHistory && (
              <>
                {/* Backdrop */}
                <div className="fixed inset-0 z-40" onClick={() => setShowHistory(false)} />
                {/* Popover */}
                <div className="absolute right-0 top-full z-50 mt-2 w-80 max-h-64 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-3 shadow-2xl space-y-2">
                  {chatHistory.map((msg, i) => (
                    <div key={i} className="flex gap-2">
                      <div className={`shrink-0 mt-0.5 ${msg.role === "user" ? "text-emerald-400" : "text-violet-400"}`}>
                        {msg.role === "user" ? <User size={11} /> : <Bot size={11} />}
                      </div>
                      <p className="flex-1 text-[11px] leading-relaxed text-slate-400 whitespace-pre-wrap">
                        {msg.content}
                      </p>
                    </div>
                  ))}
                  {isRefining && (
                    <div className="flex gap-2">
                      <Bot size={11} className="shrink-0 mt-0.5 text-violet-400 animate-pulse" />
                      <Loader2 size={11} className="animate-spin text-emerald-400" />
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Prompt textarea (taller) */}
      <div className="relative">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("wizard.ideaPlaceholder")}
          rows={7}
          disabled={isGenerating || isRefining}
          className="w-full resize-none rounded-xl border border-slate-700 bg-slate-800 p-4 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
        />

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

      {/* Chat input for follow-up conversation */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            ref={chatInputRef}
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleChatSend();
              }
            }}
            placeholder={isRefining ? "" : (t("wizard.chatPlaceholder") || "和 AI 继续讨论...")}
            disabled={isRefining || !providerConfig.apiKey}
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
          />
          {isRefining && (
            <div className="absolute inset-0 flex items-center gap-2 px-3 pointer-events-none">
              <Loader2 size={13} className="animate-spin text-emerald-400" />
              <span className="text-xs text-emerald-400/80 animate-pulse">
                {t("wizard.generating") || "AI 思考中..."}
              </span>
            </div>
          )}
        </div>
        <button
          onClick={handleChatSend}
          disabled={!chatInput.trim() || isRefining || !providerConfig.apiKey}
          className="flex items-center justify-center rounded-lg bg-slate-700 px-3 py-2 text-emerald-400 transition hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <Send size={13} />
        </button>
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
        {t("wizard.extractAndContinue")}
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
