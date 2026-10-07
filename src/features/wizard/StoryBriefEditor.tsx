// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/StoryBriefEditor.tsx
// Step 2: 故事骨架查看 / 编辑（第一步「故事骨架提取」的产物）。
// 与视觉方向同级 —— 同属项目级设定而非资产，故复用 AssetDetailShell 这一套
// 详情外壳（项目铁律：详情编辑只有一套模板），但故事层字段可改（视觉方向六维只读）。
// ────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";
import { useProjectStore, selectActiveProject, type StoryBrief } from "@/stores/projectStore";
import { useT, type TranslationKey } from "@/i18n";
import {
  AssetDetailShell,
  AssetDetailsBlock,
  AssetEditorFooter,
  AssetNameField,
} from "./AssetEditorTemplate";

interface StoryBriefEditorProps {
  onClose: () => void;
}

/** 七个故事字段的展示顺序（key 与 StoryBrief 一致） */
const BRIEF_FIELDS: Array<keyof Omit<StoryBrief, "revision">> = [
  "logline",
  "theme",
  "emotionArc",
  "audience",
  "durationPlan",
  "beats",
  "consistencyNotes",
];

export function StoryBriefEditor({ onClose }: StoryBriefEditorProps) {
  const t = useT();
  const project = useProjectStore(selectActiveProject);
  const updateStoryBrief = useProjectStore((s) => s.updateStoryBrief);
  const brief = project?.storyBrief;

  // 草稿：以现有骨架为初值；缺省给出全空骨架（修法：部分字段补建，不丢用户已填内容）
  const [draft, setDraft] = useState<Omit<StoryBrief, "revision">>(() => ({
    logline: brief?.logline ?? "",
    theme: brief?.theme ?? "",
    emotionArc: brief?.emotionArc ?? "",
    audience: brief?.audience ?? "",
    durationPlan: brief?.durationPlan ?? "",
    beats: brief?.beats ?? "",
    consistencyNotes: brief?.consistencyNotes ?? "",
  }));

  // 切换项目时重新取初值（编辑器随步骤 2 挂载，跨项目切换会复用同一组件实例）
  useEffect(() => {
    setDraft({
      logline: brief?.logline ?? "",
      theme: brief?.theme ?? "",
      emotionArc: brief?.emotionArc ?? "",
      audience: brief?.audience ?? "",
      durationPlan: brief?.durationPlan ?? "",
      beats: brief?.beats ?? "",
      consistencyNotes: brief?.consistencyNotes ?? "",
    });
    // 仅按项目 id 重置，避免编辑过程中草稿被 store 回写冲掉
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleSave = useCallback(() => {
    updateStoryBrief(draft);
    onClose();
  }, [draft, onClose, updateStoryBrief]);

  if (!project) return <div className="p-3 text-xs text-ink-4">{t("wizard.storyBriefUnset")}</div>;

  // 故事层没有配图（不像视觉方向有风格母版、不像资产有参考图）；
  // 右列放「这份骨架会如何被下游使用」的说明，避免留空。
  const previewColumn = (
    <div className="space-y-2 rounded-2xl border border-line-soft bg-surface p-3">
      <p className="text-xs font-semibold text-ink-2">{t("wizard.storyBriefTitle")}</p>
      <p className="text-[0.6875rem] leading-relaxed text-ink-4">{t("wizard.storyBriefDownstreamHint")}</p>
    </div>
  );

  return (
    <AssetDetailShell
      title={t("wizard.storyBriefTitle")}
      backLabel={t("assetEditor.back")}
      onBack={onClose}
      preview={previewColumn}
      footer={(
        <AssetEditorFooter
          cancelLabel={t("dialog.cancel")}
          onCancel={onClose}
          saveLabel={t("wizard.saveStoryBrief")}
          onSave={handleSave}
        />
      )}
    >
      {!brief && (
        <p className="rounded-md border border-warn/50 bg-warn-deep/20 px-2 py-1.5 text-[0.6875rem] text-warn/90">
          {t("wizard.storyBriefUnset")}
        </p>
      )}
      {/* 一句话梗概：独立输入框（它是故事层最核心的一句，值得单列） */}
      <AssetNameField
        label={t("storyBrief.logline")}
        value={draft.logline}
        onChange={(value) => setDraft({ ...draft, logline: value })}
      />
      <AssetDetailsBlock
        label={t("wizard.storyBriefContent")}
        fields={BRIEF_FIELDS.filter((key) => key !== "logline").map((key) => ({
          label: t(("storyBrief." + key) as TranslationKey),
          value: draft[key],
        }))}
        emptyHint={t("wizard.storyBriefUnset")}
      />
      {/* 骨架改动会让分镜失效并回到未审核，这里明确告知因果 */}
      <p className="text-[0.625rem] text-ink-5">{t("wizard.storyBriefEditHint")}</p>
    </AssetDetailShell>
  );
}
