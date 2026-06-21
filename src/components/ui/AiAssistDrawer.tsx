// ────────────────────────────────────────────────────────────────────────────
// src/components/ui/AiAssistDrawer.tsx
// Slide-out drawer for AI-assisted prompt optimization via multi-turn chat.
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
            className="fixed right-0 top-0 bottom-0 z-[91] flex w-96 flex-col border-l border-slate-800 bg-slate-900"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "tween", duration: 0.25 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-200">
                  {fieldName} — {t("aiAssist.title")}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {messages.length > 0 && (
                  <button
                    onClick={handleNewConversation}
                    className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
                    title={t("aiAssist.newConversation")}
                  >
                    <RotateCcw size={13} />
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
                  title={t("aiAssist.close")}
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* Current content context */}
            <div className="border-b border-slate-800 px-4 py-2">
              <p className="mb-1 text-[10px] font-medium text-slate-600">
                {t("aiAssist.currentContent")}
              </p>
              <div className="max-h-20 overflow-y-auto rounded-md border border-slate-700 bg-slate-800/50 p-2 text-[11px] leading-relaxed text-slate-400">
                {currentValue || (
                  <span className="italic text-slate-600">{t("aiAssist.emptyField")}</span>
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
                          ? "border-emerald-700 bg-emerald-950/40 text-emerald-100"
                          : "border-slate-700 bg-slate-800 text-slate-200"
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    </div>

                    {/* Apply button for assistant messages */}
                    {msg.role === "assistant" && (
                      <button
                        onClick={() => handleApply(msg.content, i)}
                        disabled={appliedIndex === i}
                        className={`mt-1 flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium transition ${
                          appliedIndex === i
                            ? "bg-emerald-900/30 text-emerald-400"
                            : "bg-slate-800 text-slate-400 hover:bg-emerald-900/30 hover:text-emerald-300"
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
                    <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-400">
                      <Loader2 size={12} className="animate-spin text-emerald-400" />
                      {t("aiAssist.thinking")}
                    </div>
                  </div>
                )}

                {/* Error */}
                {error && (
                  <div className="rounded-md border border-red-800 bg-red-950/30 p-2 text-[11px] text-red-300">
                    {error}
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Input area */}
            <div className="border-t border-slate-800 px-4 py-3">
              <div className="flex gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={t("aiAssist.placeholder")}
                  rows={2}
                  disabled={isLoading}
                  className="flex-1 resize-none rounded-md border border-slate-700 bg-slate-800 p-2 text-xs text-slate-100 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || isLoading}
                  className="flex h-9 w-9 shrink-0 items-center justify-center self-end rounded-md bg-emerald-600 text-white transition hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
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
