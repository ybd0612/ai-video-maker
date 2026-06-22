// ────────────────────────────────────────────────────────────────────────────
// src/features/shots/DialogueEditor.tsx
// Dialogue line editor for drama mode — embedded in ShotEditor.
// ────────────────────────────────────────────────────────────────────────────

import { useProjectStore, selectActiveProject } from "@/stores/projectStore";
import { useT } from "@/i18n";
import { Plus, Trash2, MessageSquare } from "lucide-react";

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
  const characters = project?.characters ?? [];
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
        <label className="flex items-center gap-1 text-[11px] font-medium text-slate-500">
          <MessageSquare size={10} />
          {t("dialogue.title")} ({dialogues.length})
        </label>
        <button
          onClick={handleAdd}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-emerald-400 hover:bg-emerald-950/30 transition"
        >
          <Plus size={10} />
          {t("dialogue.add")}
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        {dialogues.map((line) => (
          <div
            key={line.id}
            className="rounded-md border border-slate-700/50 bg-slate-800/30 p-1.5"
          >
            {/* Character selector + delete */}
            <div className="mb-1 flex items-center justify-between">
              <select
                value={line.characterId ?? ""}
                onChange={(e) =>
                  updateDialogueLine(shotId, line.id, {
                    characterId: e.target.value || null,
                  })
                }
                className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300 focus:border-sky-500 focus:outline-none"
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
                className="rounded p-0.5 text-slate-600 hover:text-red-400"
              >
                <Trash2 size={10} />
              </button>
            </div>

            {/* Dialogue text */}
            <input
              type="text"
              value={line.text}
              onChange={(e) =>
                updateDialogueLine(shotId, line.id, { text: e.target.value })
              }
              placeholder={t("dialogue.textPlaceholder")}
              className="mb-1 w-full rounded border border-slate-700/50 bg-slate-900/50 px-2 py-1 text-[11px] text-slate-200 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
            />

            {/* Delivery hint */}
            <input
              type="text"
              value={line.delivery ?? ""}
              onChange={(e) =>
                updateDialogueLine(shotId, line.id, { delivery: e.target.value })
              }
              placeholder={t("dialogue.deliveryPlaceholder")}
              className="w-full rounded border border-slate-800 bg-transparent px-2 py-0.5 text-[10px] text-slate-500 placeholder:text-slate-700 focus:border-slate-600 focus:outline-none"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
