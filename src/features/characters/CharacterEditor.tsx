// ────────────────────────────────────────────────────────────────────────────
// src/features/characters/CharacterEditor.tsx
// Character editing form: 用户只编辑「名称」和「角色描述」（完整角色信息，中文）；
// 英文外貌提示词为派生物（保存时自动派生），只读展示；定妆照手动按钮生成。
// ────────────────────────────────────────────────────────────────────────────

import { useState, useCallback } from "react";
import { useProjectStore, type Asset } from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useT } from "@/i18n";
import { ArrowLeft, Sparkles, Loader2, RefreshCw, ImageIcon } from "lucide-react";
import { chatCompletion } from "@/services/chatService";
import {
  SYSTEM_PROMPT_CHARACTER_DESCRIPTION_ZH,
  buildCharacterAppearancePrompt,
} from "@/lib/promptRules";
import { AiPolishField } from "@/components/ui/AiPolishField";
import { Lightbox } from "@/components/ui/Lightbox";
import { generateImage, aspectRatioToImageParams } from "@/services/imageService";
import { generateAssetNamespace, generateFullPrompt } from "@/lib/assetNamespace";
import { composePortraitPrompt } from "@/lib/promptComposer";

interface CharacterEditorProps {
  character: Asset | null; // null = creating new
  onClose: () => void;
}

/** 「重新生成」用随机种子：实测同 seed 同 prompt 输出字节级一致，随机 seed 破除结果趋同 */
function randomSeed(): number {
  return Math.floor(Math.random() * 2147483647);
}

