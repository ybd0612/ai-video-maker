// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/ShotDetail.tsx
// 分镜详情（步骤 3）：复用资产详情模板（AssetDetailShell 系列），
// 内容全部只读 —— 唯一修改入口是「交给 AI 修改」指令行（2026-09-16 定稿方案）。
// 说明：不使用 Draft + 保存，因为镜头内容由模型维护；指令改写结果就地写回 store，
// 撤销依赖本次会话的快照栈（与资产详情一致）。
// ────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import type { Asset, Shot } from "@/stores/projectStore";
import { useProjectStore } from "@/stores/projectStore";
import { useT, type TranslationKey } from "@/i18n";
import { pickShotFields } from "@/lib/shotFields";
import {
  AssetDetailShell,
  AssetDetailsBlock,
  AssetEditorFooter,
  AssetEditorMessages,
  AssetInstructionRow,
  AssetPromptBlock,
} from "./AssetEditorTemplate";

/** 结构化子字段的展示顺序（标签复用既有文案键，不新增重复文案） */
const SUB_FIELD_ROWS: Array<{ field: keyof Shot; label: TranslationKey }> = [
  { field: "sceneDesc", label: "wizard.promptScene" },
  { field: "detailDesc", label: "wizard.promptDetail" },
  { field: "lightingDesc", label: "wizard.promptLighting" },
  { field: "styleDesc", label: "wizard.promptStyle" },
  { field: "actionDesc", label: "wizard.promptAction" },
  { field: "cameraDesc", label: "wizard.promptCamera" },
  { field: "envChangeDesc", label: "wizard.promptEnvChange" },
  { field: "motionSpeedDesc", label: "wizard.promptMotionSpeed" },
  { field: "endStateDesc", label: "wizard.promptEndState" },
];

export interface ShotDetailProps {
  shot: Shot;
  assets: Asset[];
  onClose: () => void;
  /** 指令改写；返回是否成功（失败时保留用户输入便于重试） */
  onRevise: (instruction: string) => Promise<boolean>;
  onReroll: () => Promise<void>;
  hasApiKey: boolean;
}

/** 撤销用的内容快照：只含内容与引用字段，不含状态与生成产物 */
function contentSnapshot(shot: Shot): Partial<Shot> {
  return {
    ...pickShotFields(shot),
    dialogues: shot.dialogues,
    activeCharacterIds: shot.activeCharacterIds,
    activeProductIds: shot.activeProductIds,
    activePropIds: shot.activePropIds,
    activeSceneId: shot.activeSceneId,
  };
}

