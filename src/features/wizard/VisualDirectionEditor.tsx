import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2, Sparkles, Undo2 } from "lucide-react";
import { useProjectStore, selectActiveProject, type VisualDirection } from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useT } from "@/i18n";
import { chatCompletion } from "@/services/chatService";
import { SYSTEM_PROMPT_VISUAL_DIRECTION_EDIT_ZH } from "@/lib/promptRules";
import { Lightbox } from "@/components/ui/Lightbox";
import { getStyleReferenceUrl } from "@/lib/promptComposer";

interface VisualDirectionEditorProps {
  onClose: () => void;
}

type EditableField = keyof Pick<
  VisualDirection,
  "name" | "mediumMaterial" | "colorPalette" | "lightingMood" | "cameraTexture" | "composition" | "emotion"
>;

const FIELD_LABELS: Array<{ key: EditableField; label: string }> = [
  { key: "mediumMaterial", label: "画风与材质" },
  { key: "colorPalette", label: "主色调" },
  { key: "lightingMood", label: "光影氛围" },
  { key: "cameraTexture", label: "镜头质感" },
  { key: "composition", label: "构图倾向" },
  { key: "emotion", label: "整体情绪" },
];

function parseVisualDirection(content: string, fallback: VisualDirection): VisualDirection | null {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Partial<VisualDirection>;
    return {
      ...fallback,
      name: typeof parsed.name === "string" ? parsed.name.trim() : fallback.name,
      mediumMaterial: typeof parsed.mediumMaterial === "string" ? parsed.mediumMaterial.trim() : fallback.mediumMaterial,
      colorPalette: typeof parsed.colorPalette === "string" ? parsed.colorPalette.trim() : fallback.colorPalette,
      lightingMood: typeof parsed.lightingMood === "string" ? parsed.lightingMood.trim() : fallback.lightingMood,
      cameraTexture: typeof parsed.cameraTexture === "string" ? parsed.cameraTexture.trim() : fallback.cameraTexture,
      composition: typeof parsed.composition === "string" ? parsed.composition.trim() : fallback.composition,
      emotion: typeof parsed.emotion === "string" ? parsed.emotion.trim() : fallback.emotion,
    };
  } catch {
    return null;
  }
}

export function VisualDirectionEditor({ onClose }: VisualDirectionEditorProps) {
  const t = useT();
  const project = useProjectStore(selectActiveProject);
  const updateVisualDirection = useProjectStore((s) => s.updateVisualDirection);
  const providerConfig = useSettingsStore((s) => s.providerConfig);
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
                mediumMaterial: draft.mediumMaterial,
                colorPalette: draft.colorPalette,
                lightingMood: draft.lightingMood,
                cameraTexture: draft.cameraTexture,
                composition: draft.composition,
                emotion: draft.emotion,
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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [busy, draft, instruction, providerConfig, t]);

  if (!project || !draft) {
    return <div className="p-3 text-xs text-ink-4">{t("wizard.visualDirectionUnset" as any)}</div>;
  }

  const referenceUrl = getStyleReferenceUrl(project);

  return (
    <div className="flex flex-col gap-3 p-3">
      <button
        type="button"
        onClick={onClose}
        disabled={busy}
        className="flex w-fit items-center gap-2 rounded p-1 text-xs font-medium text-ink-2 transition hover:bg-raised hover:text-ink-2 disabled:opacity-50"
        title={t("dialog.cancel")}
      >
        <ArrowLeft size={14} />
        <span>{t("wizard.editVisualDirection" as any)}</span>
      </button>

      <div className="flex flex-col gap-3 @md:flex-row">
        <div className="min-w-0 flex-1 space-y-3">
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
                  <span className="min-w-0 flex-1 text-ink">{draft[key] || "—"}</span>
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

        <div className="flex flex-col gap-1 @md:w-2/5">
          <label className="text-[0.6875rem] font-medium text-ink-4">{t("wizard.visualDirectionReference" as any)}</label>
          {referenceUrl ? (
            <Lightbox src={referenceUrl} alt={t("wizard.visualDirectionReference" as any)}>
              <div className="flex h-48 w-full items-center justify-center overflow-hidden rounded-lg border border-line bg-raised @md:h-56"><img src={referenceUrl} alt={t("wizard.visualDirectionReference" as any)} className="h-full w-full object-contain" /></div>
            </Lightbox>
          ) : (
            <div className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-line text-ink-5">—</div>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-line-soft pt-3">
        <button onClick={onClose} disabled={busy} className="rounded-md border border-line px-3 py-1.5 text-xs text-ink-3 hover:bg-raised disabled:opacity-50">{t("common.cancel" as any)}</button>
        <button
          onClick={() => {
            updateVisualDirection({
              name: draft.name,
              mediumMaterial: draft.mediumMaterial,
              colorPalette: draft.colorPalette,
              lightingMood: draft.lightingMood,
              cameraTexture: draft.cameraTexture,
              composition: draft.composition,
              emotion: draft.emotion,
            });
            onClose();
          }}
          disabled={busy || !draft.name.trim()}
          className="rounded-md bg-success px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {t("wizard.saveVisualDirection" as any)}
        </button>
      </div>
    </div>
  );
}
