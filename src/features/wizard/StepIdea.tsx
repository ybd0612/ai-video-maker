// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/StepIdea.tsx
// Step 1: Input topic/idea, select aspect ratio, generate storyboard.
// ────────────────────────────────────────────────────────────────────────────

import { useState, useCallback, useRef, useEffect } from "react";
import { useProjectStore, selectActiveProject } from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useT } from "@/i18n";
import { Sparkles, Loader2, Monitor, Smartphone, Square, MessageCircle, Send, ArrowDown } from "lucide-react";
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
  const [error, setError] = useState<string | null>(null);

  // AI brainstorm chat state
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [chatInput, setChatInput] = useState("");
  const [isChatting, setIsChatting] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const aspectRatio = project?.aspectRatio ?? "16:9";

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const handleChatSend = useCallback(async () => {
    const input = chatInput.trim();
    if (!input || isChatting || !providerConfig.apiKey) return;

    const userMsg = { role: "user" as const, content: input };
    setChatMessages((prev) => [...prev, userMsg]);
    setChatInput("");
    setIsChatting(true);

    try {
      const systemPrompt = `你是一位专业的短视频创意策划师。用户正在构思一个短视频的主题和想法，你需要帮助用户完善和细化他们的想法。

要求：
- 帮助用户明确视频主题、情感基调、视觉风格
- 提供具体的场景建议和叙事方向
- 建议要具体、有画面感、可操作
- 每次回复简洁有力，不超过 100 字
- 如果用户的想法已经足够好，可以建议他们直接点击"生成分镜"
- 如果用户提供了初步想法，帮助他们补充细节和情感

当前用户的初步想法：${prompt || "（尚未输入）"}`;

      const messages = [
        { role: "system" as const, content: systemPrompt },
        ...chatMessages,
        userMsg,
      ];

      const result = await chatCompletion({
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        messages,
      });

      setChatMessages((prev) => [
        ...prev,
        { role: "assistant" as const, content: result.content },
      ]);
    } catch {
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant" as const, content: "抱歉，请求失败，请重试。" },
      ]);
    } finally {
      setIsChatting(false);
    }
  }, [chatInput, isChatting, chatMessages, prompt, providerConfig]);

  const handleApplySuggestion = (content: string) => {
    // Extract the suggestion and append to prompt
    setPrompt((prev) => (prev ? `${prev}\n${content}` : content));
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

      {/* AI Brainstorm Chat */}
      <div className="rounded-xl border border-slate-700 bg-slate-900/50 overflow-hidden">
        <button
          onClick={() => setShowChat(!showChat)}
          className="flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-slate-800/50"
        >
          <div className="flex items-center gap-2">
            <MessageCircle size={14} className="text-emerald-400" />
            <span className="text-sm font-medium text-slate-300">
              {t("wizard.chatWithAi" as any) || "和 AI 聊天完善想法"}
            </span>
          </div>
          <ArrowDown
            size={14}
            className={`text-slate-500 transition-transform ${showChat ? "rotate-180" : ""}`}
          />
        </button>

        {showChat && (
          <div className="border-t border-slate-700/50">
            {/* Chat messages */}
            <div className="max-h-60 overflow-y-auto px-4 py-3 space-y-3">
              {chatMessages.length === 0 && (
                <p className="text-center text-xs text-slate-600 py-4">
                  {t("wizard.chatHint" as any) || "告诉 AI 你的想法，让它帮你完善"}
                </p>
              )}
              {chatMessages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
                      msg.role === "user"
                        ? "bg-emerald-900/40 text-emerald-200"
                        : "bg-slate-800 text-slate-300"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                    {msg.role === "assistant" && (
                      <button
                        onClick={() => handleApplySuggestion(msg.content)}
                        className="mt-1.5 flex items-center gap-1 text-[10px] text-emerald-400 hover:text-emerald-300 transition"
                      >
                        <Sparkles size={9} />
                        {t("wizard.applyIdea" as any) || "应用到想法"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {isChatting && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-xs text-slate-400">
                    <Loader2 size={11} className="animate-spin text-emerald-400" />
                    {t("wizard.aiThinking" as any) || "AI 思考中..."}
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Chat input */}
            <div className="flex gap-2 border-t border-slate-700/50 px-4 py-3">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleChatSend();
                  }
                }}
                placeholder={t("wizard.chatPlaceholder" as any) || "描述你想调整的内容..."}
                disabled={isChatting}
                className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
              />
              <button
                onClick={handleChatSend}
                disabled={!chatInput.trim() || isChatting}
                className="flex items-center justify-center rounded-lg bg-emerald-600 px-3 py-2 text-white transition hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send size={13} />
              </button>
            </div>
          </div>
        )}
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
