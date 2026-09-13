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
import { Lightbox } from "@/components/ui/Lightbox";
import { generateImage, aspectRatioToImageParams } from "@/services/imageService";
import { generateAssetNamespace, generateFullPrompt } from "@/lib/assetNamespace";
import { composePortraitPrompt, parseCharacterDescription } from "@/lib/promptComposer";

interface CharacterEditorProps {
  character: Asset | null; // null = creating new
  onClose: () => void;
}

/**
 * 「重新生成」用随机种子。
 * ⚠️ 服务端校验 seed ∈ [-1, 999]（文档未写，实测 400 报错得知）；
 * 超出范围直接 400 invalid_request。取 0-999 随机即可破除结果趋同。
 */
function randomSeed(): number {
  return Math.floor(Math.random() * 1000);
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
  // 描述由 AI 维护（只读）：用户经指令输入框让 AI 修改；快照栈支持逐级撤销
  const [instruction, setInstruction] = useState("");
  const [descHistory, setDescHistory] = useState<string[]>([]);
  const [isApplyingInstruction, setIsApplyingInstruction] = useState(false);
  const [portraitUrl, setPortraitUrl] = useState(character?.imageUrl ?? "");
  const [isGeneratingPortrait, setIsGeneratingPortrait] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * 修改描述（描述只读，由 AI 维护的唯一入口）：
   * - 有指令：AI 把要求融合进当前描述
   * - 空指令：AI 根据角色名与现有描述生成/补全完整角色描述
   */
  const handleApplyInstruction = useCallback(async () => {
    const requirement = instruction.trim();
    if (isApplyingInstruction || !providerConfig.apiKey || !providerConfig.baseUrl) return;
    setIsApplyingInstruction(true);
    setError(null);
    setNotice(null);
    try {
      const result = await chatCompletion({
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        messages: [
          { role: "system", content: SYSTEM_PROMPT_CHARACTER_DESCRIPTION_ZH },
          {
            role: "user",
            content: [
              `角色名：${name.trim() || "（未命名）"}`,
              `当前描述：${description.trim() || "（暂无）"}`,
              requirement
                ? `修改要求：${requirement}`
                : "修改要求：无——请根据角色名与现有描述，输出/补全为完整角色描述",
              "",
              "输出修改后的完整角色描述（保持既有结构：总述 + 8 要素；仅做要求涉及的改变，其余内容保持不变）。",
            ].join("\n"),
          },
        ],
      });
      const next = result.content.trim();
      if (next && next !== description.trim()) {
        setDescHistory((h) => [...h, description]);
        setDescription(next);
        setInstruction("");
      } else {
        setNotice(t("characters.instructionNoChange"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsApplyingInstruction(false);
    }
  }, [instruction, isApplyingInstruction, providerConfig, name, description, t]);

  /** 撤销最近一次 AI 描述修改（逐级回退快照栈） */
  const handleUndoDescription = useCallback(() => {
    setDescHistory((h) => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      setDescription(prev);
      return h.slice(0, -1);
    });
  }, []);

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
    <div className="@container flex flex-col gap-3 p-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <button
          onClick={onClose}
          className="rounded p-1 text-ink-4 hover:bg-raised hover:text-ink-2"
        >
          <ArrowLeft size={14} />
        </button>
        <span className="text-xs font-medium text-ink-2">
          {character ? t("characters.edit") : t("characters.add")}
        </span>
      </div>

      {/* 主体：左列文字 / 右列定妆照（容器宽 <32rem 时回退上下布局，适配窄侧边栏） */}
      <div className="flex flex-col gap-3 @md:flex-row @md:items-start">
        {/* 左：名称 / 描述 / 外观提示词 */}
        <div className="min-w-0 flex-1 space-y-3">

      {/* Name（可编辑） */}
      <div className="space-y-1">
        <label className="text-[0.6875rem] font-medium text-ink-4">
          {t("characters.name")}
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("characters.namePlaceholder")}
          className="w-full rounded-md border border-line bg-raised px-2 py-1.5 text-xs text-ink placeholder:text-ink-5 focus:border-success focus:outline-none"
        />
      </div>

      {/* Description（只读：由 AI 维护；用户经指令输入框让 AI 修改） */}
      <div className="space-y-1">
        <label className="text-[0.6875rem] font-medium text-ink-4">
          {t("characters.description")}
        </label>
        {/* 完整中文角色描述（唯一事实源，只读展示；一行总述 + 8 要素分行，旧格式整段兜底） */}
        {(() => {
          const parsed = parseCharacterDescription(description);
          if (description.trim() === "") {
            return (
              <div className="w-full rounded-md border border-line bg-raised px-2 py-1.5 text-xs text-ink-5">
                {t("characters.descriptionEmpty")}
              </div>
            );
          }
          if (parsed && parsed.fields.length > 0) {
            return (
              <div className="w-full space-y-0.5 rounded-md border border-line bg-raised px-2 py-1.5 text-xs select-text">
                {parsed.summary && (
                  <p className="pb-1 leading-relaxed text-ink">{parsed.summary}</p>
                )}
                {parsed.fields.map(({ label, value }) => (
                  <div key={label} className="flex gap-1.5 leading-relaxed">
                    <span className="w-12 shrink-0 font-medium text-ink-3">{label}</span>
                    <span className="min-w-0 flex-1 text-ink">{value}</span>
                  </div>
                ))}
              </div>
            );
          }
          return (
            <div className="w-full whitespace-pre-wrap rounded-md border border-line bg-raised px-2 py-1.5 text-xs leading-relaxed text-ink select-text">
              {description}
            </div>
          );
        })()}
        <p className="text-[0.625rem] text-ink-5">{t("characters.descriptionReadonlyHint")}</p>

        {/* 指令输入框 + 修改描述（AI 融合要求） + 撤销 */}
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void handleApplyInstruction();
              }
            }}
            placeholder={t("characters.instructionPlaceholder")}
            className="min-w-0 flex-1 rounded-md border border-line bg-raised px-2 py-1.5 text-xs text-ink placeholder:text-ink-5 focus:border-success focus:outline-none"
          />
          <button
            onClick={handleApplyInstruction}
            disabled={
              isApplyingInstruction || !providerConfig.apiKey || !providerConfig.baseUrl
            }
            className="flex shrink-0 items-center gap-1 rounded-md bg-success px-2 py-1.5 text-[0.6875rem] font-medium text-white transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            title={t("characters.applyInstruction")}
          >
            {isApplyingInstruction ? (
              <Loader2 size={10} className="animate-spin" />
            ) : (
              <Sparkles size={10} />
            )}
            {isApplyingInstruction ? t("characters.applying") : t("characters.applyInstruction")}
          </button>
          {descHistory.length > 0 && (
            <button
              onClick={handleUndoDescription}
              className="shrink-0 rounded-md border border-line px-2 py-1.5 text-[0.6875rem] text-ink-3 transition hover:bg-raised"
              title={t("characters.undoDescription")}
            >
              {t("characters.undoDescription")}
            </button>
          )}
        </div>
      </div>

      {/* Appearance prompt（只读展示：由角色描述自动派生） */}
      <div className="space-y-1">
        <label className="text-[0.6875rem] font-medium text-ink-4">
          {t("characters.appearance")}
        </label>
        <div
          className="w-full rounded-md border border-line/60 bg-raised/50 px-2 py-1.5 text-xs text-ink-3 select-text"
          title={t("characters.appearanceReadonly")}
        >
          {appearancePrompt.trim() || t("characters.appearanceEmpty")}
        </div>
        <p className="text-[0.625rem] text-ink-5">{t("characters.appearanceReadonly")}</p>
      </div>

        </div>

        {/* 右：定妆照（放大展示：宽度随右列撑满，约 2 倍于旧版 80px；生成按钮移至照片下方） */}
        <div className="space-y-1 @md:w-40 @md:shrink-0">
          <label className="text-[0.6875rem] font-medium text-ink-4">
            {t("characters.portrait")}
          </label>
          {portraitUrl ? (
            <Lightbox src={portraitUrl} alt={t("characters.portrait")}>
              <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-line bg-raised">
                <img
                  src={portraitUrl}
                  alt={t("characters.portrait")}
                  className="h-full w-full object-cover"
                />
              </div>
            </Lightbox>
          ) : (
            <div className="flex aspect-square w-full items-center justify-center rounded-lg border border-dashed border-line text-ink-5">
              <ImageIcon size={24} />
            </div>
          )}
          <button
            onClick={handleGeneratePortrait}
            disabled={isGeneratingPortrait || !appearancePrompt.trim() || !providerConfig.apiKey}
            className="flex w-full items-center justify-center gap-1 rounded border border-line px-1.5 py-1 text-[0.625rem] text-accent transition hover:bg-accent-deep/30 disabled:opacity-50"
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
          {isGeneratingPortrait && (
            <p className="text-[0.625rem] text-success animate-pulse">
              {t("wizard.generating") || "生成中..."}
            </p>
          )}
        </div>
      </div>

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={!name.trim() || isSaving}
        className="mt-2 rounded-md bg-success-solid px-4 py-2 text-xs font-medium text-white transition hover:bg-success-solid disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isSaving ? t("characters.saving") : character ? t("characters.edit") : t("characters.add")}
      </button>

      {/* Notice（非阻断提示，如派生失败保留原值） */}
      {notice && (
        <div className="rounded-md border border-warn bg-warn-deep/30 p-2 text-[0.6875rem] text-warn">
          {notice}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-md border border-danger bg-danger-deep/30 p-2 text-[0.6875rem] text-danger">
          {error}
        </div>
      )}
    </div>
  );
}
