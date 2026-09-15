import { useState, useEffect, useRef } from "react";
import { X, Eye, EyeOff, CheckCircle2, Loader2, AlertTriangle, Plus, Trash2, RotateCcw, Download, Upload } from "lucide-react";
import { useSettingsStore } from "@/stores/settingsStore";
import { motion, AnimatePresence } from "framer-motion";
import { resolveBaseUrl } from '@/lib/resolveBaseUrl';
import { useT } from '@/i18n';
import type { Language } from '@/stores/settingsStore';
import { isValidUrl } from "@/lib/validation";
import { MODELS } from "@/lib/models";
import { PLANS, resolvePlan, type PlanId } from "@/lib/plans";
import type { TranslationKey } from "@/i18n";
import { BUILTIN_RULES, mergeRules, type PromptRule, type PromptTask, type RuleSection } from "@/lib/promptRules";
import { AiPolishField } from "@/components/ui/AiPolishField";
import { confirmDialog } from "@/components/ui/ConfirmDialog";

/* 展示所选套餐的 RPM 与订阅配额，帮助用户理解当前限制 */
function PlanLimitSummary({
  planId,
  t,
}: {
  planId: PlanId;
  t: (key: import("@/i18n").TranslationKey, vars?: Record<string, string | number>) => string;
}) {
  const plan = resolvePlan(planId);
  const q = plan.quota;
  const hasQuota = plan.accessType === "tokenplan";

  return (
    <div className="mt-2 space-y-1 rounded-lg border border-line/60 bg-raised/40 px-3 py-2 text-[0.625rem] leading-relaxed text-ink-3">
      <p>{t("settings.planHint")}</p>
      <p>
        <span className="text-ink-4">{t("settings.planRpm")}</span>{" "}
        {t("settings.planRpmValue", {
          text: plan.rpm.text,
          tier: "1K",
          image: plan.rpm.image["1K"],
          video: plan.rpm.video,
        })}
      </p>
      <p>
        <span className="text-ink-4">{t("settings.planQuota")}</span>{" "}
        {hasQuota
          ? t("settings.planQuotaValue", {
              text5h: (q.textPer5h ?? 0).toLocaleString(),
              textWeek: (q.textPerWeek ?? 0).toLocaleString(),
              imageDay: (q.imagePerDay ?? 0).toLocaleString(),
              videoDay: (q.videoSecondsPerDay ?? 0).toLocaleString(),
            })
          : t("settings.planNone")}
      </p>
    </div>
  );
}

/* ── 提示词规则设置（T05） ─────────────────────────────────────────────────── */

const RULE_TASKS: PromptTask[] = [
  "extractAssets", "storyboard", "characterAppearance",
  "styleRef", "composeShot", "negativeStrategy", "polish",
];
const RULE_SECTIONS: RuleSection[] = ["rules", "examples", "safety"];

/** 导入 JSON 的宽松校验：结构合法即可（id 非空 / task·section 在枚举内 / content zh·en 为字符串 / enabled 布尔） */
function isPromptRule(v: unknown): v is PromptRule {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  const content = r.content as { zh?: unknown; en?: unknown } | undefined;
  return (
    typeof r.id === "string" && r.id.trim() !== "" &&
    RULE_TASKS.includes(r.task as PromptTask) &&
    RULE_SECTIONS.includes(r.section as RuleSection) &&
    !!content &&
    typeof content.zh === "string" &&
    typeof content.en === "string" &&
    typeof r.enabled === "boolean"
  );
}

