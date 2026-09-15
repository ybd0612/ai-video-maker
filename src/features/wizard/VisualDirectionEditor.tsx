import { useCallback, useEffect, useState } from "react";
import { useProjectStore, selectActiveProject, type StyleDetails, type VisualDirection } from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useT, type TranslationKey } from "@/i18n";
import { chatCompletion } from "@/services/chatService";
import { SYSTEM_PROMPT_VISUAL_DIRECTION_EDIT_ZH } from "@/lib/promptRules";
import { Lightbox } from "@/components/ui/Lightbox";
import { getStyleReferenceUrl } from "@/lib/promptComposer";
import {
  AssetDetailShell,
  AssetDetailsBlock,
  AssetEditorFooter,
  AssetEditorMessages,
  AssetInstructionRow,
  AssetNameField,
  AssetPreviewColumn,
} from "./AssetEditorTemplate";

interface VisualDirectionEditorProps {
  onClose: () => void;
  onGenerate?: () => Promise<void>;
  generating?: boolean;
}

type DetailField = keyof Omit<StyleDetails, "kind">;

/** 六个视觉维度（展示名走 i18n：assetField.*，与资产设定字段共用同一套标签） */
const DETAIL_FIELDS: DetailField[] = [
  "mediumMaterial",
  "colorPalette",
  "lightingMood",
  "cameraTexture",
  "composition",
  "emotion",
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
        // 采样参数由模型按用途决定
        purpose: "visualDirection",
        paramContext: [
          "Task: apply a user instruction to a project-level visual direction and return the complete updated JSON (name + one-sentence description + six visual dimensions).",
          "The result becomes the shared style master for all assets, so it must stay pure visual language.",
        ].join("\n"),
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
      if (!next) throw new Error(t("wizard.visualDirectionInvalidResponse"));
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
    return <div className="p-3 text-xs text-ink-4">{t("wizard.visualDirectionUnset")}</div>;
  }

  const referenceUrl = getStyleReferenceUrl(project);
  return (
    <AssetDetailShell
      title={t("wizard.editVisualDirection")}
      backLabel={t("assetEditor.back")}
      onBack={onClose}
      backDisabled={busy || generating}
      preview={(
        <AssetPreviewColumn
          label={t("wizard.visualDirectionReference")}
          imageUrl={referenceUrl}
          alt={draft.name || t("wizard.visualDirectionUnset")}
          generating={generating}
          onGenerate={() => void onGenerate?.()}
          generateLabel={t("wizard.regenerateVisualDirection")}
          generateDisabled={busy || generating || !onGenerate}
          autoRegenerate={onGenerate ? {
            checked: autoRegenerateAssetImages,
            onChange: (checked) => useSettingsStore.getState().setAutoRegenerateAssetImages(checked),
            label: t("assetEditor.autoRegenerate"),
            disabled: busy || generating,
          } : undefined}
          onOpenLightbox={(src, alt) => (
            <Lightbox src={src} alt={alt}>
              <img src={src} alt={alt} className="aspect-video w-full rounded-lg border border-line object-contain" />
            </Lightbox>
          )}
        />
      )}
      footer={(
        <AssetEditorFooter
          cancelLabel={t("dialog.cancel")}
          onCancel={onClose}
          cancelDisabled={busy}
          saveLabel={t("wizard.saveVisualDirection")}
          onSave={() => {
            updateVisualDirection({ name: draft.name, description: draft.description, details: draft.details });
            onClose();
          }}
          saveDisabled={busy || !draft.name.trim()}
        />
      )}
    >
      <AssetNameField
        label={t("wizard.visualDirectionName")}
        value={draft.name}
        onChange={(name) => setDraft({ ...draft, name })}
        disabled={busy}
      />
      <AssetDetailsBlock
        label={t("wizard.visualDirectionContent")}
        fields={DETAIL_FIELDS.map((key) => ({
          label: t(("assetField." + key) as TranslationKey),
          value: draft.details[key],
        }))}
        emptyHint={t("assetEditor.detailsEmpty")}
        labelWidth="w-16"
      />
      <AssetInstructionRow
        instruction={instruction}
        onInstructionChange={setInstruction}
        onApply={() => void applyInstruction()}
        applying={busy}
        canApply={Boolean(providerConfig.apiKey && providerConfig.baseUrl)}
        applyLabel={t("wizard.visualDirectionApply")}
        applyingLabel={t("characters.applying")}
        placeholder={t("wizard.visualDirectionInstructionPlaceholder")}
        disabled={busy}
        onUndo={history.length > 0 ? () => { setDraft(history[history.length - 1]); setHistory((items) => items.slice(0, -1)); } : undefined}
        undoLabel={t("characters.undoDescription")}
      />
      <AssetEditorMessages error={error} />
      <p className="text-[0.625rem] text-ink-5">{t("wizard.visualDirectionReadonlyHint")}</p>
    </AssetDetailShell>
  );
}
