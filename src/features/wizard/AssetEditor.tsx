import { useCallback, useEffect, useState } from "react";
import { Lightbox } from "@/components/ui/Lightbox";
import { useProjectStore, type Asset } from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useT, type TranslationKey } from "@/i18n";
import { chatCompletion } from "@/services/chatService";
import { SYSTEM_PROMPT_ASSET_EDIT_ZH } from "@/lib/promptRules";
import { createDefaultAssetDetails, detailEntries, extractAssetSummary } from "@/lib/assetDetails";
import type { AssetDetails } from "@/stores/projectStore";
import {
  AssetDetailShell,
  AssetDetailsBlock,
  AssetEditorFooter,
  AssetEditorMessages,
  AssetInstructionRow,
  AssetNameField,
  AssetPreviewColumn,
  AssetPromptBlock,
  AssetSummaryBlock,
} from "./AssetEditorTemplate";

interface AssetEditorProps {
  asset: Asset;
  onClose: () => void;
  onGenerate: (asset: Asset) => Promise<void>;
  generating: boolean;
}

/** 场景 / 核心主体 / 关键物件的文案键（角色与视觉方向各用自己的编辑器） */
const TYPE_KEYS: Record<"scene" | "product" | "prop", { edit: TranslationKey; type: TranslationKey }> = {
  scene: { edit: "assetEditor.editScene", type: "assetEditor.typeScene" },
  product: { edit: "assetEditor.editProduct", type: "assetEditor.typeProduct" },
  prop: { edit: "assetEditor.editProp", type: "assetEditor.typeProp" },
};

function typeKeys(type: Asset["type"]) {
  return TYPE_KEYS[type as "scene" | "product" | "prop"] ?? TYPE_KEYS.prop;
}

function parseAsset(content: string, fallbackDetails: AssetDetails | undefined): Pick<Asset, "name" | "description" | "prompt" | "details"> | null {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Partial<Asset>;
    if (typeof parsed.name !== "string" || typeof parsed.description !== "string" || typeof parsed.prompt !== "string") return null;
    return {
      name: parsed.name.trim(),
      description: parsed.description.trim(),
      prompt: parsed.prompt.trim(),
      details: parsed.details ?? fallbackDetails,
    };
  } catch {
    return null;
  }
}

export function AssetEditor({ asset, onClose, onGenerate, generating }: AssetEditorProps) {
  const t = useT();
  const updateAsset = useProjectStore((s) => s.updateAsset);
  const providerConfig = useSettingsStore((s) => s.providerConfig);
  const autoRegenerateAssetImages = useSettingsStore((s) => s.autoRegenerateAssetImages);
  const initialDetails = asset.details ?? createDefaultAssetDetails(asset);
  const [draft, setDraft] = useState({ name: asset.name, description: asset.description, prompt: asset.prompt, details: initialDetails });
  const [instruction, setInstruction] = useState("");
  const [history, setHistory] = useState<Array<typeof draft>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const keys = typeKeys(asset.type);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy && !generating) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, generating, onClose]);

  const applyInstruction = useCallback(async () => {
    if (busy || !providerConfig.apiKey || !providerConfig.baseUrl) return;
    setBusy(true);
    setError(null);
    try {
      const result = await chatCompletion({
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        // 采样参数由模型按用途决定
        purpose: "fieldAssist",
        paramContext: [
          "Task: apply a user instruction to a single asset and return the complete updated asset JSON (description + structured details + English image prompt).",
          `Asset type: ${asset.type}`,
        ].join("\n"),
        messages: [
          // 注意：system 提示词与 payload 同为中文，属模型输入（非界面文案），不参与 i18n。
          { role: "system", content: SYSTEM_PROMPT_ASSET_EDIT_ZH },
          {
            role: "user",
            content: [
              `资产类型：${t(keys.type)}`,
              `当前资产：${JSON.stringify(draft)}`,
              `修改要求：${instruction.trim() || "请补全并优化当前资产描述和提示词。"}`,
              "只返回修改后的完整 JSON。",
            ].join("\n"),
          },
        ],
      });
      const next = parseAsset(result.content, draft.details);
      if (!next) throw new Error(t("assetEditor.invalidResponse"));
      setHistory((items) => [...items, draft]);
      setDraft({
        name: next.name,
        description: next.description,
        prompt: next.prompt,
        details: next.details ?? draft.details,
      });
      setInstruction("");
      if (autoRegenerateAssetImages) {
        await onGenerate({ ...asset, ...next });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [asset, autoRegenerateAssetImages, busy, draft, instruction, onGenerate, providerConfig, t, keys.type]);

  const save = () => {
    if (!draft.name.trim() || busy || generating) return;
    updateAsset(asset.id, draft);
    onClose();
  };

  const fieldRows = detailEntries(draft.details).map(([key, value]) => ({
    label: t(("assetField." + key) as TranslationKey),
    value,
  }));

  return (
    <AssetDetailShell
      title={t(keys.edit)}
      backLabel={t("assetEditor.back")}
      onBack={onClose}
      backDisabled={busy || generating}
      preview={(
        <AssetPreviewColumn
          label={t("assetEditor.preview")}
          imageUrl={asset.imageUrl}
          alt={draft.name || t("assetEditor.name")}
          generating={generating}
          onGenerate={() => void onGenerate({ ...asset, ...draft })}
          generateLabel={asset.imageUrl ? t("assetEditor.regenerateImage") : t("assetEditor.generateImage")}
          generateDisabled={busy || generating || !draft.prompt.trim() || !providerConfig.apiKey}
          autoRegenerate={{
            checked: autoRegenerateAssetImages,
            onChange: (checked) => useSettingsStore.getState().setAutoRegenerateAssetImages(checked),
            label: t("assetEditor.autoRegenerate"),
            disabled: busy || generating,
          }}
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
          cancelDisabled={busy || generating}
          saveLabel={t("assetEditor.saveAsset")}
          onSave={save}
          saveDisabled={busy || generating || !draft.name.trim()}
          saving={busy}
        />
      )}
    >
      <AssetNameField
        label={t("assetEditor.name")}
        value={draft.name}
        onChange={(name) => setDraft({ ...draft, name })}
      />
      {/* 一句话简介只取描述首行；此前误传整段 description（含全部要素行） */}
      <AssetSummaryBlock
        label={t("assetEditor.summary")}
        summary={extractAssetSummary(draft.description)}
        emptyHint={t("assetEditor.summaryEmpty")}
      />
      {draft.details && (
        <AssetDetailsBlock
          label={t("assetEditor.details")}
          fields={fieldRows}
          emptyHint={t("assetEditor.detailsEmpty")}
        />
      )}
      <AssetPromptBlock
        label={t("assetEditor.prompt")}
        prompt={draft.prompt}
        emptyHint={t("assetEditor.promptEmpty")}
        hint={t("assetEditor.promptHint")}
      />
      <AssetInstructionRow
        instruction={instruction}
        onInstructionChange={setInstruction}
        onApply={() => void applyInstruction()}
        applying={busy}
        canApply={Boolean(providerConfig.apiKey && providerConfig.baseUrl)}
        applyLabel={t("assetEditor.apply")}
        applyingLabel={t("assetEditor.applying")}
        placeholder={t("assetEditor.instructionPlaceholder")}
        disabled={busy || generating}
        onUndo={history.length > 0 ? () => { setDraft(history[history.length - 1]); setHistory((items) => items.slice(0, -1)); } : undefined}
        undoLabel={t("assetEditor.undo")}
      />
      <AssetEditorMessages error={error} />
    </AssetDetailShell>
  );
}