export function ShotDetail({ shot, assets, onClose, onRevise, onReroll, hasApiKey }: ShotDetailProps) {
  const t = useT();
  const updateShot = useProjectStore((s) => s.updateShot);
  const [instruction, setInstruction] = useState("");
  const [history, setHistory] = useState<Array<Partial<Shot>>>([]);
  const [busy, setBusy] = useState(false);

  // 与资产 / 角色 / 视觉方向编辑器一致：ESC 退回列表；在飞任务期间不关闭
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  // 生成中（本步改写 / 后续步骤产图产视频）一律关闭改写入口：避免覆盖在飞结果
  const generating =
    shot.status === "scripting" || shot.status === "imaging" || shot.status === "videoing";

  const nameOf = (id?: string): string | undefined =>
    id ? assets.find((asset) => asset.id === id)?.name ?? id : undefined;

  const referenceGroups = [
    { label: t("shot.characters"), names: shot.activeCharacterIds.map((id) => nameOf(id)) },
    { label: t("shot.scene"), names: (shot.activeSceneId ? [nameOf(shot.activeSceneId)] : []) },
    { label: t("shot.products"), names: shot.activeProductIds.map((id) => nameOf(id)) },
    { label: t("shot.props"), names: shot.activePropIds.map((id) => nameOf(id)) },
  ]
    .map((group) => ({
      label: group.label,
      names: group.names.filter((name): name is string => !!name),
    }))
    .filter((group) => group.names.length > 0);

  const fieldRows = SUB_FIELD_ROWS.map(({ field, label }) => ({
    label: t(label),
    value: (shot[field] as string | undefined) ?? "",
  }));
  const dialogueRows = shot.dialogues.map((line) => ({
    label: nameOf(line.characterId ?? undefined) || t("shot.unnamedAsset"),
    value: line.text,
  }));

  const applyInstruction = async () => {
    const text = instruction.trim();
    if (!text || busy || generating || !hasApiKey) return;
    const snapshot = contentSnapshot(shot);
    setBusy(true);
    try {
      const ok = await onRevise(text);
      if (ok) {
        setHistory((items) => [...items, snapshot]);
        setInstruction("");
      }
    } finally {
      setBusy(false);
    }
  };

  const undo = () => {
    const last = history[history.length - 1];
    if (!last || busy || generating) return;
    updateShot(shot.id, last);
    setHistory((items) => items.slice(0, -1));
  };

  return (
    <AssetDetailShell
      title={`${t("pipeline.shot")} ${shot.index + 1}`}
      backLabel={t("assetEditor.back")}
      onBack={onClose}
      backDisabled={busy}
      preview={(
        <>
          <p className="text-[0.6875rem] font-medium text-ink-4">
            {t("shotDetail.references")}
          </p>
          <div className="space-y-2 rounded-md border border-line-soft bg-surface p-2">
            {referenceGroups.length > 0 ? (
              referenceGroups.map((group) => (
                <div key={group.label} className="space-y-0.5">
                  <p className="text-[0.625rem] text-ink-5">{group.label}</p>
                  <p className="select-text text-xs text-ink">{group.names.join("、")}</p>
                </div>
              ))
            ) : (
              <p className="text-xs text-ink-5">{t("shotDetail.noReferences")}</p>
            )}
          </div>

          <div className="flex items-center justify-between rounded-md border border-line-soft bg-surface px-2 py-1.5">
            <span className="text-[0.6875rem] font-medium text-ink-4">
              {t("pipeline.duration")}
            </span>
            <span className="text-xs text-ink">{shot.duration}s</span>
          </div>
        </>
      )}
      footer={(
        <AssetEditorFooter
          cancelLabel={t("assetEditor.back")}
          onCancel={onClose}
          cancelDisabled={busy}
          saveLabel={t("shotDetail.regenerate")}
          onSave={() => void onReroll()}
          saveDisabled={busy || generating || !hasApiKey}
        />
      )}
    >
      <p className="rounded-md border border-line-soft bg-surface p-2 text-[0.6875rem] leading-relaxed text-ink-4">
        {t("shotDetail.hint")}
      </p>

      <AssetPromptBlock
        label={t("pipeline.scriptText")}
        prompt={shot.scriptText}
        emptyHint={t("assetEditor.promptEmpty")}
      />

      <AssetDetailsBlock
        label={t("assetEditor.details")}
        fields={fieldRows}
        emptyHint={t("assetEditor.detailsEmpty")}
      />

      <AssetPromptBlock
        label={t("pipeline.visualPrompt")}
        prompt={shot.visualPrompt}
        emptyHint={t("assetEditor.promptEmpty")}
      />

      <AssetPromptBlock
        label={t("pipeline.motionPrompt")}
        prompt={shot.motionPrompt}
        emptyHint={t("assetEditor.promptEmpty")}
      />

      <AssetDetailsBlock
        label={t("shotDetail.dialogue")}
        fields={dialogueRows}
        emptyHint={t("shotDetail.noDialogue")}
      />

      <AssetInstructionRow
        instruction={instruction}
        onInstructionChange={setInstruction}
        onApply={() => void applyInstruction()}
        applying={busy}
        canApply={Boolean(hasApiKey && instruction.trim())}
        applyLabel={t("assetEditor.apply")}
        applyingLabel={t("assetEditor.applying")}
        placeholder={t("shotDetail.instructionPlaceholder")}
        disabled={busy || generating}
        onUndo={history.length > 0 ? undo : undefined}
        undoLabel={t("assetEditor.undo")}
      />

      <AssetEditorMessages error={shot.error} />
    </AssetDetailShell>
  );
}
