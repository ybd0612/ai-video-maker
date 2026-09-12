// ────────────────────────────────────────────────────────────────────────────
// src/features/shots/DialogueEditor.tsx
// Dialogue line editor for drama mode — embedded in ShotEditor.
// ────────────────────────────────────────────────────────────────────────────

import { useProjectStore, selectActiveProject } from "@/stores/projectStore";
import { useT } from "@/i18n";
import { Plus, Trash2, MessageSquare } from "lucide-react";
import { AiPolishField } from "@/components/ui/AiPolishField";
import { SYSTEM_PROMPT_DIALOGUE } from "@/services/chatService";

interface DialogueEditorProps {
  shotId: string;
}

export function DialogueEditor({ shotId }: DialogueEditorProps) {
  const t = useT();
  const project = useProjectStore(selectActiveProject);
  const addDialogueLine = useProjectStore((s) => s.addDialogueLine);
  const updateDialogueLine = useProjectStore((s) => s.updateDialogueLine);
  const removeDialogueLine = useProjectStore((s) => s.removeDialogueLine);

  const shot = project?.shots.find((s) => s.id === shotId);
  const characters = (project?.assets ?? []).filter((a) => a.type === "character");
  const dialogues = shot?.dialogues ?? [];

  const handleAdd = () => {
    addDialogueLine(shotId, {
      characterId: null,
      text: "",
      delivery: "",
    });
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-1 text-[0.6875rem] font-medium text-ink-4">
          <MessageSquare size={10} />
          {t("dialogue.title")} ({dialogues.length})
        </label>
        <button
          onClick={handleAdd}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.625rem] text-success hover:bg-success-deep/30 transition"
        >
          <Plus size={10} />
          {t("dialogue.add")}
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        {dialogues.map((line) => {
          // 渲染兜底：历史数据中可能残留无效 characterId（模型自编 ID），
          // 归一为旁白展示，避免 select 显示空白，用户可重新选择角色。
          const selectValue =
            line.characterId && characters.some((c) => c.id === line.characterId)
              ? line.characterId
              : "";
          return (
            <div
              key={line.id}
              className="rounded-md border border-line/50 bg-raised/30 p-1.5"
            >
              {/* Character selector + delete */}
              <div className="mb-1 flex items-center justify-between">
                <select
                  value={selectValue}
                  onChange={(e) =>
                    updateDialogueLine(shotId, line.id, {
                      characterId: e.target.value || null,
                    })
                  }
                  className="rounded border border-line bg-raised px-1.5 py-0.5 text-[0.625rem] text-ink-2 focus:border-info focus:outline-none"
                >
                  <option value="">{t("dialogue.narrator")}</option>
                  {characters.map((char) => (
                    <option key={char.id} value={char.id}>
                      {char.name}
                    </option>
                  ))}
                </select>
              <button
                onClick={() => removeDialogueLine(shotId, line.id)}
                className="rounded p-0.5 text-ink-5 hover:text-danger"
              >
                <Trash2 size={10} />
              </button>
            </div>

            {/* Dialogue text（框内润色 / 撤销） */}
            <div className="mb-1">
              <AiPolishField
                value={line.text}
                onChange={(v) => updateDialogueLine(shotId, line.id, { text: v })}
                systemPrompt={SYSTEM_PROMPT_DIALOGUE}
                resetKey={`${shotId}:${line.id}`}
                placeholder={t("dialogue.textPlaceholder")}
                singleLine
                appearanceClass="rounded border border-line/50 bg-surface/50 text-[0.6875rem] text-ink placeholder:text-ink-5"
                focusClass="focus:border-info"
              />
            </div>

            {/* Delivery hint */}
            <input
              type="text"
              value={line.delivery ?? ""}
              onChange={(e) =>
                updateDialogueLine(shotId, line.id, { delivery: e.target.value })
              }
              placeholder={t("dialogue.deliveryPlaceholder")}
              className="w-full rounded border border-line-soft bg-transparent px-2 py-0.5 text-[0.625rem] text-ink-4 placeholder:text-ink-5 focus:border-line-strong focus:outline-none"
            />
          </div>
          );
        })}
      </div>
    </div>
  );
}