function PromptRulesSettings({
  t,
  language,
  showToast,
}: {
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
  language: Language;
  showToast: (type: "success" | "error", message: string) => void;
}) {
  const stored = useSettingsStore((s) => s.promptRules);
  const setStored = useSettingsStore((s) => s.setPromptRules);

  const effective = mergeRules(BUILTIN_RULES, stored ?? []);
  const storedIds = new Set((stored ?? []).map((r) => r.id));

  const [newTask, setNewTask] = useState<PromptTask>("storyboard");
  const [newSection, setNewSection] = useState<RuleSection>("rules");
  const [newContent, setNewContent] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  /* 存储只记差异：覆盖内置条目存全量（同 id 覆盖），自定义条目直接追加 */
  const upsertStored = (rule: PromptRule) => {
    const rest = (stored ?? []).filter((r) => r.id !== rule.id);
    setStored([...rest, rule]);
  };
  const removeFromStored = async (rule: PromptRule) => {
    const ok = await confirmDialog({
      title: t("settings.rules.delete"),
      message: rule.source === "custom"
        ? t("settings.rules.deleteCustomConfirm", { id: rule.id })
        : t("settings.rules.restoreConfirm", { id: rule.id }),
      confirmLabel: t("dialog.confirm"),
      variant: rule.source === "custom" ? "danger" : "default",
    });
    if (ok) setStored((stored ?? []).filter((r) => r.id !== rule.id));
  };

  /* 编辑内容：覆盖后条目为单语文本（zh=en 同值）；「恢复默认」删差异即回到内置双语原文 */
  const updateContent = (rule: PromptRule, value: string) => {
    upsertStored({ ...rule, content: { zh: value, en: value } });
  };
  const toggleEnabled = (rule: PromptRule) => {
    upsertStored({ ...rule, enabled: !rule.enabled });
  };

  const addCustom = () => {
    const content = newContent.trim();
    if (!content) return;
    const rule: PromptRule = {
      id: `custom.${Date.now()}`,
      task: newTask,
      section: newSection,
      content: { zh: content, en: content },
      enabled: true,
      source: "custom",
    };
    setStored([...(stored ?? []), rule]);
    setNewContent("");
  };

  const handleResetAll = async () => {
    const ok = await confirmDialog({
      title: t("settings.tabRules"),
      message: t("settings.rules.resetAllConfirm"),
    });
    if (ok) setStored([]);
  };

  const handleExport = () => {
    const data = stored ?? [];
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "wxhb-prompt-rules.json";
    a.click();
    URL.revokeObjectURL(url);
    showToast("success", t("settings.rules.exported", { count: data.length }));
  };

  const handleImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      if (!Array.isArray(parsed) || !parsed.every(isPromptRule)) {
        showToast("error", t("settings.rules.importInvalid"));
        return;
      }
      setStored(parsed as PromptRule[]);
      showToast("success", t("settings.rules.imported", { count: parsed.length }));
    } catch {
      showToast("error", t("settings.rules.importInvalid"));
    }
  };

  const iconBtn =
    "flex items-center gap-1 rounded-lg border border-line bg-raised px-2.5 py-1.5 text-[0.6875rem] font-medium text-ink-2 transition hover:border-success hover:text-white";

  return (
    <div className="flex max-h-[65vh] flex-col gap-3">
      <p className="text-[0.6875rem] leading-relaxed text-ink-4">{t("settings.rules.hint")}</p>

      {/* 全局操作：恢复默认 / 导出 / 导入 */}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void handleResetAll()} className={iconBtn}>
          <RotateCcw size={12} /> {t("settings.rules.resetAll")}
        </button>
        <button type="button" onClick={handleExport} className={iconBtn}>
          <Download size={12} /> {t("settings.rules.export")}
        </button>
        <button type="button" onClick={() => fileRef.current?.click()} className={iconBtn}>
          <Upload size={12} /> {t("settings.rules.import")}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleImportFile(f);
            e.target.value = "";
          }}
        />
      </div>

      {/* 条目列表（按 task 分组） */}
      <div className="flex-1 space-y-4 overflow-y-auto pr-1">
        {RULE_TASKS.map((task) => {
          const rules = effective.filter((r) => r.task === task);
          if (rules.length === 0) return null;
          return (
            <section key={task} className="space-y-2">
              <h3 className="text-[0.6875rem] font-semibold text-ink-2">
                {t(("settings.rules.task." + task) as TranslationKey)}
              </h3>
              {rules.map((rule) => {
                const overridden = storedIds.has(rule.id);
                const shown = language === "en" ? rule.content.en : rule.content.zh;
                return (
                  <div
                    key={rule.id}
                    className={`rounded-lg border p-2 ${
                      rule.enabled
                        ? "border-line/60 bg-raised/40"
                        : "border-line-soft bg-surface/60 opacity-60"
                    }`}
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <span title={rule.id} className="min-w-0 flex-1 truncate text-[0.625rem] text-ink-4">
                        {rule.id}
                      </span>
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[0.625rem] ${
                          rule.source === "custom"
                            ? "bg-accent-deep/60 text-accent"
                            : "bg-hover/50 text-ink-3"
                        }`}
                      >
                        {rule.source === "custom"
                          ? t("settings.rules.customBadge")
                          : t("settings.rules.builtinBadge")}
                      </span>
                      <label className="flex shrink-0 cursor-pointer items-center gap-1 text-[0.625rem] text-ink-3">
                        <input
                          type="checkbox"
                          checked={rule.enabled}
                          onChange={() => toggleEnabled(rule)}
                          className="accent-success-solid"
                        />
                        {t("settings.rules.enabled")}
                      </label>
                      {rule.source === "custom" ? (
                        <button
                          type="button"
                          onClick={() => void removeFromStored(rule)}
                          title={t("settings.rules.delete")}
                          className="shrink-0 rounded p-1 text-ink-4 hover:bg-raised hover:text-danger"
                        >
                          <Trash2 size={12} />
                        </button>
                      ) : (
                        overridden && (
                          <button
                            type="button"
                            onClick={() => void removeFromStored(rule)}
                            title={t("settings.rules.restoreItem")}
                            className="shrink-0 rounded p-1 text-ink-4 hover:bg-raised hover:text-warn"
                          >
                            <RotateCcw size={12} />
                          </button>
                        )
                      )}
                    </div>
                    <AiPolishField
                      value={shown}
                      onChange={(v) => updateContent(rule, v)}
                      rows={3}
                      resetKey={rule.id}
                      bare
                    />
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>

      {/* 新增自定义条目 */}
      <div className="space-y-2 rounded-lg border border-line/60 bg-raised/40 p-3">
        <p className="text-[0.6875rem] font-semibold text-ink-2">{t("settings.rules.addTitle")}</p>
        <div className="grid grid-cols-2 gap-2">
          <select
            value={newTask}
            onChange={(e) => setNewTask(e.target.value as PromptTask)}
            className="w-full rounded-lg border border-line bg-raised px-2 py-1.5 text-[0.6875rem] text-ink focus:border-success focus:outline-none"
          >
            {RULE_TASKS.map((task) => (
              <option key={task} value={task}>
                {t(("settings.rules.task." + task) as TranslationKey)}
              </option>
            ))}
          </select>
          <select
            value={newSection}
            onChange={(e) => setNewSection(e.target.value as RuleSection)}
            className="w-full rounded-lg border border-line bg-raised px-2 py-1.5 text-[0.6875rem] text-ink focus:border-success focus:outline-none"
          >
            {RULE_SECTIONS.map((sec) => (
              <option key={sec} value={sec}>
                {t(("settings.rules.section." + sec) as TranslationKey)}
              </option>
            ))}
          </select>
        </div>
        <AiPolishField
          value={newContent}
          onChange={setNewContent}
          placeholder={t("settings.rules.contentPlaceholder")}
          rows={2}
          resetKey="new-rule"
        />
        <button
          type="button"
          onClick={addCustom}
          disabled={!newContent.trim()}
          className="flex items-center gap-1 rounded-lg bg-success-solid px-3 py-1.5 text-[0.6875rem] font-semibold text-white transition hover:bg-success-solid disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus size={12} /> {t("settings.rules.add")}
        </button>
      </div>
    </div>
  );
}

export function SettingsDialog() {
  const open = useSettingsStore((s) => s.settingsDialogOpen);
  const language = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const loggingEnabled = useSettingsStore((s) => s.loggingEnabled);
  const setLoggingEnabled = useSettingsStore((s) => s.setLoggingEnabled);
  const showLogPanel = useSettingsStore((s) => s.showLogPanel);
  const setShowLogPanel = useSettingsStore((s) => s.setShowLogPanel);
  const t = useT();
  const setOpen = useSettingsStore((s) => s.setSettingsDialogOpen);
  const providerConfig = useSettingsStore((s) => s.providerConfig);
  const setProviderConfig = useSettingsStore((s) => s.setProviderConfig);

  const [tab, setTab] = useState<"general" | "rules">("general");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://api.agnes-ai.cn/v1");
  const [plan, setPlan] = useState<PlanId>("default");
  const [showKey, setShowKey] = useState(false);
  const [toast, setToast] = useState<{ show: boolean; type: "success" | "error"; message: string }>({ show: false, type: "success", message: "" });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ status: "idle" | "success" | "error"; message: string }>({ status: "idle", message: "" });

  // Sync from store whenever providerConfig changes (covers IndexedDB async restore)
  useEffect(() => {
    setApiKey(providerConfig.apiKey);
    setBaseUrl(providerConfig.baseUrl);
    setPlan(providerConfig.plan ?? "default");
  }, [providerConfig]);

  // Also sync when dialog opens
  useEffect(() => {
    if (open) {
      setApiKey(providerConfig.apiKey);
      setBaseUrl(providerConfig.baseUrl);
      setPlan(providerConfig.plan ?? "default");
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
    setProviderConfig({ apiKey, baseUrl, plan });
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
          model: MODELS.text,
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
              className="w-full max-w-lg rounded-2xl border border-line bg-surface p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-bold text-ink">{t("settings.title")}</h2>
                <button onClick={() => setOpen(false)} className="text-ink-4 hover:text-ink-2">
                  <X size={16} />
                </button>
              </div>

              {/* Tab 切换：基础 / 提示词规则 */}
              <div className="mb-3 flex gap-2">
                {([
                  ["general", t("settings.tabGeneral") as string],
                  ["rules", t("settings.tabRules") as string],
                ] as Array<["general" | "rules", string]>).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTab(id)}
                    className={`flex-1 rounded-lg border px-3 py-1.5 text-[0.6875rem] font-medium transition ${
                      tab === id
                        ? "border-success bg-success-deep/40 text-success"
                        : "border-line bg-raised text-ink-3 hover:border-line-strong hover:text-ink"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {tab === "general" ? (
              <div className="space-y-4">
                {/* API Key */}
                <div>
                  <label className="mb-1 block text-[0.6875rem] font-medium text-ink-3">
{t("settings.apiKey")}
                                      <a
                      href="https://platform.agnes-ai.cn/settings/apiKeys"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-1 text-success hover:text-success underline"
                    >
                      {t("settings.getApiKey")}
                    </a>
                  </label>
                  <div className="relative">
                    <input
                      type={showKey ? "text" : "password"}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="sk-..."
                      className="w-full rounded-lg border border-line bg-raised px-3 py-2 pr-10 text-xs text-ink focus:border-success focus:outline-none"
                    />
                    <button
                      onClick={() => setShowKey(!showKey)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-4 hover:text-ink-2"
                    >
                      {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>

                {/* Base URL */}
                <div>
                  <label className="mb-1 block text-[0.6875rem] font-medium text-ink-3">
{t("settings.baseUrl")}
                  </label>
                  <input
                    type="text"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://api.agnes-ai.cn/v1"
                    className="w-full rounded-lg border border-line bg-raised px-3 py-2 text-xs text-ink placeholder:text-ink-5 focus:border-success focus:outline-none"
                  />
                </div>

                {/* Plan / access tier */}
                <div>
                  <label className="mb-1 block text-[0.6875rem] font-medium text-ink-3">
                    {t("settings.plan")}
                  </label>
                  <select
                    value={plan}
                    onChange={(e) => setPlan(e.target.value as PlanId)}
                    className="w-full rounded-lg border border-line bg-raised px-3 py-2 text-xs text-ink focus:border-success focus:outline-none"
                  >
                    {(Object.keys(PLANS) as PlanId[]).map((id) => (
                      <option key={id} value={id}>
                        {language === "zh" ? PLANS[id].label : PLANS[id].labelEn}
                      </option>
                    ))}
                  </select>
                  <PlanLimitSummary planId={plan} t={t} />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={handleSave}
                    className="flex items-center justify-center gap-2 rounded-lg bg-success-solid px-4 py-2 text-xs font-semibold text-white transition hover:bg-success-solid"
                  >
{t("settings.save")}
                  </button>

                  <button
                    onClick={handleTestConnection}
                    disabled={testing}
                    className="flex items-center justify-center gap-2 rounded-lg border border-line bg-raised px-4 py-2 text-xs font-semibold text-ink transition hover:border-success hover:text-white disabled:opacity-60"
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
                  <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[0.6875rem] leading-relaxed ${testResult.status === "success" ? "border-success bg-success-deep/40 text-success" : "border-danger bg-danger-deep/40 text-danger"}`}>
                    {testResult.status === "success" ? <CheckCircle2 size={14} className="mt-0.5" /> : <AlertTriangle size={14} className="mt-0.5" />}
                    <span>{testResult.message}</span>
                  </div>
                )}

                {/* Language */}
                <div>
                  <label className="mb-1 block text-[0.6875rem] font-medium text-ink-3">
                    {t("settings.language")}
                  </label>
                  <div className="flex gap-2">
                    {(["zh", "en"] as Language[]).map((lng) => (
                      <button
                        key={lng}
                        onClick={() => setLanguage(lng)}
                        className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition ${
                          language === lng
                            ? "border-success bg-success-deep/40 text-success"
                            : "border-line bg-raised text-ink-3 hover:border-line-strong hover:text-ink"
                        }`}
                      >
                        {/* 语言名用各自语言自称（中文 / English），不随界面语言变化，属国际惯例 */}
                        {lng === "zh" ? "中文" : "English"}
                      </button>
                    ))}
                  </div>
                </div>
                {/* 运行日志：面板显示开关 + 采集开关 */}
                <div className="rounded-lg border border-line/50 bg-raised/40 p-3">
                  <label className="mb-1 block text-[0.6875rem] font-medium text-ink-3">
                    {t("log.title")}
                  </label>
                  <label className="flex select-none items-center gap-2 py-1 text-xs text-ink-2">
                    <input
                      type="checkbox"
                      checked={showLogPanel}
                      onChange={(e) => setShowLogPanel(e.target.checked)}
                      className="h-3.5 w-3.5 accent-accent"
                    />
                    {t("log.showPanel")}
                  </label>
                  <label className="flex select-none items-center gap-2 py-1 text-xs text-ink-2">
                    <input
                      type="checkbox"
                      checked={loggingEnabled}
                      onChange={(e) => setLoggingEnabled(e.target.checked)}
                      className="h-3.5 w-3.5 accent-accent"
                    />
                    {t("log.record")}
                  </label>
                  <p className="mt-1 text-[0.625rem] leading-relaxed text-ink-5">{t("log.hint")}</p>
                </div>

                <p className="text-[0.625rem] text-ink-5">
{t("settings.storageNote")}
                </p>
                <a
                  href="https://github.com/ybd0612/ai-flow-canvas"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 flex items-center gap-2 rounded-lg border border-line/50 bg-raised/40 px-3 py-2 text-[0.6875rem] text-ink-3 hover:text-ink hover:border-line-strong transition"
                >
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
                  <span>GitHub</span>
                  <span className="ml-auto text-[0.625rem] text-ink-4">{t("settings.github.desc")}</span>
                </a>
              </div>
              ) : (
                <PromptRulesSettings t={t} language={language} showToast={showToast} />
              )}
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
            className={`fixed top-6 right-6 z-[200] flex items-center gap-2 rounded-lg border px-4 py-2.5 text-xs font-medium shadow-xl backdrop-blur-sm ${toast.type === "success" ? "border-success bg-success-deep/90 text-success" : "border-danger bg-danger-deep/90 text-danger"}`}
          >
            {toast.type === "success" ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
