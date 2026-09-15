import { useCallback, useEffect, useState } from "react";
import { Loader2, Sparkles, Undo2 } from "lucide-react";
import { AssetDetailLayout, AssetPreviewFrame } from "./AssetDetailLayout";
import { useProjectStore, selectActiveProject, type StyleDetails, type VisualDirection } from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useT } from "@/i18n";
import { chatCompletion } from "@/services/chatService";
import { SYSTEM_PROMPT_VISUAL_DIRECTION_EDIT_ZH } from "@/lib/promptRules";
import { Lightbox } from "@/components/ui/Lightbox";
import { getStyleReferenceUrl } from "@/lib/promptComposer";

interface VisualDirectionEditorProps {
  onClose: () => void;
  onGenerate?: () => Promise<void>;
  generating?: boolean;
}

type DetailField = keyof Omit<StyleDetails, "kind">;

const FIELD_LABELS: Array<{ key: DetailField; label: string }> = [
  { key: "mediumMaterial", label: "画风与材质" },
  { key: "colorPalette", label: "主色调" },
  { key: "lightingMood", label: "光影氛围" },
  { key: "cameraTexture", label: "镜头质感" },
  { key: "composition", label: "构图倾向" },
  { key: "emotion", label: "整体情绪" },
];

/** 逐字段取字符串：details 缺失时回落旧平铺字段（兼容旧模型输出）。 */
function readDetailField(
  raw: Record<string, unknown>,
  flat: Record<string, unknown>,
  key: DetailField,
  fallback: string,
): string {
  for (const source of [raw, flat]) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
}

function parseVisualDirection(content: string, fallback: VisualDirection): VisualDirection | null {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    const rawDetails = (
      parsed.details && typeof parsed.details === "object" && !Array.isArray(parsed.details)
        ? parsed.details
        : {}
    ) as Record<string, unknown>;
    const details: StyleDetails = {
      kind: "style",
      mediumMaterial: readDetailField(rawDetails, parsed, "mediumMaterial", fallback.details.mediumMaterial),
      colorPalette: readDetailField(rawDetails, parsed, "colorPalette", fallback.details.colorPalette),
      lightingMood: readDetailField(rawDetails, parsed, "lightingMood", fallback.details.lightingMood),
      cameraTexture: readDetailField(rawDetails, parsed, "cameraTexture", fallback.details.cameraTexture),
      composition: readDetailField(rawDetails, parsed, "composition", fallback.details.composition),
      emotion: readDetailField(rawDetails, parsed, "emotion", fallback.details.emotion),
    };
    return {
      ...fallback,
      name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : fallback.name,
      description: typeof parsed.description === "string" ? parsed.description.trim() : fallback.description,
      details,
    };
  } catch {
    return null;
  }
}

