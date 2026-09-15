import { useCallback, useEffect, useState } from "react";
import { ImageIcon, Loader2, Sparkles, Undo2 } from "lucide-react";
import { useProjectStore, type Asset } from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useT } from "@/i18n";
import { chatCompletion } from "@/services/chatService";
import { SYSTEM_PROMPT_ASSET_EDIT_ZH } from "@/lib/promptRules";
import { createDefaultAssetDetails } from "@/lib/assetDetails";
import type { AssetDetails } from "@/stores/projectStore";
import { Lightbox } from "@/components/ui/Lightbox";
import { AssetDetailLayout, AssetPreviewFrame } from "./AssetDetailLayout";

interface AssetEditorProps {
  asset: Asset;
  onClose: () => void;
  onGenerate: (asset: Asset) => Promise<void>;
  generating: boolean;
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

function assetLabel(type: Asset["type"]): string {
  if (type === "scene") return "场景";
  if (type === "product") return "主体 / 产品";
  return "道具 / 关键物件";
}

const detailLabels: Record<string, string> = {
  species: "物种", role: "身份", age: "年龄阶段", personality: "性格与行为倾向", appearance: "外貌与比例", outfit: "服饰与配饰", signature: "跨镜头识别特征", background: "背景与角色关系",
  settingType: "空间类型", environment: "地理与环境", time: "时间", weather: "天气", elements: "主要元素", spatialLayers: "空间层次", lighting: "光线方向与质量", paletteMood: "色彩与氛围", storyUse: "剧情用途",
  category: "产品类型", purpose: "核心用途", silhouette: "整体轮廓", dimensions: "尺寸与比例", color: "颜色", material: "材质", structure: "结构组成", surfaceDetails: "表面细节", branding: "品牌或 Logo", usageState: "使用状态",
  storyRole: "故事作用", objectType: "物件类型", shape: "整体形状", wear: "磨损与使用痕迹", usage: "镜头中的使用方式",
};

function detailEntries(details: AssetDetails | undefined): Array<[string, string]> {
  if (!details) return [];
  return Object.entries(details).filter(([key]) => key !== "kind") as Array<[string, string]>;
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
          { role: "system", content: SYSTEM_PROMPT_ASSET_EDIT_ZH },
          {
            role: "user",
            content: [
              `资产类型：${assetLabel(asset.type)}`,
              `当前资产：${JSON.stringify(draft)}`,
              `修改要求：${instruction.trim() || "请补全并优化当前资产描述和英文绘图提示词。"}`,
              "只返回修改后的完整 JSON。",
            ].join("\n"),
          },
        ],
      });
      const next = parseAsset(result.content, draft.details);
      if (!next) throw new Error(t("wizard.assetInvalidResponse" as any));
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
  }, [asset, autoRegenerateAssetImages, busy, draft, instruction, onGenerate, providerConfig, t]);

  const save = () => {
    if (!draft.name.trim() || busy || generating) return;
    updateAsset(asset.id, draft);
    onClose();
  };

  return (
    <AssetDetailLayout
      title={`编辑${assetLabel(asset.type)}`}
      onBack={onClose}
      backDisabled={busy || generating}
      preview={(
        <>
          <label className="text-[0.6875rem] font-medium text-ink-4">参考图</label>
          {asset.imageUrl ? <Lightbox src={asset.imageUrl} alt={asset.name}><AssetPreviewFrame><img src={asset.imageUrl} alt={asset.name} className="h-full w-full object-contain" /></AssetPreviewFrame></Lightbox> : <AssetPreviewFrame><ImageIcon size={24} className="text-ink-5" /></AssetPreviewFrame>}
          <button onClick={() => void onGenerate({ ...asset, ...draft })} disabled={busy || generating || !draft.prompt.trim() || !providerConfig.apiKey} className="flex w-full items-center justify-center gap-1 rounded border border-line px-1.5 py-1 text-[0.625rem] text-accent hover:bg-accent-deep/30 disabled:opacity-50">
            {generating ? <Loader2 size={10} className="animate-spin" /> : <ImageIcon size={10} />}
            {asset.imageUrl ? "重新生成参考图" : "生成参考图"}
          </button>
          <label className="flex select-none items-center gap-1.5 text-[0.625rem] text-ink-3">
            <input type="checkbox" checked={autoRegenerateAssetImages} onChange={(event) => useSettingsStore.getState().setAutoRegenerateAssetImages(event.target.checked)} disabled={busy || generating} className="h-3 w-3 accent-accent" />
            编辑后自动生成图片
          </label>
        </>
      )}
      footer={(
        <div className="flex justify-end gap-2 border-t border-line-soft pt-3">
          <button onClick={onClose} disabled={busy || generating} className="rounded-md border border-line px-3 py-1.5 text-xs text-ink-3 hover:bg-raised disabled:opacity-50">{t("dialog.cancel")}</button>
          <button onClick={save} disabled={busy || generating || !draft.name.trim()} className="rounded-md bg-success px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">保存资产</button>
        </div>
      )}
    >
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-[0.6875rem] font-medium text-ink-4">名称</label>
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="w-full rounded-md border border-line bg-raised px-2 py-1.5 text-xs text-ink focus:border-accent focus:outline-none" />
          </div>
          <div className="space-y-1">
            <label className="text-[0.6875rem] font-medium text-ink-4">一句话定位</label>
            <div className="w-full rounded-md border border-line bg-raised px-2 py-1.5 text-xs leading-relaxed text-ink select-text">
              {draft.description || "—"}
            </div>
          </div>
          {draft.details && (
            <div className="space-y-2 rounded-md border border-line-soft bg-surface p-2">
              <label className="text-[0.6875rem] font-medium text-ink-4">完整设定</label>
              <div className="space-y-1.5 rounded-md border border-line bg-raised px-2 py-1.5 text-xs leading-relaxed">
                {detailEntries(draft.details).map(([key, value]) => (
                  <div key={key} className="flex gap-2">
                    <span className="w-20 shrink-0 font-medium text-ink-3">{detailLabels[key] ?? key}</span>
                    <span className="min-w-0 flex-1 whitespace-pre-wrap text-ink select-text">{value || "—"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-1">
            <label className="text-[0.6875rem] font-medium text-ink-4">英文绘图提示词</label>
            <div className="whitespace-pre-wrap rounded-md border border-line bg-raised px-2 py-1.5 text-xs leading-relaxed text-ink-2 select-text">{draft.prompt || "—"}</div>
          </div>
          <p className="text-[0.625rem] text-ink-5">描述和绘图提示词由 AI 统一维护，请通过下方指令修改。</p>
          <div className="flex items-center gap-1.5">
            <input
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); void applyInstruction(); } }}
              placeholder="告诉 AI 怎么改，如：把场景改成夜晚，并增加蓝色月光"
              disabled={busy || generating}
              className="min-w-0 flex-1 rounded-md border border-line bg-raised px-2 py-1.5 text-xs text-ink placeholder:text-ink-5 focus:border-accent focus:outline-none disabled:opacity-50"
            />
            <button onClick={() => void applyInstruction()} disabled={busy || generating || !providerConfig.apiKey || !providerConfig.baseUrl} className="flex shrink-0 items-center gap-1 rounded-md bg-accent px-2 py-1.5 text-[0.6875rem] font-medium text-white hover:opacity-90 disabled:opacity-50" title="让 AI 修改资产">
              {busy ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
              {busy ? "修改中" : "修改资产"}
            </button>
            {history.length > 0 && <button onClick={() => { setDraft(history[history.length - 1]); setHistory((items) => items.slice(0, -1)); }} disabled={busy || generating} className="shrink-0 rounded-md border border-line px-2 py-1.5 text-[0.6875rem] text-ink-3 hover:bg-raised disabled:opacity-50" title="撤销修改"><Undo2 size={11} /></button>}
          </div>
          {error && <p className="text-[0.625rem] text-danger">{error}</p>}
        </div>
    </AssetDetailLayout>
  );
}
