// ────────────────────────────────────────────────────────────────────────────
// src/features/characters/CharacterEditor.tsx
// Character editing form: 用户只编辑「名称」；角色描述（完整角色信息，中文）由 AI 经指令维护；
// 英文外貌提示词为派生物（AI 修改描述后即时重派生，保存时兜底），只读展示。
// 定妆照：默认勾选「AI 修改描述后自动重新生成」；未勾选时保留手动按钮。
// 任一 AI/生成请求进行中，编辑器内的 AI 修改 / 撤销 / 保存 / 定妆照按钮统一禁用（返回后恢复）。
// ────────────────────────────────────────────────────────────────────────────

import { useEffect } from "react";
import type { Asset } from "@/stores/projectStore";
import { useT } from "@/i18n";
import type { TranslationKey } from "@/i18n";
import { Lightbox } from "@/components/ui/Lightbox";
import { parseCharacterDescription } from "@/lib/promptComposer";
import { detailEntries } from "@/lib/assetDetails";
import { useCharacterEditorActions } from "./useCharacterEditorActions";
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
} from "@/features/wizard/AssetEditorTemplate";

interface CharacterEditorProps {
  character: Asset | null; // null = creating new
  onClose: () => void;
}

export function CharacterEditor({ character, onClose }: CharacterEditorProps) {
  const t = useT();
  const {
    name,
    setName,
    description,
    instruction,
    setInstruction,
    appearancePrompt,
    appearanceStale,
    isDerivingAppearance,
    isApplyingInstruction,
    portraitUrl,
    isGeneratingPortrait,
    isSaving,
    error,
    notice,
    autoRegeneratePortrait,
    setAutoRegeneratePortrait,
    busy,
    hasApiKey,
    canApplyInstruction,
    canUndoDescription,
    handleApplyInstruction,
    handleUndoDescription,
    handleGeneratePortrait,
    handleSave,
  } = useCharacterEditorActions({ character, onClose });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, onClose]);

  // 描述解析：一句话简介取自 description（只存 summary）；
  // 完整设定以 details 为权威（结构化独立存储），无 details 时回落描述解析（旧数据/新建中）
  const parsedDescription = parseCharacterDescription(description);
  const summary = parsedDescription.summary ?? "";
  const detailsFieldRows = detailEntries(character?.details).map(([key, value]) => ({
    label: t(("assetField." + key) as TranslationKey),
    value,
  }));
  const detailFields =
    detailsFieldRows.length > 0 ? detailsFieldRows : parsedDescription.fields;
  const promptHint = isDerivingAppearance
    ? t("characters.deriving")
    : appearanceStale
      ? t("characters.deriveRetryOnSave")
      : t("characters.appearanceReadonly");

  return (
    <AssetDetailShell
      title={character ? t("assetEditor.editCharacter") : t("assetEditor.addCharacter")}
      backLabel={t("assetEditor.back")}
      onBack={onClose}
      backDisabled={busy}
      preview={(
        <AssetPreviewColumn
          label={t("characters.portrait")}
          imageUrl={portraitUrl || undefined}
          alt={name.trim() || t("assetEditor.unnamedCharacter")}
          generating={isGeneratingPortrait}
          onGenerate={() => void handleGeneratePortrait()}
          generateLabel={portraitUrl ? t("characters.regeneratePortrait") : t("characters.generatePortrait")}
          generateDisabled={busy || (!appearancePrompt.trim() && !description.trim()) || !hasApiKey}
          generateTitle={t("characters.generatePortrait")}
          generatingHint={t("wizard.generating")}
          autoRegenerate={{
            checked: autoRegeneratePortrait,
            onChange: setAutoRegeneratePortrait,
            label: t("characters.autoRegeneratePortrait"),
            disabled: busy,
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
          cancelDisabled={busy}
          saveLabel={t("assetEditor.saveCharacter")}
          onSave={() => void handleSave()}
          saveDisabled={!name.trim() || busy}
          saving={isSaving}
        />
      )}
    >
      <AssetNameField
        label={t("assetEditor.name")}
        value={name}
        placeholder={t("characters.namePlaceholder")}
        onChange={setName}
        disabled={busy}
      />
      <AssetSummaryBlock
        label={t("assetEditor.summary")}
        summary={summary}
        emptyHint={t("assetEditor.summaryEmpty")}
      />
      <AssetDetailsBlock
        label={t("characters.description")}
        fields={detailFields}
        rawText={description}
        emptyHint={t("characters.descriptionEmpty")}
      />
      <AssetPromptBlock
        label={t("assetEditor.prompt")}
        prompt={appearancePrompt}
        emptyHint={t("characters.appearanceEmpty")}
        hint={promptHint}
      />
      <AssetInstructionRow
        instruction={instruction}
        onInstructionChange={setInstruction}
        onApply={() => void handleApplyInstruction()}
        applying={isApplyingInstruction}
        canApply={canApplyInstruction}
        applyLabel={t("characters.applyInstruction")}
        applyingLabel={t("characters.applying")}
        placeholder={t("characters.instructionPlaceholder")}
        disabled={busy}
        onUndo={canUndoDescription ? handleUndoDescription : undefined}
        undoLabel={t("characters.undoDescription")}
      />
      <AssetEditorMessages notice={notice} error={error} />
    </AssetDetailShell>
  );
}
