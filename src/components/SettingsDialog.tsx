import { useState, useEffect } from "react";
import { X, Eye, EyeOff, CheckCircle2, Loader2, AlertTriangle } from "lucide-react";
import { useSettingsStore } from "@/stores/settingsStore";
import { motion, AnimatePresence } from "framer-motion";
import { resolveBaseUrl } from '@/lib/resolveBaseUrl';
import { useT } from '@/i18n';
import type { Language } from '@/stores/settingsStore';
import { isValidUrl } from "@/lib/validation";

export function SettingsDialog() {
  const open = useSettingsStore((s) => s.settingsDialogOpen);
  const language = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const t = useT();
  const setOpen = useSettingsStore((s) => s.setSettingsDialogOpen);
  const providerConfig = useSettingsStore((s) => s.providerConfig);
  const setProviderConfig = useSettingsStore((s) => s.setProviderConfig);

  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://apihub.agnes-ai.com/v1");
  const [showKey, setShowKey] = useState(false);
  const [toast, setToast] = useState<{ show: boolean; type: "success" | "error"; message: string }>({ show: false, type: "success", message: "" });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ status: "idle" | "success" | "error"; message: string }>({ status: "idle", message: "" });

  // Sync from store whenever providerConfig changes (covers IndexedDB async restore)
  useEffect(() => {
    setApiKey(providerConfig.apiKey);
    setBaseUrl(providerConfig.baseUrl);
  }, [providerConfig]);

  // Also sync when dialog opens
  useEffect(() => {
    if (open) {
      setApiKey(providerConfig.apiKey);
      setBaseUrl(providerConfig.baseUrl);
      setTestResult({ status: "idle", message: "" });
      setToast({ show: false, type: "success", message: "" });
    }
  }, [open, providerConfig]);

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ show: true, type, message });
    setTimeout(() => setToast((t) => ({ ...t, show: false })), 3000);
  };

  const handleSave = () => {
    if (baseUrl.trim() && !isValidUrl(baseUrl.trim())) { showToast("error", t("settings.invalidUrl")); return; }
    if (!apiKey.trim()) {
      showToast("error", t("settings.keyEmpty"));
      return;
    }
    setProviderConfig({ apiKey, baseUrl });
    showToast("success", t("settings.saved"));
    setOpen(false);
  };

  const handleTestConnection = async () => {
    if (!apiKey.trim()) {
      setTestResult({ status: "error", message: t("settings.keyEmptyTest") });
      return;
    }

    setTesting(true);
    setTestResult({ status: "idle", message: "" });

    try {
      const response = await fetch(`${resolveBaseUrl(baseUrl)}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify({
          model: "agnes-2.0-flash",
          messages: [{ role: "user", content: "Reply with exactly: ping-ok" }],
          temperature: 0,
          max_tokens: 32,
          stream: false,
        }),
      });

      const text = await response.text();

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 180)}`);
      }

      const json = JSON.parse(text);
      const content = json?.choices?.[0]?.message?.content ?? "";

      if (content.toLowerCase().includes("ping-ok")) {
        setTestResult({ status: "success", message: t("settings.connectionOk") });
      } else {
        setTestResult({ status: "success", message: `${t("settings.connectionOkPreview")}${content.slice(0, 80)}` });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setTestResult({ status: "error", message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-100">{t("settings.title")}</h2>
                <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-slate-300">
                  <X size={16} />
                </button>
              </div>

              <div className="space-y-4">
                {/* API Key */}
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-400">
{t("settings.apiKey")}
                  </label>
                  <div className="relative">
                    <input
                      type={showKey ? "text" : "password"}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="sk-..."
                      className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 pr-10 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                    />
                    <button
                      onClick={() => setShowKey(!showKey)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                    >
                      {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>

                {/* Base URL */}
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-400">
{t("settings.baseUrl")}
                  </label>
                  <input
                    type="text"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://apihub.agnes-ai.com/v1"
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={handleSave}
                    className="flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-emerald-500"
                  >
{t("settings.save")}
                  </button>

                  <button
                    onClick={handleTestConnection}
                    disabled={testing}
                    className="flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:border-emerald-600 hover:text-white disabled:opacity-60"
                  >
                    {testing ? (
                      <>
                        <Loader2 size={14} className="animate-spin" /> {t("settings.testing")}
                      </>
                    ) : (
                      t("settings.testConnection")
                    )}
                  </button>
                </div>

                {testResult.status !== "idle" && (
                  <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px] leading-relaxed ${testResult.status === "success" ? "border-emerald-700 bg-emerald-950/40 text-emerald-200" : "border-red-700 bg-red-950/40 text-red-200"}`}>
                    {testResult.status === "success" ? <CheckCircle2 size={14} className="mt-0.5" /> : <AlertTriangle size={14} className="mt-0.5" />}
                    <span>{testResult.message}</span>
                  </div>
                )}

                {/* Language */}
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-400">
                    {t("settings.language")}
                  </label>
                  <div className="flex gap-2">
                    {(["zh", "en"] as Language[]).map((lng) => (
                      <button
                        key={lng}
                        onClick={() => setLanguage(lng)}
                        className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition ${
                          language === lng
                            ? "border-emerald-500 bg-emerald-950/40 text-emerald-300"
                            : "border-slate-700 bg-slate-800 text-slate-400 hover:border-slate-600 hover:text-slate-200"
                        }`}
                      >
                        {lng === "zh" ? "中文" : "English"}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-[10px] text-slate-600">
{t("settings.storageNote")}
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast notification */}
      <AnimatePresence>
        {toast.show && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`fixed top-6 right-6 z-[200] flex items-center gap-2 rounded-lg border px-4 py-2.5 text-xs font-medium shadow-xl backdrop-blur-sm ${toast.type === "success" ? "border-emerald-600 bg-emerald-950/90 text-emerald-200" : "border-red-600 bg-red-950/90 text-red-200"}`}
          >
            {toast.type === "success" ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
