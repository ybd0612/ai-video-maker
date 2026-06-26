// ────────────────────────────────────────────────────────────────────────────
// src/features/characters/CharacterEditor.tsx
// Character editing form: name, description, appearance, avatar.
// ────────────────────────────────────────────────────────────────────────────

import { useState, useCallback } from "react";
import { useProjectStore, type Character } from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useT } from "@/i18n";
import { ArrowLeft, Sparkles, Loader2, RefreshCw, ImageIcon } from "lucide-react";
import { chatCompletion, SYSTEM_PROMPT_CHARACTER } from "@/services/chatService";
import { generateImage } from "@/services/imageService";
import { generateAssetNamespace, generateFullPrompt } from "@/lib/assetNamespace";

interface CharacterEditorProps {
  character: Character | null; // null = creating new
  onClose: () => void;
}

export function CharacterEditor({ character, onClose }: CharacterEditorProps) {
  const t = useT();
  const addCharacter = useProjectStore((s) => s.addCharacter);
  const updateCharacter = useProjectStore((s) => s.updateCharacter);
  const providerConfig = useSettingsStore((s) => s.providerConfig);

  const [name, setName] = useState(character?.name ?? "");
  const [description, setDescription] = useState(character?.description ?? "");
  const [appearancePrompt, setAppearancePrompt] = useState(character?.appearancePrompt ?? "");
  const [avatarUrl, setAvatarUrl] = useState(character?.avatarUrl ?? "");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingPortrait, setIsGeneratingPortrait] = useState(false);

  /** Generate a portrait image from the appearance prompt */
  const handleGeneratePortrait = useCallback(async () => {
    if (!appearancePrompt.trim() || !providerConfig.apiKey || !providerConfig.baseUrl) return;
    setIsGeneratingPortrait(true);
    try {
      const portraitUrl = await generateImage({
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        prompt: `Portrait photo of ${appearancePrompt.trim()}, facing camera, clean background, high quality, detailed facial features, photorealistic, professional, all-ages appropriate`,
        size: "1024x1024",
      });
      // Save portrait to character
      if (character) {
        updateCharacter(character.id, { generatedPortraitUrl: portraitUrl });
      }
      // Store for new character creation
      setGeneratedPortraitUrl(portraitUrl);
    } catch {
      // Silent fail — user can retry
    } finally {
      setIsGeneratingPortrait(false);
    }
  }, [appearancePrompt, providerConfig, character, updateCharacter]);

  const [generatedPortraitUrl, setGeneratedPortraitUrl] = useState(
    character?.generatedPortraitUrl ?? "",
  );

  const handleSave = () => {
    if (!name.trim()) return;

    const trimmedName = name.trim();
    const trimmedAppearance = appearancePrompt.trim();
    const namespace = generateAssetNamespace(trimmedName);
    const fullPrompt = generateFullPrompt({ name: trimmedName, appearancePrompt: trimmedAppearance });

    const updates = {
      name: trimmedName,
      description: description.trim(),
      appearancePrompt: trimmedAppearance,
      avatarUrl: avatarUrl.trim() || undefined,
      generatedPortraitUrl: generatedPortraitUrl || undefined,
      assetNamespace: namespace,
      fullPrompt,
    };

    if (character) {
      updateCharacter(character.id, updates);
    } else {
      addCharacter(updates);
    }
    onClose();
  };

  const handleAiGenerate = useCallback(async () => {
    if (!providerConfig.apiKey || !providerConfig.baseUrl) return;
    setIsGenerating(true);
    try {
      const descHint = description.trim()
        ? `Based on this character description: ${description}`
        : "Create a detailed character appearance for a short drama character.";

      const result = await chatCompletion({
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        messages: [
          { role: "system", content: SYSTEM_PROMPT_CHARACTER },
          { role: "user", content: descHint },
        ],
      });
      setAppearancePrompt(result.content);
    } catch {
      // Silently fail — user can retry
    } finally {
      setIsGenerating(false);
    }
  }, [providerConfig, description]);

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

      {/* Name */}
      <div className="space-y-1">
        <label className="text-[11px] font-medium text-slate-500">
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

      {/* Description */}
      <div className="space-y-1">
        <label className="text-[11px] font-medium text-slate-500">
          {t("characters.description")}
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("characters.descriptionPlaceholder")}
          rows={2}
          className="w-full resize-none rounded-md border border-slate-700 bg-slate-800 p-2 text-xs text-slate-100 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
        />
      </div>

      {/* Appearance */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-medium text-slate-500">
            {t("characters.appearance")}
          </label>
          <button
            onClick={handleAiGenerate}
            disabled={isGenerating || !providerConfig.apiKey}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-emerald-400 hover:bg-emerald-950/30 transition disabled:opacity-50"
            title={t("characters.aiGenerate")}
          >
            {isGenerating ? (
              <Loader2 size={10} className="animate-spin" />
            ) : (
              <Sparkles size={10} />
            )}
            {t("characters.aiGenerate")}
          </button>
        </div>
        <textarea
          value={appearancePrompt}
          onChange={(e) => setAppearancePrompt(e.target.value)}
          placeholder={t("characters.appearancePlaceholder")}
          rows={3}
          className="w-full resize-none rounded-md border border-slate-700 bg-slate-800 p-2 text-xs text-slate-100 placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
        />
      </div>

      {/* Portrait Preview + Generate */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-medium text-slate-500">
            {t("characters.portrait")}
          </label>
          <button
            onClick={handleGeneratePortrait}
            disabled={isGeneratingPortrait || !appearancePrompt.trim() || !providerConfig.apiKey}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-violet-400 hover:bg-violet-950/30 transition disabled:opacity-50"
            title={t("characters.generatePortrait")}
          >
            {isGeneratingPortrait ? (
              <Loader2 size={10} className="animate-spin" />
            ) : generatedPortraitUrl ? (
              <RefreshCw size={10} />
            ) : (
              <ImageIcon size={10} />
            )}
            {generatedPortraitUrl
              ? t("characters.regeneratePortrait")
              : t("characters.generatePortrait")}
          </button>
        </div>
        {generatedPortraitUrl ? (
          <div className="relative w-20 h-20 rounded-lg overflow-hidden border border-slate-700">
            <img
              src={generatedPortraitUrl}
              alt="定妆照"
              className="h-full w-full object-cover"
            />
          </div>
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-lg border border-dashed border-slate-700 text-slate-600">
            <ImageIcon size={20} />
          </div>
        )}
        {isGeneratingPortrait && (
          <p className="text-[10px] text-emerald-400 animate-pulse">
            {t("wizard.generating") || "生成中..."}
          </p>
        )}
      </div>

      {/* Avatar URL (manual override) */}
      <div className="space-y-1">
        <label className="text-[11px] font-medium text-slate-500">
          {t("characters.avatar")}
        </label>
        <input
          type="text"
          value={avatarUrl}
          onChange={(e) => setAvatarUrl(e.target.value)}
          placeholder={t("characters.avatarPlaceholder")}
          className="w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
        />
      </div>

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={!name.trim()}
        className="mt-2 rounded-md bg-emerald-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {character ? t("characters.edit") : t("characters.add")}
      </button>
    </div>
  );
}
