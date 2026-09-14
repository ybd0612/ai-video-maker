import { useCallback, useState } from "react";
import { ArrowLeft, ImageIcon, Loader2, Sparkles, Undo2 } from "lucide-react";
import { useProjectStore, type Asset } from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useT } from "@/i18n";
import { chatCompletion } from "@/services/chatService";
import { SYSTEM_PROMPT_ASSET_EDIT_ZH } from "@/lib/promptRules";
import { Lightbox } from "@/components/ui/Lightbox";

interface AssetEditorProps {
  asset: Asset;
  onClose: () => void;
  onGenerate: (asset: Asset) => Promise<void>;
  generating: boolean;
}

function parseAsset(content: string): Pick<Asset, "name" | "description" | "prompt"> | null {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Partial<Asset>;
    if (typeof parsed.name !== "string" || typeof parsed.description !== "string" || typeof parsed.prompt !== "string") return null;
    return { name: parsed.name.trim(), description: parsed.description.trim(), prompt: parsed.prompt.trim() };
  } catch {
    return null;
  }
}

function assetLabel(type: Asset["type"]): string {
  if (type === "scene") return "场景";
  if (type === "product") return "主体 / 产品";
  return "道具 / 关键物件";
}

export function AssetEditor({ asset, onClose, onGenerate, generating }: AssetEditorProps) {
  const t = useT();
  const updateAsset = useProjectStore((s) => s.updateAsset);
  const providerConfig = useSettingsStore((s) => s.providerConfig);
  const [draft, setDraft] = useState({ name: asset.name, description: asset.description, prompt: asset.prompt });
  const [instruction, setInstruction] = useState("");
  const [history, setHistory] = useState<Array<typeof draft>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyInstruction = useCallback(async () => {
    if (busy || !providerConfig.apiKey || !providerConfig.baseUrl) return;
    setBusy(true);
    setError(null);
    try {
      const result = await chatCompletion({
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        temperature: 0.2,
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
      const next = parseAsset(result.content);
      if (!next) throw new Error(t("wizard.assetInvalidResponse" as any));
      setHistory((items) => [...items, draft]);
      setDraft(next);
      setInstruction("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [asset, busy, draft, instruction, providerConfig, t]);

  const save = () => {
    if (!draft.name.trim() || busy || generating) return;
    updateAsset(asset.id, draft);
    onClose();
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center gap-2">
        <button onClick={onClose} disabled={busy || generating} className="rounded p-1 text-ink-4 hover:bg-raised disabled:opacity-50" title={t("dialog.cancel")}>
          <ArrowLeft size={14} />
        </button>
        <span className="text-xs font-medium text-ink-2">编辑{assetLabel(asset.type)}</span>
      </div>

      <div className="flex flex-col gap-3 @md:flex-row">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="space-y-1">
            <label className="text-[0.6875rem] font-medium text-ink-4">名称</label>
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="w-full rounded-md border border-line bg-raised px-2 py-1.5 text-xs text-ink focus:border-accent focus:outline-none" />
          </div>
          <div className="space-y-1">
            <label className="text-[0.6875rem] font-medium text-ink-4">中文描述</label>
            <div className="whitespace-pre-wrap rounded-md border border-line bg-raised px-2 py-1.5 text-xs leading-relaxed text-ink select-text">{draft.description || "—"}</div>
          </div>
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

        <div className="flex flex-col gap-1 @md:w-2/5">
          <label className="text-[0.6875rem] font-medium text-ink-4">参考图</label>
          {asset.imageUrl ? <Lightbox src={asset.imageUrl} alt={asset.name}><div className="flex h-48 w-full items-center justify-center overflow-hidden rounded-lg border border-line bg-raised @md:h-56"><img src={asset.imageUrl} alt={asset.name} className="h-full w-full object-contain" /></div></Lightbox> : <div className="flex h-48 w-full items-center justify-center rounded-lg border border-dashed border-line text-ink-5 @md:h-56"><ImageIcon size={24} /></div>}
          <button onClick={() => void onGenerate({ ...asset, ...draft })} disabled={busy || generating || !draft.prompt.trim() || !providerConfig.apiKey} className="flex w-full items-center justify-center gap-1 rounded border border-line px-1.5 py-1 text-[0.625rem] text-accent hover:bg-accent-deep/30 disabled:opacity-50">
            {generating ? <Loader2 size={10} className="animate-spin" /> : <ImageIcon size={10} />}
            {asset.imageUrl ? "重新生成参考图" : "生成参考图"}
          </button>
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-line-soft pt-3">
        <button onClick={onClose} disabled={busy || generating} className="rounded-md border border-line px-3 py-1.5 text-xs text-ink-3 hover:bg-raised disabled:opacity-50">{t("dialog.cancel")}</button>
        <button onClick={save} disabled={busy || generating || !draft.name.trim()} className="rounded-md bg-success px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">保存资产</button>
      </div>
    </div>
  );
}
