// ────────────────────────────────────────────────────────────────────────────
// src/features/characters/CharacterPanel.tsx
// Left panel tab: character management list for drama mode.
// ────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import { useProjectStore, selectActiveProject, type Asset } from "@/stores/projectStore";
import { useT } from "@/i18n";
import { UserPlus, Trash2 } from "lucide-react";
import { CharacterEditor } from "./CharacterEditor";
import { Lightbox } from "@/components/ui/Lightbox";

export function CharacterPanel() {
  const t = useT();
  const project = useProjectStore(selectActiveProject);
  const removeAsset = useProjectStore((s) => s.removeAsset);
  const [editingChar, setEditingChar] = useState<Asset | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  const characters = (project?.assets ?? []).filter((a) => a.type === "character");

  const handleAdd = () => {
    setEditingChar(null);
    setShowEditor(true);
  };

  const handleEdit = (char: Asset) => {
    setEditingChar(char);
    setShowEditor(true);
  };

  const handleDelete = (char: Asset) => {
    if (confirm(t("characters.deleteConfirm", { name: char.name }))) {
      removeAsset(char.id);
    }
  };

  const handleEditorClose = () => {
    setShowEditor(false);
    setEditingChar(null);
  };

  if (showEditor) {
    return <CharacterEditor character={editingChar} onClose={handleEditorClose} />;
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-400">
          {t("characters.title")} ({characters.length})
        </span>
        <button
          onClick={handleAdd}
          className="flex items-center gap-1 rounded px-2 py-1 text-[0.6875rem] text-emerald-400 hover:bg-emerald-950/30 transition"
        >
          <UserPlus size={11} />
          {t("characters.add")}
        </button>
      </div>

      {characters.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
          <UserPlus size={20} className="text-slate-700" />
          <p className="text-[0.6875rem] text-slate-600">{t("characters.noCharacters")}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {characters.map((char) => (
            <div
              key={char.id}
              role="button"
              tabIndex={0}
              onClick={() => handleEdit(char)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleEdit(char);
                }
              }}
              title={t("characters.edit")}
              className="group flex cursor-pointer items-start gap-2 rounded-md border border-slate-800 bg-slate-900/50 p-2 transition hover:border-slate-700 focus:border-emerald-500 focus:outline-none"
            >
              {/* Avatar（点击放大查看） */}
              <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full border border-slate-700 bg-slate-800">
                {(char.imageUrl || char.avatarUrl) ? (
                  <Lightbox src={char.imageUrl || char.avatarUrl} alt={char.name}>
                    <img
                      src={char.imageUrl || char.avatarUrl}
                      alt={char.name}
                      className="h-full w-full object-cover"
                    />
                  </Lightbox>
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[0.625rem] text-slate-500">
                    {char.name.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-slate-200">
                  {char.name}
                </p>
                <p className="truncate text-[0.625rem] text-slate-500">
                  {char.description || char.appearancePrompt || "—"}
                </p>
              </div>

              {/* Actions */}
              <div className="flex shrink-0 gap-0.5 opacity-0 transition group-hover:opacity-100">
                <button
                  onClick={(e) => {
                    // 阻止冒泡，避免点删除时同时触发卡片的「进入编辑」
                    e.stopPropagation();
                    handleDelete(char);
                  }}
                  className="rounded p-1 text-slate-500 hover:bg-red-950 hover:text-red-400"
                  title={t("characters.delete")}
                >
                  <Trash2 size={10} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
