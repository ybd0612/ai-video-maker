// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/StepAssets.tsx
// Step 2: Asset preparation — characters, scene references, style anchor.
// Generates reference images that will be used as img2img anchors for storyboard.
// ────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import {
  useProjectStore, selectActiveProject,
  type Character, type SceneReference,
} from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useT } from "@/i18n";
import {
  UserPlus, Pencil, Trash2, ImageIcon, Loader2, Plus, Wand2,
} from "lucide-react";
import { CharacterEditor } from "@/features/characters/CharacterEditor";
import { useWizardActions } from "./useWizardActions";
import { generateImage, aspectRatioToImageSize } from "@/services/imageService";

export function StepAssets() {
  const t = useT();
  const project = useProjectStore(selectActiveProject);
  const removeCharacter = useProjectStore((s) => s.removeCharacter);
  const addSceneReference = useProjectStore((s) => s.addSceneReference);
  const updateSceneReference = useProjectStore((s) => s.updateSceneReference);
  const removeSceneReference = useProjectStore((s) => s.removeSceneReference);
  const updateProject = useProjectStore((s) => s.updateProject);
  const setWizardStep = useProjectStore((s) => s.setWizardStep);
  const providerConfig = useSettingsStore((s) => s.providerConfig);
  const { generateAssetImages } = useWizardActions();

  const [editingChar, setEditingChar] = useState<Character | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [generatingScenes, setGeneratingScenes] = useState<Set<string>>(new Set());
  const [generatingStyle, setGeneratingStyle] = useState(false);
  const isGenerating = project?.assetGenerationStarted ?? false;

  const characters = project?.characters ?? [];
  const sceneReferences = project?.sceneReferences ?? [];
  const styleReferenceUrl = project?.styleReferenceUrl;

  // ── Character handlers ────────────────────────────────────────────────

  const handleAdd = () => {
    setEditingChar(null);
    setShowEditor(true);
  };

  const handleEdit = (char: Character) => {
    setEditingChar(char);
    setShowEditor(true);
  };

  const handleDelete = (char: Character) => {
    if (confirm(t("characters.deleteConfirm", { name: char.name }))) {
      removeCharacter(char.id);
    }
  };

  const handleEditorClose = () => {
    setShowEditor(false);
    setEditingChar(null);
  };

  // ── Batch generate portraits ──────────────────────────────────────────

  const handleBatchPortraits = async () => {
    await generateAssetImages({ generatePortraits: true, generateScenes: false, generateStyle: false });
  };

  // ── Batch generate scene images ───────────────────────────────────────

  const handleBatchScenes = async () => {
    await generateAssetImages({ generatePortraits: false, generateScenes: true, generateStyle: false });
  };

  // ── Generate all assets ───────────────────────────────────────────────

  const handleGenerateAll = async () => {
    await generateAssetImages({ generatePortraits: true, generateScenes: true, generateStyle: true });
    // 资产生成完成后，自动进入分镜步骤
    setWizardStep(3);
  };

  // ── Scene reference handlers ──────────────────────────────────────────

  const handleAddScene = () => {
    addSceneReference({
      name: "",
      prompt: "",
      description: "",
    });
  };

  const handleGenerateScene = async (scene: SceneReference) => {
    if (!scene.prompt.trim() || !providerConfig.apiKey) return;
    setGeneratingScenes((prev) => new Set(prev).add(scene.id));
    try {
      const size = aspectRatioToImageSize(project?.aspectRatio ?? "16:9");
      const url = await generateImage({
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        prompt: scene.prompt,
        size,
      });
      updateSceneReference(scene.id, { imageUrl: url });
    } catch (err) {
      console.error("Failed to generate scene image:", err);
    } finally {
      setGeneratingScenes((prev) => {
        const next = new Set(prev);
        next.delete(scene.id);
        return next;
      });
    }
  };

  // ── Style reference handler ───────────────────────────────────────────

  const handleGenerateStyle = async () => {
    if (!providerConfig.apiKey) return;
    setGeneratingStyle(true);
    try {
      const size = aspectRatioToImageSize(project?.aspectRatio ?? "16:9");
      const stylePrompt = project?.style
        ? `${project.style} style reference, cohesive visual aesthetic, color palette, mood board`
        : `Cinematic style reference, cohesive visual aesthetic, warm tones, professional photography`;
      const url = await generateImage({
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        prompt: stylePrompt,
        size,
      });
      updateProject({ styleReferenceUrl: url });
    } catch (err) {
      console.error("Failed to generate style reference:", err);
    } finally {
      setGeneratingStyle(false);
    }
  };

  // ── Editor mode ───────────────────────────────────────────────────────

  if (showEditor) {
    return <CharacterEditor character={editingChar} onClose={handleEditorClose} />;
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 py-8">
      {/* Title */}
      <div className="text-center">
        <h2 className="text-lg font-bold text-slate-100">
          {t("wizard.stepAssets")}
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          {t("wizard.assetsHint")}
        </p>
      </div>

      {/* ── Characters section ────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-300">
            {t("characters.title" as any) || "角色"} ({characters.length})
          </h3>
          {characters.some((c) => !c.generatedPortraitUrl) && (
            <button
              onClick={handleBatchPortraits}
              disabled={isGenerating}
              className="flex items-center gap-1.5 rounded px-2 py-1 text-[11px] text-violet-400 hover:bg-violet-950/30 transition disabled:opacity-50"
            >
              {isGenerating ? <Loader2 size={11} className="animate-spin" /> : <Wand2 size={11} />}
              {t("wizard.generateAllPortraits")}
            </button>
          )}
        </div>

        {characters.length > 0 ? (
          <div className="flex flex-col gap-2">
            {characters.map((char) => (
              <div
                key={char.id}
                className="group flex items-start gap-3 rounded-xl border border-slate-700 bg-slate-800/50 p-3 transition hover:border-slate-600"
              >
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full border border-slate-700 bg-slate-800">
                  {(char.generatedPortraitUrl || char.avatarUrl) ? (
                    <img
                      src={char.generatedPortraitUrl || char.avatarUrl}
                      alt={char.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-sm text-slate-500">
                      {char.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-200">{char.name}</p>
                  <p className="mt-0.5 text-xs text-slate-500 line-clamp-2">
                    {char.description || char.appearancePrompt || "—"}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1 opacity-0 transition group-hover:opacity-100">
                  <button
                    onClick={() => handleEdit(char)}
                    className="rounded p-1.5 text-slate-500 hover:bg-slate-700 hover:text-slate-300"
                    title={t("characters.edit")}
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    onClick={() => handleDelete(char)}
                    className="rounded p-1.5 text-slate-500 hover:bg-red-950 hover:text-red-400"
                    title={t("characters.delete")}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <ImageIcon size={24} className="text-slate-700" />
            <p className="text-xs text-slate-600">{t("wizard.noAssetsHint")}</p>
          </div>
        )}

        <button
          onClick={handleAdd}
          className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-slate-600 bg-slate-800/30 px-4 py-2.5 text-xs text-slate-400 transition hover:border-emerald-500 hover:text-emerald-400"
        >
          <UserPlus size={14} />
          {t("characters.add")}
        </button>
      </section>

      {/* ── Scene references section ──────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-300">
              {t("wizard.sceneReferences")} ({sceneReferences.length})
            </h3>
            <p className="text-[11px] text-slate-600 mt-0.5">
              {t("wizard.sceneReferencesHint")}
            </p>
          </div>
          {sceneReferences.some((s) => !s.imageUrl && s.prompt.trim()) && (
            <button
              onClick={handleBatchScenes}
              disabled={isGenerating}
              className="flex items-center gap-1.5 rounded px-2 py-1 text-[11px] text-violet-400 hover:bg-violet-950/30 transition disabled:opacity-50"
            >
              {isGenerating ? <Loader2 size={11} className="animate-spin" /> : <Wand2 size={11} />}
              {t("wizard.generateAllScenes")}
            </button>
          )}
        </div>

        {sceneReferences.map((scene) => (
          <div
            key={scene.id}
            className="group flex items-start gap-3 rounded-xl border border-slate-700 bg-slate-800/50 p-3 transition hover:border-slate-600"
          >
            {/* Scene image preview */}
            <div className="h-16 w-24 shrink-0 overflow-hidden rounded-lg border border-slate-700 bg-slate-800">
              {scene.imageUrl ? (
                <img
                  src={scene.imageUrl}
                  alt={scene.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-slate-600">
                  <ImageIcon size={16} />
                </div>
              )}
            </div>

            {/* Scene fields */}
            <div className="min-w-0 flex-1 flex flex-col gap-1.5">
              <input
                type="text"
                value={scene.name}
                onChange={(e) => updateSceneReference(scene.id, { name: e.target.value })}
                placeholder="场景名称 (如: 城市街道)"
                className="w-full bg-transparent text-sm font-medium text-slate-200 placeholder:text-slate-600 focus:outline-none"
              />
              <input
                type="text"
                value={scene.description}
                onChange={(e) => updateSceneReference(scene.id, { description: e.target.value })}
                placeholder="中文描述"
                className="w-full bg-transparent text-xs text-slate-400 placeholder:text-slate-600 focus:outline-none"
              />
              <textarea
                value={scene.prompt}
                onChange={(e) => updateSceneReference(scene.id, { prompt: e.target.value })}
                placeholder="English prompt for image generation..."
                rows={2}
                className="w-full resize-none bg-transparent text-xs text-slate-300 placeholder:text-slate-600 focus:outline-none"
              />
            </div>

            {/* Actions */}
            <div className="flex shrink-0 flex-col gap-1 opacity-0 transition group-hover:opacity-100">
              <button
                onClick={() => handleGenerateScene(scene)}
                disabled={!scene.prompt.trim() || generatingScenes.has(scene.id)}
                className="rounded p-1.5 text-violet-400 hover:bg-violet-950/30 disabled:opacity-30"
                title="生成场景图"
              >
                {generatingScenes.has(scene.id) ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Wand2 size={12} />
                )}
              </button>
              <button
                onClick={() => removeSceneReference(scene.id)}
                className="rounded p-1.5 text-slate-500 hover:bg-red-950 hover:text-red-400"
                title="删除"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}

        <button
          onClick={handleAddScene}
          className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-slate-600 bg-slate-800/30 px-4 py-2.5 text-xs text-slate-400 transition hover:border-emerald-500 hover:text-emerald-400"
        >
          <Plus size={14} />
          {t("wizard.addScene")}
        </button>
      </section>

      {/* ── Style reference section ───────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-300">
            {t("wizard.styleReference")}
          </h3>
          <p className="text-[11px] text-slate-600 mt-0.5">
            {t("wizard.styleReferenceHint")}
          </p>
        </div>

        <div className="flex items-start gap-3 rounded-xl border border-slate-700 bg-slate-800/50 p-3">
          <div className="h-20 w-32 shrink-0 overflow-hidden rounded-lg border border-slate-700 bg-slate-800">
            {styleReferenceUrl ? (
              <img
                src={styleReferenceUrl}
                alt="Style reference"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-slate-600">
                <ImageIcon size={20} />
              </div>
            )}
          </div>
          <div className="flex-1">
            <p className="text-xs text-slate-400">
              {project?.style || "未设置风格描述"}
            </p>
            <button
              onClick={handleGenerateStyle}
              disabled={generatingStyle}
              className="mt-2 flex items-center gap-1.5 rounded px-3 py-1.5 text-[11px] text-violet-400 hover:bg-violet-950/30 transition disabled:opacity-50"
            >
              {generatingStyle ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <Wand2 size={11} />
              )}
              {t("wizard.generateStyleRef")}
            </button>
          </div>
        </div>
      </section>

      {/* ── Generate all button ───────────────────────────────────────── */}
      <button
        onClick={handleGenerateAll}
        disabled={isGenerating}
        className="mx-auto flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
      >
        {isGenerating ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <Wand2 size={16} />
        )}
        {isGenerating ? t("wizard.generating") : t("wizard.assetsReady")}
      </button>
    </div>
  );
}
