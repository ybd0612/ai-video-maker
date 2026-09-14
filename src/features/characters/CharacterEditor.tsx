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
import {
  composePortraitPrompt,
  getStylePrompt,
  getStyleReferenceUrl,
  normalizeCharacterDescription,
  parseCharacterDescription,
} from "@/lib/promptComposer";

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
      try {
        const result = await chatCompletion({
          apiKey: providerConfig.apiKey,
          baseUrl: providerConfig.baseUrl,
          // 外貌提示词是角色一致性锚点：降低随机性，避免同一描述每次派生出不同英文。
          temperature: 0.2,
          messages: [
            { role: "system", content: buildCharacterAppearancePrompt() },
            {
              role: "user",
              content: [
                `Name: ${charName}`,
                `Description: ${desc.trim()}`,
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
    [providerConfig],
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
        // 物种锁定拼装器（与批量链路一致）；同时继承项目级视觉方向，
        // 让手动生成与批量生成的角色定妆照使用同一套风格约束与参考图。
        const stylePrompt = project ? getStylePrompt(project) : undefined;
        const styleReferenceUrl = project ? getStyleReferenceUrl(project) : undefined;
        const prompt = composePortraitPrompt({
          appearancePrompt: effectiveAppearance,
          stylePrompt,
        });
        // 统一档位串参数（1K 档 + 1:1 画幅）；随机 seed 保证每次重新生成效果不同
        const { size, ratio } = aspectRatioToImageParams("1:1");
        const url = await generateImage({
          apiKey: providerConfig.apiKey,
          baseUrl: providerConfig.baseUrl,
          prompt: styleReferenceUrl
            ? `Match the art style, color palette and lighting mood of the reference image; do not copy its content or composition. ${prompt}`
            : prompt,
          size,
          ratio,
          seed: randomSeed(),
          ...(styleReferenceUrl ? { referenceImageUrls: [styleReferenceUrl] } : {}),
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
  }, [instruction, isApplyingInstruction, providerConfig, name, description, appearancePrompt, deriveAppearance, generatePortraitFrom, t]);

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

  // 任一 AI/生成请求进行中：统一禁用 AI 修改 / 撤销 / 保存 / 定妆照按钮，全部返回后恢复。
  // 覆盖自动链路全程（AI 改描述 → 派生英文 → 生成定妆照），避免中途操作产生竞态或重复计费。
  const busy = isApplyingInstruction || isDerivingAppearance || isGeneratingPortrait;

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

      {/* 主体：左列文字(3) / 右列定妆照(2) ≈ 6:4，右列高度 stretch 撑满与左列齐平（容器宽 <32rem 时回退上下布局，适配窄侧边栏） */}
      <div className="flex flex-col gap-3 @md:flex-row @md:items-stretch">
        {/* 左：名称 / 描述 / 外观提示词 */}
        <div className="min-w-0 flex-1 space-y-3 @md:flex-[3_1_0%]">

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
              busy || !providerConfig.apiKey || !providerConfig.baseUrl
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
              disabled={busy}
              className="shrink-0 rounded-md border border-line px-2 py-1.5 text-[0.6875rem] text-ink-3 transition hover:bg-raised disabled:opacity-50 disabled:cursor-not-allowed"
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
        <p className="text-[0.625rem] text-ink-5">
          {isDerivingAppearance
            ? t("characters.deriving")
            : appearanceStale
              ? t("characters.deriveRetryOnSave")
              : t("characters.appearanceReadonly")}
        </p>
      </div>

        </div>

        {/* 右：定妆照（与左列等高的弹性列，宽度占比 2/5；生成按钮移至照片下方） */}
        <div className="flex flex-col gap-1 @md:flex-[2_1_0%]">
          <label className="shrink-0 text-[0.6875rem] font-medium text-ink-4">
            {t("characters.portrait")}
          </label>
          {portraitUrl ? (
            <div className="h-48 w-full @md:h-56">
              <Lightbox src={portraitUrl} alt={t("characters.portrait")}>
                <div className="relative h-full w-full overflow-hidden rounded-lg border border-line bg-raised">
                  <img
                    src={portraitUrl}
                    alt={t("characters.portrait")}
                    className="h-full w-full object-contain"
                  />
                </div>
              </Lightbox>
            </div>
          ) : (
            <div className="flex aspect-square w-full items-center justify-center rounded-lg border border-dashed border-line text-ink-5 @md:aspect-auto @md:min-h-0 @md:flex-1">
              <ImageIcon size={24} />
            </div>
          )}
          <button
            onClick={handleGeneratePortrait}
            disabled={
              busy ||
              (!appearancePrompt.trim() && !description.trim()) ||
              !providerConfig.apiKey
            }
            className="flex w-full shrink-0 items-center justify-center gap-1 rounded border border-line px-1.5 py-1 text-[0.625rem] text-accent transition hover:bg-accent-deep/30 disabled:opacity-50 disabled:cursor-not-allowed"
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
            <p className="shrink-0 text-[0.625rem] text-success animate-pulse">
              {t("wizard.generating") || "生成中..."}
            </p>
          )}
          {/* 自动重生成开关：勾选后 AI 修改描述成功即自动重生成定妆照（默认勾选，持久化到设置） */}
          <label
            className={`flex shrink-0 select-none items-center gap-1.5 text-[0.625rem] text-ink-3 ${
              busy ? "cursor-not-allowed opacity-60" : "cursor-pointer"
            }`}
            title={t("characters.autoRegenerateHint")}
          >
            <input
              type="checkbox"
              checked={autoRegeneratePortrait}
              disabled={busy}
              onChange={(e) => setAutoRegeneratePortrait(e.target.checked)}
              className="h-3 w-3 accent-success"
            />
            {t("characters.autoRegeneratePortrait")}
          </label>
        </div>
      </div>

      {/* Save button（AI/生成请求期间一并禁用：描述未定稿、定妆照与 imageUrl 存在竞态） */}
      <button
        onClick={handleSave}
        disabled={!name.trim() || busy}
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
