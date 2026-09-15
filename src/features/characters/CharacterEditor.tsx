// ────────────────────────────────────────────────────────────────────────────
// src/features/characters/CharacterEditor.tsx
// Character editing form: 用户只编辑「名称」；角色描述（完整角色信息，中文）由 AI 经指令维护；
// 英文外貌提示词为派生物（AI 修改描述后即时重派生，保存时兜底），只读展示。
// 定妆照：默认勾选「AI 修改描述后自动重新生成」；未勾选时保留手动按钮。
// 任一 AI/生成请求进行中，编辑器内的 AI 修改 / 撤销 / 保存 / 定妆照按钮统一禁用（返回后恢复）。
// ────────────────────────────────────────────────────────────────────────────

import { useState, useCallback, useEffect, useRef } from "react";
import {
  useProjectStore,
  selectActiveProject,
  type Asset,
} from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useT, type TranslationKey } from "@/i18n";
import { chatCompletion } from "@/services/chatService";
import {
  SYSTEM_PROMPT_CHARACTER_DESCRIPTION_ZH,
  buildCharacterAppearancePrompt,
} from "@/lib/promptRules";
import { Lightbox } from "@/components/ui/Lightbox";
import { generateImage, aspectRatioToImageParams } from "@/services/imageService";
import { generateAssetNamespace, generateFullPrompt } from "@/lib/assetNamespace";
import {
  composePortraitPrompt,
  getStylePrompt,
  normalizeCharacterDescription,
  parseCharacterDescription,
} from "@/lib/promptComposer";
import { composeDetailsText, detailEntries, extractAssetSummary, mergeDetailsPreferDerived } from "@/lib/assetDetails";
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
  const project = useProjectStore(selectActiveProject);
  const providerConfig = useSettingsStore((s) => s.providerConfig);
  const autoRegeneratePortrait = useSettingsStore((s) => s.autoRegeneratePortrait);
  const setAutoRegeneratePortrait = useSettingsStore((s) => s.setAutoRegeneratePortrait);

  const [name, setName] = useState(character?.name ?? "");
  const [description, setDescription] = useState(() =>
    normalizeCharacterDescription(character?.description ?? ""),
  );
  // 英文外貌提示词是「角色描述」的派生物：AI 修改描述后即时重派生（失败则保存时兜底），用户不可编辑
  const [appearancePrompt, setAppearancePrompt] = useState(character?.appearancePrompt ?? "");
  // 当前英文是否与描述脱节（即时派生失败/中断时为 true，保存时自动兜底重派生）
  const [appearanceStale, setAppearanceStale] = useState(false);
  const [isDerivingAppearance, setIsDerivingAppearance] = useState(false);
  // 描述由 AI 维护（只读）：用户经指令输入框让 AI 修改；快照栈支持逐级撤销（描述 + 对应英文一并恢复）
  const [instruction, setInstruction] = useState("");
  const [descHistory, setDescHistory] = useState<Array<{ description: string; appearance: string }>>([]);
  // 竞态守卫：派生完成时校验描述是否已又被改动（撤销/再次 AI 修改），变了则丢弃过期结果
  const descriptionRef = useRef(description);
  useEffect(() => {
    descriptionRef.current = description;
  }, [description]);
  const [isApplyingInstruction, setIsApplyingInstruction] = useState(false);
  const [portraitUrl, setPortraitUrl] = useState(character?.imageUrl ?? "");
  const [isGeneratingPortrait, setIsGeneratingPortrait] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * 从中文描述派生英文外貌提示词（文本调用，不耗图片配额）。
   * AI 修改描述后的即时联动、保存兜底、定妆照生成前刷新共用同一派生链路。
   * 返回 null 表示派生失败（网络/内容过滤/空输出），由调用方决定兜底策略。
   */
  const deriveAppearance = useCallback(
    async (desc: string, charName: string): Promise<string | null> => {
      if (!desc.trim() || !providerConfig.apiKey || !providerConfig.baseUrl) return null;
      // description 只存一句话简介：desc 本身没有结构化字段时（如刚打开编辑器），
      // 派生输入必须并上结构化设定，否则信息严重衰减；desc 已带字段（AI 刚改写）则不并旧值
      const parsedDesc = parseCharacterDescription(desc);
      const detailsText =
        parsedDesc.fields.length > 0 ? "" : composeDetailsText(character?.details);
      try {
        const result = await chatCompletion({
          apiKey: providerConfig.apiKey,
          baseUrl: providerConfig.baseUrl,
          // 采样参数由模型按用途决定（外貌提示词是角色一致性锚点，不再是代码硬编码温度）
          purpose: "characterAppearance",
          paramContext: [
            "Task: derive an English appearance prompt for a character, used as the identity anchor across all shots.",
            "Consistency across repeated derivations matters.",
          ].join("\n"),
          messages: [
            { role: "system", content: buildCharacterAppearancePrompt() },
            {
              role: "user",
              content: [
                `Name: ${charName}`,
                `Description: ${desc.trim()}`,
                ...(detailsText ? [`Structured details:\n${detailsText}`] : []),
                "",
                "Write the appearance description for THIS subject. Keep its species/type exactly as given above.",
              ].join("\n"),
            },
          ],
        });
        return result.content.trim() || null;
      } catch (err) {
        console.error("Failed to derive appearance prompt:", err);
        return null;
      }
    },
    [providerConfig, character],
  );

  /**
   * 定妆照生成核心：用「已解析」的英文外貌提示词生图并写回资产。
   * 手动按钮（先按需派生英文）与自动链路（英文已就绪）共用同一生图与写回链路。
   * 自管 isGeneratingPortrait 状态：进入即置 true、返回即复位，供按钮禁用逻辑使用。
   */
  const generatePortraitFrom = useCallback(
    async (effectiveAppearance: string) => {
      if (!providerConfig.apiKey || !providerConfig.baseUrl) return;
      setIsGeneratingPortrait(true);
      setError(null);
      try {
        // 物种锁定拼装器（与批量链路一致）；风格由 stylePrompt 文本承载。
        // ⚠️ 2026-09-15：风格母版不再作为 i2i 参考图 —— 参考图内容会被整体复制
        // （实测：母版里的猫让定妆照变猫，抽象样张让定妆照背景变成样张板）。
        const stylePrompt = project ? getStylePrompt(project) : undefined;
        const prompt = composePortraitPrompt({
          appearancePrompt: effectiveAppearance,
          stylePrompt,
        });
        // 统一档位串参数（1K 档 + 1:1 画幅）；随机 seed 保证每次重新生成效果不同
        const { size, ratio } = aspectRatioToImageParams("1:1");
        const url = await generateImage({
          apiKey: providerConfig.apiKey,
          baseUrl: providerConfig.baseUrl,
          prompt,
          size,
          ratio,
          seed: randomSeed(),
        });
        // Save portrait to character（统一资产 imageUrl 字段）
        if (character) {
          updateAsset(character.id, { imageUrl: url });
        }
        setPortraitUrl(url);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsGeneratingPortrait(false);
      }
    },
    [providerConfig, project, character, updateAsset],
  );

  /**
   * 修改描述（描述只读，由 AI 维护的唯一入口）：
   * - 有指令：AI 把要求融合进当前描述
   * - 空指令：AI 根据角色名与现有描述生成/补全完整角色描述
   * 成功后即时联动：立刻按新描述重派生英文外貌提示词（失败不阻塞，保存时兜底）。
   * 勾选「自动重新生成定妆照」时：英文派生成功后继续自动生图，整条链路期间
   * 编辑器内相关按钮保持禁用，全部返回后才恢复。
   */
  // 结构化设定文本：description 只存一句话简介，AI 指令必须看到完整设定；
  // 若 description 本身已带字段行（AI 刚改写过、尚未保存），则不再附加旧 details
  const characterDetailsText =
    parseCharacterDescription(description).fields.length > 0
      ? ""
      : composeDetailsText(character?.details);
  const handleApplyInstruction = useCallback(async () => {
    const requirement = instruction.trim();
    if (isApplyingInstruction || !providerConfig.apiKey || !providerConfig.baseUrl) return;
    setIsApplyingInstruction(true);
    setError(null);
    setNotice(null);
    // 自动链路入参：竞态守卫通过且拿到新英文时记录，链路尾部决定是否自动生图
    let autoPortraitAppearance: string | null = null;
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
              ...(characterDetailsText
                ? [`当前设定（结构化，内容以此为准）：\n${characterDetailsText}`]
                : []),
              requirement
                ? `修改要求：${requirement}`
                : "修改要求：无——请根据角色名与现有描述，输出/补全为完整角色描述",
              "",
              "输出修改后的完整角色描述（保持既有结构：总述 + 8 要素；仅做要求涉及的改变，其余内容保持不变）。",
            ].join("\n"),
          },
        ],
      });
      const next = normalizeCharacterDescription(result.content);
      if (next && next !== description.trim()) {
        setDescHistory((h) => [...h, { description, appearance: appearancePrompt }]);
        setDescription(next);
        setInstruction("");
        // 即时联动：描述一变立刻重派生英文，界面同步刷新
        setIsDerivingAppearance(true);
        setAppearanceStale(true);
        const derived = await deriveAppearance(next, name.trim() || "（未命名）");
        // 竞态守卫：派生期间描述又被改动（撤销/再次 AI 修改）→ 丢弃过期结果
        if (descriptionRef.current === next) {
          if (derived) {
            setAppearancePrompt(derived);
            setAppearanceStale(false);
            autoPortraitAppearance = derived;
          } else if (useSettingsStore.getState().autoRegeneratePortrait) {
            // 派生失败：不沿用旧英文自动生图（只会误导），就地提示手动重试
            setNotice(t("characters.portraitAutoSkipped"));
          }
        }
      } else {
        setNotice(t("characters.instructionNoChange"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsApplyingInstruction(false);
      setIsDerivingAppearance(false);
    }
    // 自动重生成定妆照：勾选状态以当下 store 实时值为准（链路期间用户可能改主意）。
    // generatePortraitFrom 在首个 await 前同步置 isGeneratingPortrait=true，
    // 与 finally 里的复位同批渲染，busy 不会出现闪烁空窗。
    if (autoPortraitAppearance && useSettingsStore.getState().autoRegeneratePortrait) {
      await generatePortraitFrom(autoPortraitAppearance);
    }
  }, [instruction, isApplyingInstruction, providerConfig, name, description, characterDetailsText, appearancePrompt, deriveAppearance, generatePortraitFrom, t]);

  /** 撤销最近一次 AI 描述修改（逐级回退快照栈，描述与对应英文一并恢复） */
  const handleUndoDescription = useCallback(() => {
    if (descHistory.length === 0) return;
    const prev = descHistory[descHistory.length - 1];
    setDescription(prev.description);
    setAppearancePrompt(prev.appearance);
    setAppearanceStale(false);
    setDescHistory((h) => h.slice(0, -1));
  }, [descHistory]);

  /**
   * 手动重新生成定妆照：仅在英文外貌提示词为空或明确标记为过期时重新派生，
   * 否则直接复用当前已展示的英文提示词，避免同一次 AI 修改后的二次改写；
   * 生图与写回委托给 generatePortraitFrom。
   */
  const handleGeneratePortrait = useCallback(async () => {
    if (!providerConfig.apiKey || !providerConfig.baseUrl) return;
    const trimmedDescription = description.trim();
    // 可生成条件：有英文提示词，或描述非空（可现场派生）
    if (!appearancePrompt.trim() && !trimmedDescription) return;
    setIsGeneratingPortrait(true);
    setError(null);
    try {
      let effectiveAppearance = appearancePrompt.trim();
      // 只有英文派生物为空或明确标记为过期时才重新调用文本模型。
      // AI 修改成功后 appearancePrompt 已经是当前描述的最新派生物，不能再拿持久化角色的旧 description 比较，
      // 否则用户刚看到的新英文提示词会在点击“重新生成”时被无意义地二次改写。
      if ((appearanceStale || !effectiveAppearance) && trimmedDescription) {
        const derived = await deriveAppearance(trimmedDescription, name.trim() || "（未命名）");
        if (!derived) throw new Error(t("characters.portraitDeriveFailed"));
        effectiveAppearance = derived;
        setAppearancePrompt(derived);
        setAppearanceStale(false);
      }
      await generatePortraitFrom(effectiveAppearance);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsGeneratingPortrait(false);
    }
  }, [appearancePrompt, appearanceStale, description, providerConfig, name, deriveAppearance, generatePortraitFrom, t]);

  /**
   * Save：描述有变且英文尚未跟随（即时派生失败/跳过）→ 保存时兜底重派生（不耗图片配额）；
   * 即时派生已成功则直接沿用；未改动则沿用现有英文。派生失败不阻塞保存（提示保留原值）。
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

    if (
      trimmedDescription &&
      descriptionChanged &&
      appearanceStale &&
      providerConfig.apiKey &&
      providerConfig.baseUrl
    ) {
      const derived = await deriveAppearance(trimmedDescription, trimmedName);
      if (derived) {
        trimmedAppearance = derived;
        setAppearancePrompt(derived);
        setAppearanceStale(false);
      } else {
        // 派生失败不阻塞保存：保留原英文提示词，就地提示
        setNotice(t("characters.descDeriveFailed"));
      }
    }

    const namespace = generateAssetNamespace(trimmedName);
    const fullPrompt = generateFullPrompt({ name: trimmedName, appearancePrompt: trimmedAppearance });

    // description 只存一句话简介（SSOT：完整设定在 details）；
    // details 以「刚确认的描述」解析值优先、旧 details 补空 —— 保证 AI 指令的修改能落到结构化字段
    const nextDetails = mergeDetailsPreferDerived(
      { type: "character", description: trimmedDescription },
      character?.details,
    );

    const updates = {
      type: "character" as const,
      name: trimmedName,
      description: extractAssetSummary(trimmedDescription) || trimmedDescription,
      prompt: trimmedAppearance,
      appearancePrompt: trimmedAppearance,
      imageUrl: portraitUrl || undefined,
      assetNamespace: namespace,
      fullPrompt,
      details: nextDetails,
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

  // 任一 AI/生成请求进行中：统一禁用 AI 修改 / 撤销 / 保存 / 定妆照按钮，全部返回后恢复。
  // 覆盖自动链路全程（AI 改描述 → 派生英文 → 生成定妆照），避免中途操作产生竞态或重复计费。
  const busy = isApplyingInstruction || isDerivingAppearance || isGeneratingPortrait;

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
          generateDisabled={busy || (!appearancePrompt.trim() && !description.trim()) || !providerConfig.apiKey}
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
        labelWidth="w-14"
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
        canApply={Boolean(providerConfig.apiKey && providerConfig.baseUrl)}
        applyLabel={t("characters.applyInstruction")}
        applyingLabel={t("characters.applying")}
        placeholder={t("characters.instructionPlaceholder")}
        disabled={busy}
        onUndo={descHistory.length > 0 ? handleUndoDescription : undefined}
        undoLabel={t("characters.undoDescription")}
      />
      <AssetEditorMessages notice={notice} error={error} />
    </AssetDetailShell>
  );
}