export function VisualDirectionEditor({ onClose, onGenerate, generating = false }: VisualDirectionEditorProps) {
  const t = useT();
  const project = useProjectStore(selectActiveProject);
  const updateVisualDirection = useProjectStore((s) => s.updateVisualDirection);
  const providerConfig = useSettingsStore((s) => s.providerConfig);
  const autoRegenerateAssetImages = useSettingsStore((s) => s.autoRegenerateAssetImages);
  const direction = project?.visualDirection;
  const [draft, setDraft] = useState<VisualDirection | undefined>(direction);
  const [instruction, setInstruction] = useState("");
  const [history, setHistory] = useState<VisualDirection[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, onClose]);

  const applyInstruction = useCallback(async () => {
    if (!draft || busy || !providerConfig.apiKey || !providerConfig.baseUrl) return;
    setBusy(true);
    setError(null);
    try {
      const result = await chatCompletion({
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        temperature: 0.2,
        messages: [
          { role: "system", content: SYSTEM_PROMPT_VISUAL_DIRECTION_EDIT_ZH },
          {
            role: "user",
            content: [
              `当前视觉方向：${JSON.stringify({
                name: draft.name,
                description: draft.description ?? "",
                details: draft.details,
              })}`,
              `修改要求：${instruction.trim() || "请补全并优化当前视觉方向，使六个维度更加具体、协调。"}`,
              "只返回修改后的完整 JSON。",
            ].join("\n"),
          },
        ],
      });
      const next = parseVisualDirection(result.content, draft);
      if (!next) throw new Error(t("wizard.visualDirectionInvalidResponse" as any));
      setHistory((items) => [...items, draft]);
      setDraft(next);
      setInstruction("");
      if (autoRegenerateAssetImages && onGenerate) await onGenerate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [autoRegenerateAssetImages, busy, draft, instruction, onGenerate, providerConfig, t]);

  if (!project || !draft) {
    return <div className="p-3 text-xs text-ink-4">{t("wizard.visualDirectionUnset" as any)}</div>;
  }

  const referenceUrl = getStyleReferenceUrl(project);

  return (
    <AssetDetailLayout
      title={t("wizard.editVisualDirection" as any)}
      onBack={onClose}
      backDisabled={busy || generating}
      preview={(
        <>
          <label className="text-[0.6875rem] font-medium text-ink-4">{t("wizard.visualDirectionReference" as any)}</label>
          {referenceUrl ? (
            <Lightbox src={referenceUrl} alt={t("wizard.visualDirectionReference" as any)}>
              <AssetPreviewFrame><img src={referenceUrl} alt={t("wizard.visualDirectionReference" as any)} className="h-full w-full object-contain" /></AssetPreviewFrame>
            </Lightbox>
          ) : <AssetPreviewFrame><span className="text-ink-5">—</span></AssetPreviewFrame>}
          {onGenerate && <>
            <button onClick={() => void onGenerate()} disabled={busy || generating} className="flex w-full items-center justify-center gap-1 rounded border border-line px-1.5 py-1 text-[0.625rem] text-accent hover:bg-accent-deep/30 disabled:opacity-50">
              {generating ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
              重新生成视觉方向图
            </button>
            <label className="flex select-none items-center gap-1.5 text-[0.625rem] text-ink-3">
              <input type="checkbox" checked={autoRegenerateAssetImages} onChange={(event) => useSettingsStore.getState().setAutoRegenerateAssetImages(event.target.checked)} disabled={busy || generating} className="h-3 w-3 accent-accent" />
              编辑后自动生成图片
            </label>
          </>}
        </>
      )}
      footer={(
        <div className="flex justify-end gap-2 border-t border-line-soft pt-3">
          <button onClick={onClose} disabled={busy} className="rounded-md border border-line px-3 py-1.5 text-xs text-ink-3 hover:bg-raised disabled:opacity-50">{t("dialog.cancel")}</button>
          <button onClick={() => { updateVisualDirection({ name: draft.name, description: draft.description, details: draft.details }); onClose(); }} disabled={busy || !draft.name.trim()} className="rounded-md bg-success px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">{t("wizard.saveVisualDirection" as any)}</button>
        </div>
      )}
    >
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-[0.6875rem] font-medium text-ink-4">{t("wizard.visualDirectionName" as any)}</label>
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="w-full rounded-md border border-line bg-raised px-2 py-1.5 text-xs text-ink focus:border-accent focus:outline-none"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[0.6875rem] font-medium text-ink-4">{t("wizard.visualDirectionContent" as any)}</label>
            <div className="space-y-1.5 rounded-md border border-line bg-raised p-2">
              {FIELD_LABELS.map(({ key, label }) => (
                <div key={key} className="flex gap-2 text-xs leading-relaxed">
                  <span className="w-16 shrink-0 font-medium text-ink-3">{label}</span>
                  <span className="min-w-0 flex-1 text-ink">{draft.details[key] || "—"}</span>
                </div>
              ))}
            </div>
            <p className="text-[0.625rem] text-ink-5">{t("wizard.visualDirectionReadonlyHint" as any)}</p>
          </div>

          <div className="flex items-center gap-1.5">
            <input
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void applyInstruction();
                }
              }}
              placeholder={t("wizard.visualDirectionInstructionPlaceholder" as any)}
              disabled={busy}
              className="min-w-0 flex-1 rounded-md border border-line bg-raised px-2 py-1.5 text-xs text-ink placeholder:text-ink-5 focus:border-accent focus:outline-none disabled:opacity-50"
            />
            <button onClick={() => void applyInstruction()} disabled={busy || !providerConfig.apiKey || !providerConfig.baseUrl} className="flex shrink-0 items-center gap-1 rounded-md bg-accent px-2 py-1.5 text-[0.6875rem] font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50" title={t("wizard.visualDirectionApply" as any)}>
              {busy ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
              {busy ? t("characters.applying") : t("wizard.visualDirectionApply" as any)}
            </button>
            {history.length > 0 && (
              <button onClick={() => { setDraft(history[history.length - 1]); setHistory((items) => items.slice(0, -1)); }} disabled={busy} className="shrink-0 rounded-md border border-line px-2 py-1.5 text-[0.6875rem] text-ink-3 hover:bg-raised disabled:opacity-50" title={t("characters.undoDescription") as any}>
                <Undo2 size={11} />
              </button>
            )}
          </div>
          {error && <p className="text-[0.625rem] text-danger">{error}</p>}
        </div>

    </AssetDetailLayout>
  );
}
