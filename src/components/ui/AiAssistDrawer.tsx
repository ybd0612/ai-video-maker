// ────────────────────────────────────────────────────────────────────────────
// src/components/ui/AiAssistDrawer.tsx
// Slide-out drawer for AI-assisted prompt optimization via multi-turn chat.
//
// ⚠️ 已弃用（2026-09-12）：AI 辅助统一改为输入框内嵌「润色 / 撤销」
// （见 components/ui/AiPolishField.tsx + services/chatService.ts 的 polishText）。
// 本组件已无任何引用，保留仅作历史参考，确认无用后可直接删除。
// ────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useCallback } from "react";
import { X, Send, Check, Loader2, RotateCcw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useT } from "@/i18n";
import { useSettingsStore } from "@/stores/settingsStore";
import { chatCompletion, type ChatMessage } from "@/services/chatService";

interface AiAssistDrawerProps {
  open: boolean;
  onClose: () => void;
  currentValue: string;
  fieldName: string;
  systemPrompt: string;
  onApply: (value: string) => void;
}

export function AiAssistDrawer({
  open,
  onClose,
  currentValue,
  fieldName,
  systemPrompt,
  onApply,
}: AiAssistDrawerProps) {
  const t = useT();
  const providerConfig = useSettingsStore((s) => s.providerConfig);

  // Display messages (excludes system + context injection)
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appliedIndex, setAppliedIndex] = useState<number | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Reset state when drawer opens
  useEffect(() => {
    if (open) {
      setMessages([]);
      setInput("");
      setIsLoading(false);
      setError(null);
      setAppliedIndex(null);
    }
  }, [open]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    setError(null);

    // Build the user message
    const userMsg: ChatMessage = { role: "user", content: trimmed };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);

    try {
      // Build full message array for API (system + context + history)
      const contextMsg: ChatMessage = {
        role: "user",
        content: `${t("aiAssist.currentContent")}:\n${currentValue || t("aiAssist.emptyField")}`,
      };
      const systemMsg: ChatMessage = { role: "system", content: systemPrompt };

      // For first message, include context; subsequent messages skip it
      const apiMessages: ChatMessage[] = messages.length === 0
        ? [systemMsg, contextMsg, userMsg]
        : [systemMsg, contextMsg, ...newMessages];

      const result = await chatCompletion({
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        messages: apiMessages,
      });

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: result.content,
      };
      setMessages([...newMessages, assistantMsg]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, messages, currentValue, systemPrompt, providerConfig, t]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleApply = (content: string, index: number) => {
    onApply(content);
    setAppliedIndex(index);
  };

  const handleNewConversation = () => {
    setMessages([]);
    setInput("");
    setError(null);
    setAppliedIndex(null);
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-[90] bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Drawer */}
          <motion.div
            className="fixed right-0 top-0 bottom-0 z-[91] flex w-96 flex-col border-l border-line-soft bg-surface"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "tween", duration: 0.25 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-line-soft px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-ink">
                  {fieldName} — {t("aiAssist.title")}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {messages.length > 0 && (
                  <button
                    onClick={handleNewConversation}
                    className="rounded p-1 text-ink-4 hover:bg-raised hover:text-ink-2"
                    title={t("aiAssist.newConversation")}
                  >
                    <RotateCcw size={13} />
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="rounded p-1 text-ink-4 hover:bg-raised hover:text-ink-2"
                  title={t("aiAssist.close")}
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* Current content context */}
            <div className="border-b border-line-soft px-4 py-2">
              <p className="mb-1 text-[0.625rem] font-medium text-ink-5">
                {t("aiAssist.currentContent")}
              </p>
              <div className="max-h-20 overflow-y-auto rounded-md border border-line bg-raised/50 p-2 text-[0.6875rem] leading-relaxed text-ink-3">
                {currentValue || (
                  <span className="italic text-ink-5">{t("aiAssist.emptyField")}</span>
                )}
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-3">
              <div className="flex flex-col gap-3">
                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-lg border p-2.5 text-xs leading-relaxed ${
                        msg.role === "user"
                          ? "border-success bg-success-deep/40 text-success"
                          : "border-line bg-raised text-ink"
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    </div>

                    {/* Apply button for assistant messages */}
                    {msg.role === "assistant" && (
                      <button
                        onClick={() => handleApply(msg.content, i)}
                        disabled={appliedIndex === i}
                        className={`mt-1 flex items-center gap-1 rounded px-2 py-0.5 text-[0.625rem] font-medium transition ${
                          appliedIndex === i
                            ? "bg-success-deep/30 text-success"
                            : "bg-raised text-ink-3 hover:bg-success-deep/30 hover:text-success"
                        }`}
                      >
                        <Check size={10} />
                        {appliedIndex === i ? t("aiAssist.applied") : t("aiAssist.apply")}
                      </button>
                    )}
                  </div>
                ))}

                {/* Loading indicator */}
                {isLoading && (
                  <div className="flex items-start">
                    <div className="flex items-center gap-2 rounded-lg border border-line bg-raised px-3 py-2 text-xs text-ink-3">
                      <Loader2 size={12} className="animate-spin text-success" />
                      {t("aiAssist.thinking")}
                    </div>
                  </div>
                )}

                {/* Error */}
                {error && (
                  <div className="rounded-md border border-danger bg-danger-deep/30 p-2 text-[0.6875rem] text-danger">
                    {error}
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Input area */}
            <div className="border-t border-line-soft px-4 py-3">
              <div className="flex gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={t("aiAssist.placeholder")}
                  rows={2}
                  disabled={isLoading}
                  className="flex-1 resize-none rounded-md border border-line bg-raised p-2 text-xs text-ink placeholder:text-ink-5 focus:border-success focus:outline-none disabled:opacity-50"
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || isLoading}
                  className="flex h-9 w-9 shrink-0 items-center justify-center self-end rounded-md bg-success-solid text-white transition hover:bg-success-solid disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send size={13} />
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
