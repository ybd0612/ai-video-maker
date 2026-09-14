// ────────────────────────────────────────────────────────────────────────────
// src/features/shots/ShotEditor.tsx
// Right panel: edit the selected shot's script text and visual prompt.
// ────────────────────────────────────────────────────────────────────────────

import type { ReactNode } from "react";
import { useProjectStore, selectActiveProject, type Asset, type Shot } from "@/stores/projectStore";
import { useT } from "@/i18n";
import { RefreshCw, X, RotateCcw, Users, MapPin, Package, KeyRound } from "lucide-react";
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
  const setActiveScene = useProjectStore((s) => s.setActiveScene);
  const setActiveProducts = useProjectStore((s) => s.setActiveProducts);
  const setActiveProps = useProjectStore((s) => s.setActiveProps);
  const project = useProjectStore(selectActiveProject);
  const t = useT();
  const assets = project?.assets ?? [];
  const characters = assets.filter((a) => a.type === "character");
  const scenes = assets.filter((a) => a.type === "scene");
  const products = assets.filter((a) => a.type === "product");
  const props = assets.filter((a) => a.type === "prop");

  if (!shot) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <p className="text-center text-xs text-ink-5">
          {t("pipeline.selectShot")}
        </p>
      </div>
    );
  }

  const isFailed = shot.status === "failed";

  return (
    <div className="flex flex-col gap-3 overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">
          {t("pipeline.shot")} {shot.index + 1}
        </h3>
        <button onClick={onClose} className="text-ink-4 hover:text-ink-2">
          <X size={14} />
        </button>
      </div>

      {characters.length > 0 && (
        <AssetToggleGroup
          icon={<Users size={10} />}
          label={t("shot.characters")}
          assets={characters}
          activeIds={shot.activeCharacterIds}
          onChange={(ids) => setActiveCharacters(shot.id, ids)}
          emptyLabel={t("shot.unnamedAsset")}
        />
      )}

      {scenes.length > 0 && (
        <div className="space-y-1.5">
          <label className="flex items-center gap-1 text-[0.6875rem] font-medium text-ink-4">
            <MapPin size={10} />
            {t("shot.scene")}
          </label>
          <select
            value={shot.activeSceneId ?? ""}
            onChange={(e) => setActiveScene(shot.id, e.target.value || undefined)}
            className="w-full rounded-md border border-line bg-raised px-2 py-1.5 text-xs text-ink-2 focus:border-info focus:outline-none"
          >
            <option value="">{t("shot.noScene")}</option>
            {scenes.map((scene) => (
              <option key={scene.id} value={scene.id}>
                {scene.name || t("shot.unnamedAsset")}
              </option>
            ))}
          </select>
        </div>
      )}

      {products.length > 0 && (
        <AssetToggleGroup
          icon={<Package size={10} />}
          label={t("shot.products")}
          assets={products}
          activeIds={shot.activeProductIds}
          onChange={(ids) => setActiveProducts(shot.id, ids)}
          emptyLabel={t("shot.unnamedAsset")}
        />
      )}

      {props.length > 0 && (
        <AssetToggleGroup
          icon={<KeyRound size={10} />}
          label={t("shot.props")}
          assets={props}
          activeIds={shot.activePropIds ?? []}
          onChange={(ids) => setActiveProps(shot.id, ids)}
          emptyLabel={t("shot.unnamedAsset")}
        />
      )}

      {characters.length > 0 && <DialogueEditor shotId={shot.id} />}

      <div className="space-y-1">
        <label className="text-[0.6875rem] font-medium text-ink-4">
          {t("pipeline.scriptText")}
        </label>
        <AiPolishField
          value={shot.scriptText}
          onChange={(v) => updateShot(shot.id, { scriptText: v })}
          systemPrompt={SYSTEM_PROMPT_SCRIPT_TEXT}
          resetKey={shot.id}
          rows={3}
          focusClass="focus:border-info"
        />
      </div>

      <div className="space-y-1">
        <label className="text-[0.6875rem] font-medium text-ink-4">
          {t("pipeline.visualPrompt")}
        </label>
        <AiPolishField
          value={shot.visualPrompt}
          onChange={(v) => updateShot(shot.id, { visualPrompt: v })}
          systemPrompt={SYSTEM_PROMPT_VISUAL_PROMPT}
          resetKey={shot.id}
          rows={3}
          focusClass="focus:border-accent"
        />
      </div>

      <div className="space-y-1">
        <label className="text-[0.6875rem] font-medium text-ink-4">
          {t("pipeline.motionPrompt")}
        </label>
        <AiPolishField
          value={shot.motionPrompt}
          onChange={(v) => updateShot(shot.id, { motionPrompt: v })}
          systemPrompt={SYSTEM_PROMPT_MOTION_PROMPT}
          resetKey={shot.id}
          rows={3}
          focusClass="focus:border-warn"
        />
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-[0.6875rem] font-medium text-ink-4">
            {t("pipeline.duration")}
          </label>
          <span className="text-[0.625rem] text-success">
            ≈{(shot.duration ?? 5) * 15}s
          </span>
        </div>
        <select
          value={shot.duration}
          onChange={(e) => updateShot(shot.id, { duration: parseInt(e.target.value) })}
          className="w-full rounded-md border border-line bg-raised px-2 py-1.5 text-xs text-ink-2 focus:border-warn focus:outline-none"
        >
          <option value={4}>4s</option>
          <option value={5}>5s</option>
          <option value={8}>8s</option>
        </select>
      </div>

      <div className="flex flex-col gap-2 pt-2">
        {isFailed && (
          <button
            onClick={() => {
              updateShot(shot.id, { status: "idle", error: undefined, videoProgress: undefined });
            }}
            className="flex items-center justify-center gap-1.5 rounded-md border border-danger bg-danger-deep/30 px-3 py-1.5 text-xs text-danger transition hover:bg-danger-deep/40 disabled:opacity-50"
          >
            <RotateCcw size={11} />
            {t("pipeline.retryShot")}
          </button>
        )}

        <button
          onClick={() => onRegenerateImage(shot.id)}
          disabled={shot.status === "imaging"}
          className="flex items-center justify-center gap-1.5 rounded-md border border-accent bg-accent-deep/30 px-3 py-1.5 text-xs text-accent transition hover:bg-accent-deep/40 disabled:opacity-50"
        >
          <RefreshCw size={11} />
          {t("pipeline.regenerateImage")}
        </button>
        <button
          onClick={() => onRegenerateVideo(shot.id)}
          disabled={shot.status === "videoing" || !shot.imageUrl}
          className="flex items-center justify-center gap-1.5 rounded-md border border-warn bg-warn-deep/30 px-3 py-1.5 text-xs text-warn transition hover:bg-warn-deep/40 disabled:opacity-50"
        >
          <RefreshCw size={11} />
          {t("pipeline.regenerateVideo")}
        </button>
      </div>

      {shot.error && (
        <div className="rounded-md border border-danger bg-danger-deep/30 p-2 text-[0.6875rem] text-danger">
          {shot.error}
        </div>
      )}
    </div>
  );
}

function AssetToggleGroup({
  icon,
  label,
  assets,
  activeIds,
  onChange,
  emptyLabel,
}: {
  icon: ReactNode;
  label: string;
  assets: Asset[];
  activeIds: string[];
  onChange: (ids: string[]) => void;
  emptyLabel: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1 text-[0.6875rem] font-medium text-ink-4">
        {icon}
        {label}
      </label>
      <div className="flex flex-wrap gap-1">
        {assets.map((asset) => {
          const isActive = activeIds.includes(asset.id);
          return (
            <button
              key={asset.id}
              onClick={() => onChange(isActive ? activeIds.filter((id) => id !== asset.id) : [...activeIds, asset.id])}
              className={`rounded-full border px-2 py-0.5 text-[0.625rem] font-medium transition ${
                isActive
                  ? "border-success bg-success-deep/50 text-success"
                  : "border-line bg-raised text-ink-4 hover:border-line-strong"
              }`}
            >
              {asset.name || emptyLabel}
            </button>
          );
        })}
      </div>
    </div>
  );
}