export function CharacterEditor({ character, onClose }: CharacterEditorProps) {
  const t = useT();
  const addAsset = useProjectStore((s) => s.addAsset);
  const updateAsset = useProjectStore((s) => s.updateAsset);
  const providerConfig = useSettingsStore((s) => s.providerConfig);

  const [name, setName] = useState(character?.name ?? "");
  const [description, setDescription] = useState(character?.description ?? "");
  // 英文外貌提示词是「角色描述」的派生物：保存时若描述有变则自动重派生，用户不可编辑
  const [appearancePrompt, setAppearancePrompt] = useState(character?.appearancePrompt ?? "");
  const [portraitUrl, setPortraitUrl] = useState(character?.imageUrl ?? "");
  const [isGeneratingDescription, setIsGeneratingDescription] = useState(false);
  const [isGeneratingPortrait, setIsGeneratingPortrait] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** AI 生成/补全「完整中文角色描述」（6 要素：物种开头 / 身份 / 性格 / 外貌 / 服饰 / 记忆点） */
  const handleAiGenerateDescription = useCallback(async () => {
    if (!providerConfig.apiKey || !providerConfig.baseUrl || !name.trim()) return;
    setIsGeneratingDescription(true);
    setError(null);
    try {
      const result = await chatCompletion({
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        messages: [
          { role: "system", content: SYSTEM_PROMPT_CHARACTER_DESCRIPTION_ZH },
          {
            role: "user",
            content: [
              `角色名：${name.trim()}`,
              `现有描述：${description.trim() || "（暂无，请根据角色名补全完整描述）"}`,
            ].join("\n"),
          },
        ],
      });
      setDescription(result.content.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsGeneratingDescription(false);
    }
  }, [providerConfig, name, description]);

  /** Generate a portrait image from the derived appearance prompt（手动按钮，非自动） */
  const handleGeneratePortrait = useCallback(async () => {
    if (!appearancePrompt.trim() || !providerConfig.apiKey || !providerConfig.baseUrl) return;
    setIsGeneratingPortrait(true);
    setError(null);
    try {
      // 物种锁定拼装器（与批量链路一致）；替换旧版 "Portrait photo of ... photorealistic" 人像语汇
      const prompt = composePortraitPrompt({ appearancePrompt: appearancePrompt.trim() });
      // 统一档位串参数（1K 档 + 1:1 画幅）；随机 seed 保证每次重新生成效果不同
      const { size, ratio } = aspectRatioToImageParams("1:1");
      const portraitUrl = await generateImage({
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        prompt,
        size,
        ratio,
        seed: randomSeed(),
      });
      // Save portrait to character（统一资产 imageUrl 字段）
      if (character) {
        updateAsset(character.id, { imageUrl: portraitUrl });
      }
      setPortraitUrl(portraitUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsGeneratingPortrait(false);
    }
  }, [appearancePrompt, providerConfig, character, updateAsset]);

  /**
   * Save：描述有变 → 先自动派生英文外貌提示词（文本调用，不耗图片配额）再入库；
   * 派生失败不阻塞保存（保留原英文并提示）。未改动则沿用现有英文。
   */
  const handleSave = async () => {
    if (!name.trim() || isSaving) return;
    setIsSaving(true);
    setError(null);
    setNotice(null);

    const trimmedName = name.trim();
    const trimmedDescription = description.trim();
    let trimmedAppearance = appearancePrompt.trim();
    const descriptionChanged =
      !character || trimmedDescription !== (character.description ?? "").trim();

    if (trimmedDescription && descriptionChanged && providerConfig.apiKey && providerConfig.baseUrl) {
      try {
        const result = await chatCompletion({
          apiKey: providerConfig.apiKey,
          baseUrl: providerConfig.baseUrl,
          messages: [
            { role: "system", content: buildCharacterAppearancePrompt() },
            {
              role: "user",
              content: [
                `Name: ${trimmedName}`,
                `Description: ${trimmedDescription}`,
                "",
                "Write the appearance description for THIS subject. Keep its species/type exactly as given above.",
              ].join("\n"),
            },
          ],
        });
        const derived = result.content.trim();
        if (derived) {
          trimmedAppearance = derived;
          setAppearancePrompt(derived);
        }
      } catch (err) {
        // 派生失败不阻塞保存：保留原英文提示词，就地提示
        setNotice(t("characters.descDeriveFailed"));
        console.error("Failed to derive appearance prompt:", err);
      }
    }

    const namespace = generateAssetNamespace(trimmedName);
    const fullPrompt = generateFullPrompt({ name: trimmedName, appearancePrompt: trimmedAppearance });

    const updates = {
      type: "character" as const,
      name: trimmedName,
      description: trimmedDescription,
      prompt: trimmedAppearance,
      appearancePrompt: trimmedAppearance,
      imageUrl: portraitUrl || undefined,
      assetNamespace: namespace,
      fullPrompt,
    };
    if (character) {
      // avatarUrl 已不在编辑器暴露：保存时沿用原值，避免误清
      updateAsset(character.id, { ...updates, avatarUrl: character.avatarUrl });
    } else {
      addAsset({ ...updates, avatarUrl: undefined });
    }
    setIsSaving(false);
    onClose();
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <button
          onClick={onClose}
          className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
        >
          <ArrowLeft size={14} />
        </button>
        <span className="text-xs font-medium text-slate-300">
          {character ? t("characters.edit") : t("characters.add")}
        </span>
      </div>

      {/* Name（可编辑） */}
      <div className="space-y-1">
        <label className="text-[0.6875rem] font-medium text-slate-500">
          {t("characters.name")}
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("characters.namePlaceholder")}
          className="w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
        />
      </div>

      {/* Description（可编辑 + AI 生成完整描述） */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-[0.6875rem] font-medium text-slate-500">
            {t("characters.description")}
          </label>
          <button
            onClick={handleAiGenerateDescription}
            disabled={isGeneratingDescription || !providerConfig.apiKey || !name.trim()}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.625rem] text-emerald-400 hover:bg-emerald-950/30 transition disabled:opacity-50"
            title={t("characters.aiGenerateDescription")}
          >
            {isGeneratingDescription ? (
              <Loader2 size={10} className="animate-spin" />
            ) : (
              <Sparkles size={10} />
            )}
            {t("characters.aiGenerateDescription")}
          </button>
        </div>
        <AiPolishField
          value={description}
          onChange={setDescription}
          systemPrompt={SYSTEM_PROMPT_CHARACTER_DESCRIPTION_ZH}
          resetKey={character?.id ?? "new"}
          placeholder={t("characters.descriptionPlaceholder")}
          rows={3}
        />
        <p className="text-[0.625rem] text-slate-600">{t("characters.descriptionHint")}</p>
      </div>

      {/* Appearance prompt（只读展示：由角色描述自动派生） */}
      <div className="space-y-1">
        <label className="text-[0.6875rem] font-medium text-slate-500">
          {t("characters.appearance")}
        </label>
        <div
          className="w-full rounded-md border border-slate-700/60 bg-slate-800/50 px-2 py-1.5 text-xs text-slate-400 select-text"
          title={t("characters.appearanceReadonly")}
        >
          {appearancePrompt.trim() || t("characters.appearanceEmpty")}
        </div>
        <p className="text-[0.625rem] text-slate-600">{t("characters.appearanceReadonly")}</p>
      </div>

      {/* Portrait Preview + Generate（手动按钮；图片可点击放大） */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-[0.6875rem] font-medium text-slate-500">
            {t("characters.portrait")}
          </label>
          <button
            onClick={handleGeneratePortrait}
            disabled={isGeneratingPortrait || !appearancePrompt.trim() || !providerConfig.apiKey}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.625rem] text-violet-400 hover:bg-violet-950/30 transition disabled:opacity-50"
            title={t("characters.generatePortrait")}
          >
            {isGeneratingPortrait ? (
              <Loader2 size={10} className="animate-spin" />
            ) : portraitUrl ? (
              <RefreshCw size={10} />
            ) : (
              <ImageIcon size={10} />
            )}
            {portraitUrl ? t("characters.regeneratePortrait") : t("characters.generatePortrait")}
          </button>
        </div>
        {portraitUrl ? (
          <Lightbox src={portraitUrl} alt={t("characters.portrait")}>
            <div className="relative h-20 w-20 overflow-hidden rounded-lg border border-slate-700">
              <img
                src={portraitUrl}
                alt={t("characters.portrait")}
                className="h-full w-full object-cover"
              />
            </div>
          </Lightbox>
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-lg border border-dashed border-slate-700 text-slate-600">
            <ImageIcon size={20} />
          </div>
        )}
        {isGeneratingPortrait && (
          <p className="text-[0.625rem] text-emerald-400 animate-pulse">
            {t("wizard.generating") || "生成中..."}
          </p>
        )}
      </div>

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={!name.trim() || isSaving}
        className="mt-2 rounded-md bg-emerald-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isSaving ? t("characters.saving") : character ? t("characters.edit") : t("characters.add")}
      </button>

      {/* Notice（非阻断提示，如派生失败保留原值） */}
      {notice && (
        <div className="rounded-md border border-amber-800 bg-amber-950/30 p-2 text-[0.6875rem] text-amber-300">
          {notice}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-md border border-red-800 bg-red-950/30 p-2 text-[0.6875rem] text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}
