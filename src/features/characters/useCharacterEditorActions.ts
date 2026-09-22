import { useCallback, useEffect, useRef, useState } from "react";
import {
  selectActiveProject,
  useProjectStore,
  type Asset,
} from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useT } from "@/i18n";
import { chatCompletion } from "@/services/chatService";
import { SYSTEM_PROMPT_CHARACTER_DESCRIPTION_ZH } from "@/lib/promptRules";
import { generateImage, aspectRatioToImageParams } from "@/services/imageService";
import { generateAssetNamespace, generateFullPrompt } from "@/lib/assetNamespace";
import {
  composePortraitPrompt,
  getStylePrompt,
  normalizeCharacterDescription,
  parseCharacterDescription,
} from "@/lib/promptComposer";
import {
  composeAssetAppearance,
  composeDetailsText,
  extractAssetSummary,
  mergeDetailsPreferDerived,
} from "@/lib/assetDetails";

interface UseCharacterEditorActionsProps {
  character: Asset | null;
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

/**
 * 角色编辑器的状态与业务动作。
 * 组件只负责展示统一编辑器模板；角色描述、英文提示词派生、定妆照生成和保存
 * 在这里保持同一条状态链，避免 UI 拆分后遗漏竞态守卫或兜底逻辑。
 */
export function useCharacterEditorActions({
  character,
  onClose,
}: UseCharacterEditorActionsProps) {
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
   * 外观提示词派生：由代码从中文设定拼装（零模型调用）。
   * AI 修改描述后的即时联动、保存兜底、定妆照生成前刷新共用同一派生链路。
   *
   * 2026-09-22 中文化改造：不再让模型另写一份英文 —— 品种等主体事实只保留在设定一处，
   * 派生只是翻译它的可视化子集，因此结构上不可能与设定自相矛盾。
   * desc 未带结构化字段（如刚打开编辑器）时并上已持久化 details，避免信息衰减。
   */
  const deriveAppearance = useCallback(
    (desc: string): string => {
      const normalized = normalizeCharacterDescription(desc);
      return composeAssetAppearance({
        type: "character",
        description: normalized,
        details: mergeDetailsPreferDerived(
          { type: "character", description: normalized },
          character?.details,
        ),
      });
    },
    [character],
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
          species: character?.details?.kind === "character" ? character.details.species : undefined,
          stylePrompt,
        });
        // 画幅与批量链路一致（项目画幅），避免手动重生成把定妆照规格改掉；
        // 随机 seed 保证每次重新生成效果不同
        const { size, ratio } = aspectRatioToImageParams(project?.aspectRatio ?? "1:1");
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

  // 结构化设定文本：description 只存一句话简介，AI 指令必须看到完整设定；
  // 若 description 本身已带字段行（AI 刚改写过、尚未保存），则不再附加旧 details
  const characterDetailsText =
    parseCharacterDescription(description).fields.length > 0
      ? ""
      : composeDetailsText(character?.details);

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
        // 即时联动：描述一变立刻按新设定重拼外观提示词（纯函数，不发请求）
        setIsDerivingAppearance(true);
        setAppearanceStale(true);
        const derived = deriveAppearance(next);
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
        const derived = deriveAppearance(trimmedDescription);
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

    try {
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
        const derived = deriveAppearance(trimmedDescription);
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
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  return {
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
    busy: isSaving || isApplyingInstruction || isDerivingAppearance || isGeneratingPortrait,
    hasApiKey: Boolean(providerConfig.apiKey),
    canApplyInstruction: Boolean(providerConfig.apiKey && providerConfig.baseUrl),
    canUndoDescription: descHistory.length > 0,
    handleApplyInstruction,
    handleUndoDescription,
    handleGeneratePortrait,
    handleSave,
  };
}
