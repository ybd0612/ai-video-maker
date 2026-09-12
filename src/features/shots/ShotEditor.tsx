// ────────────────────────────────────────────────────────────────────────────
// src/features/shots/ShotEditor.tsx
// Right panel: edit the selected shot's script text and visual prompt.
// ────────────────────────────────────────────────────────────────────────────

import { useProjectStore, selectActiveProject, type Shot } from "@/stores/projectStore";
import { useT } from "@/i18n";
import { RefreshCw, X, RotateCcw, Users } from "lucide-react";
import { DialogueEditor } from "./DialogueEditor";
import { AiPolishField } from "@/components/ui/AiPolishField";
import {
  SYSTEM_PROMPT_SCRIPT_TEXT,
  SYSTEM_PROMPT_VISUAL_PROMPT,
  SYSTEM_PROMPT_MOTION_PROMPT,
} from "@/services/chatService";

interface ShotEditorProps {
  shot: Shot | null;
  onClose: () => void;
  onRegenerateImage: (shotId: string) => void;
  onRegenerateVideo: (shotId: string) => void;
}

export function ShotEditor({
  shot,
  onClose,
  onRegenerateImage,
  onRegenerateVideo,
}: ShotEditorProps) {
  const updateShot = useProjectStore((s) => s.updateShot);
  const setActiveCharacters = useProjectStore((s) => s.setActiveCharacters);
  const project = useProjectStore(selectActiveProject);
  const t = useT();
  const characters = (project?.assets ?? []).filter((a) => a.type === "character");

  if (!shot) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <p className="text-xs text-slate-600 text-center">
          {t("pipeline.selectShot")}
        </p>
      </div>
    );
  }

  const isFailed = shot.status === "failed";

  return (
    <div className="flex flex-col gap-3 overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-200">
          {t("pipeline.shot")} {shot.index + 1}
        </h3>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
          <X size={14} />
        </button>
      </div>

      {/* Character selector (both modes) */}
      {characters.length > 0 && (
        <div className="space-y-1.5">
          <label className="flex items-center gap-1 text-[11px] font-medium text-slate-500">
            <Users size={10} />
            {t("shot.characters")}
          </label>
          <div className="flex flex-wrap gap-1">
            {characters.map((char) => {
              const isActive = shot.activeCharacterIds.includes(char.id);
              return (
                <button
                  key={char.id}
                  onClick={() => {
                    const newIds = isActive
                      ? shot.activeCharacterIds.filter((id) => id !== char.id)
                      : [...shot.activeCharacterIds, char.id];
                    setActiveCharacters(shot.id, newIds);
                  }}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition ${
                    isActive
                      ? "bg-emerald-900/50 text-emerald-300 border border-emerald-700"
                      : "bg-slate-800 text-slate-500 border border-slate-700 hover:border-slate-600"
                  }`}
                >
                  {char.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {characters.length > 0 && (
        <DialogueEditor shotId={shot.id} />
      )}

      {/* Script text */}
      <div className="space-y-1">
        <label className="text-[11px] font-medium text-slate-500">
          {t("pipeline.scriptText")}
        </label>
        <AiPolishField
          value={shot.scriptText}
          onChange={(v) => updateShot(shot.id, { scriptText: v })}
          systemPrompt={SYSTEM_PROMPT_SCRIPT_TEXT}
          resetKey={shot.id}
          rows={3}
          focusClass="focus:border-sky-500"
        />
      </div>

      {/* Visual prompt (text-to-image) */}
      <div className="space-y-1">
        <label className="text-[11px] font-medium text-slate-500">
          {t("pipeline.visualPrompt")}
        </label>
        <AiPolishField
          value={shot.visualPrompt}
          onChange={(v) => updateShot(shot.id, { visualPrompt: v })}
          systemPrompt={SYSTEM_PROMPT_VISUAL_PROMPT}
          resetKey={shot.id}
          rows={3}
          focusClass="focus:border-violet-500"
        />
      </div>

      {/* Motion prompt (image-to-video) */}
      <div className="space-y-1">
        <label className="text-[11px] font-medium text-slate-500">
          {t("pipeline.motionPrompt")}
        </label>
        <AiPolishField
          value={shot.motionPrompt}
          onChange={(v) => updateShot(shot.id, { motionPrompt: v })}
          systemPrompt={SYSTEM_PROMPT_MOTION_PROMPT}
          resetKey={shot.id}
          rows={3}
          focusClass="focus:border-amber-500"
        />
      </div>

      {/* Duration */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-medium text-slate-500">
            {t("pipeline.duration")}
          </label>
          <span className="text-[10px] text-emerald-600">
            ≈{(shot.duration ?? 5) * 15}s
          </span>
        </div>
        <select
          value={shot.duration}
          onChange={(e) => updateShot(shot.id, { duration: parseInt(e.target.value) })}
          className="w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-300 focus:border-amber-500 focus:outline-none"
        >
          <option value={4}>4s</option>
          <option value={5}>5s</option>
          <option value={8}>8s</option>
        </select>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-2 pt-2">
        {/* Retry button for failed shots */}
        {isFailed && (
          <button
            onClick={() => {
              updateShot(shot.id, { status: "idle", error: undefined, videoProgress: undefined });
            }}
            className="flex items-center justify-center gap-1.5 rounded-md border border-red-700 bg-red-950/30 px-3 py-1.5 text-xs text-red-300 transition hover:bg-red-900/40 disabled:opacity-50"
          >
            <RotateCcw size={11} />
            {t("pipeline.retryShot")}
          </button>
        )}

        <button
          onClick={() => onRegenerateImage(shot.id)}
          disabled={shot.status === "imaging"}
          className="flex items-center justify-center gap-1.5 rounded-md border border-violet-700 bg-violet-950/30 px-3 py-1.5 text-xs text-violet-300 transition hover:bg-violet-900/40 disabled:opacity-50"
        >
          <RefreshCw size={11} />
          {t("pipeline.regenerateImage")}
        </button>
        <button
          onClick={() => onRegenerateVideo(shot.id)}
          disabled={shot.status === "videoing" || !shot.imageUrl}
          className="flex items-center justify-center gap-1.5 rounded-md border border-amber-700 bg-amber-950/30 px-3 py-1.5 text-xs text-amber-300 transition hover:bg-amber-900/40 disabled:opacity-50"
        >
          <RefreshCw size={11} />
          {t("pipeline.regenerateVideo")}
        </button>
      </div>

      {/* Error */}
      {shot.error && (
        <div className="rounded-md border border-red-800 bg-red-950/30 p-2 text-[11px] text-red-300">
          {shot.error}
        </div>
      )}
    </div>
  );
}
