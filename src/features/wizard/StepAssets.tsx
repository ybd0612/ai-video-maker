// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/StepAssets.tsx
// Step 2: Asset preparation — characters / scenes / products / style anchor.
// Generates reference images used as img2img anchors for storyboard consistency.
// ────────────────────────────────────────────────────────────────────────────

import { useState, useEffect } from "react";
import {
  useProjectStore, selectActiveProject,
  type Asset,
} from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useT } from "@/i18n";
import {
  UserPlus, Trash2, ImageIcon, Loader2, Plus, Wand2,
} from "lucide-react";
import { CharacterEditor } from "@/features/characters/CharacterEditor";
import { useWizardActions, hasActiveAssetTask } from "./useWizardActions";
import { generateImage, aspectRatioToImageSize } from "@/services/imageService";
import { AiPolishField } from "@/components/ui/AiPolishField";
import {
  SYSTEM_PROMPT_DESCRIPTION_ZH,
  SYSTEM_PROMPT_VISUAL_PROMPT,
} from "@/services/chatService";

export function StepAssets() {
  const t = useT();
  const project = useProjectStore(selectActiveProject);
  const removeAsset = useProjectStore((s) => s.removeAsset);
  const addAsset = useProjectStore((s) => s.addAsset);
  const updateAsset = useProjectStore((s) => s.updateAsset);
  const setWizardStep = useProjectStore((s) => s.setWizardStep);
  const providerConfig = useSettingsStore((s) => s.providerConfig);
  const { generateAssetImages, generateStyleReference } = useWizardActions();

  const [editingChar, setEditingChar] = useState<Asset | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [generatingScenes, setGeneratingScenes] = useState<Set<string>>(new Set());
  const [generatingProducts, setGeneratingProducts] = useState<Set<string>>(new Set());
  const [generatingStyle, setGeneratingStyle] = useState(false);
  const isGenerating = project?.assetGenerationStarted ?? false;

  const assets = project?.assets ?? [];
  const characters = assets.filter((a) => a.type === "character");
  const sceneReferences = assets.filter((a) => a.type === "scene");
  const products = assets.filter((a) => a.type === "product");
  const styleReferenceUrl = project?.styleReferenceUrl;

  // 刷新/中断后恢复：assetGenerationStarted 卡 true 且没有存活任务时重置，
  // 避免“生成全部”按钮永久禁用转圈（用户反馈过“资产第一个自动在加载”）。
  // 注意：任务仍在后台运行时（普通导航切项目再回来）不重置，避免 UI 与真实任务脱节。
  useEffect(() => {
    if (project?.assetGenerationStarted && !hasActiveAssetTask(project.id)) {
      useProjectStore.getState().setAssetGenerationStartedByProjectId(project.id, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  // ── Character handlers ────────────────────────────────────────────────

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

  // ── Batch generate portraits ──────────────────────────────────────────

  const handleBatchPortraits = async () => {
    await generateAssetImages({ generatePortraits: true, generateScenes: false, generateProducts: false, generateStyle: false });
  };

  // ── Batch generate scene images ───────────────────────────────────────

  const handleBatchScenes = async () => {
    await generateAssetImages({ generatePortraits: false, generateScenes: true, generateProducts: false, generateStyle: false });
  };

  // ── Batch generate product images ─────────────────────────────────────

  const handleBatchProducts = async () => {
    await generateAssetImages({ generatePortraits: false, generateScenes: false, generateProducts: true, generateStyle: false });
  };

  // ── Generate all assets ───────────────────────────────────────────────

  const handleGenerateAll = async () => {
    await generateAssetImages({ generatePortraits: true, generateScenes: true, generateProducts: true, generateStyle: true });
    // 资产生成完成后，自动进入分镜步骤
    setWizardStep(3);
  };

  // ── Scene reference handlers ──────────────────────────────────────────

  const handleAddScene = () => {
    addAsset({ type: "scene", name: "", prompt: "", description: "" });
  };

  const handleGenerateScene = async (scene: Asset) => {
    if (!scene.prompt.trim() || !providerConfig.apiKey) return;
    setGeneratingScenes((prev) => new Set(prev).add(scene.id));
    try {
      const size = aspectRatioToImageSize(project?.aspectRatio ?? "16:9");
      const styleRef = project?.styleReferenceUrl;
      const styleInstruction = styleRef
        ? "Match the art style, color palette and lighting mood of the reference image; do not copy its content or composition. "
        : "";
      const url = await generateImage({
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        prompt: `${styleInstruction}${scene.prompt}`,
        size,
        ...(styleRef ? { inputImageUrl: styleRef } : {}),
      });
      updateAsset(scene.id, { imageUrl: url, error: undefined });
    } catch (err) {
      updateAsset(scene.id, { error: err instanceof Error ? err.message : String(err) });
      console.error("Failed to generate scene image:", err);
    } finally {
      setGeneratingScenes((prev) => {
        const next = new Set(prev);
        next.delete(scene.id);
        return next;
      });
    }
  };

  // ── Product reference handlers ────────────────────────────────────────

  const handleAddProduct = () => {
    addAsset({ type: "product", name: "", prompt: "", description: "" });
  };

  const handleGenerateProduct = async (product: Asset) => {
    if (!product.prompt.trim() || !providerConfig.apiKey) return;
    setGeneratingProducts((prev) => new Set(prev).add(product.id));
    try {
      const size = aspectRatioToImageSize(project?.aspectRatio ?? "16:9");
      const styleRef = project?.styleReferenceUrl;
      const styleInstruction = styleRef
        ? "Match the art style, color palette and lighting mood of the reference image; do not copy its content or composition. "
        : "";
      const url = await generateImage({
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        prompt: `${styleInstruction}${product.prompt}`,
        size,
        ...(styleRef ? { inputImageUrl: styleRef } : {}),
      });
      updateAsset(product.id, { imageUrl: url, error: undefined });
    } catch (err) {
      updateAsset(product.id, { error: err instanceof Error ? err.message : String(err) });
      console.error("Failed to generate product image:", err);
    } finally {
      setGeneratingProducts((prev) => {
        const next = new Set(prev);
        next.delete(product.id);
        return next;
      });
    }
  };

  // ── Style reference handler ───────────────────────────────────────────

  const handleGenerateStyle = async () => {
    if (!providerConfig.apiKey) return;
    setGeneratingStyle(true);
    try {
      // 统一走 useWizardActions 的生成逻辑：风格提示词从想法派生、
      // 幂等守卫、错误写回 styleReferenceError（force 用于重新生成已有图）
      await generateStyleReference(undefined, !!styleReferenceUrl);
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

      {/* 无资产提示：可直接下一步（等价跳过），但说明一致性影响 */}
      {characters.length === 0 && sceneReferences.length === 0 && products.length === 0 && (
        <p className="rounded-lg border border-amber-800/50 bg-amber-950/20 px-3 py-2 text-center text-[0.6875rem] text-amber-300/90">
          {t("wizard.noAssetsContinueHint")}
        </p>
      )}

      {/* ── Characters section ────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-300">
            {t("characters.title" as any) || "角色"} ({characters.length})
          </h3>
          {characters.some((c) => !c.imageUrl) && (
            <button
              onClick={handleBatchPortraits}
              disabled={isGenerating}
              className="flex items-center gap-1.5 rounded px-2 py-1 text-[0.6875rem] text-violet-400 hover:bg-violet-950/30 transition disabled:opacity-50"
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
                className="group flex cursor-pointer items-start gap-3 rounded-xl border border-slate-700 bg-slate-800/50 p-3 transition hover:border-slate-600 focus:border-emerald-500 focus:outline-none"
              >
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full border border-slate-700 bg-slate-800">
                  {(char.imageUrl || char.avatarUrl) ? (
                    <img
                      src={char.imageUrl || char.avatarUrl}
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
                  {char.error && (
                    <p className="mt-0.5 truncate text-[0.625rem] text-red-400" title={char.error}>
                      生成失败：{char.error}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1 opacity-0 transition group-hover:opacity-100">
                  <button
                    onClick={(e) => {
                      // 阻止冒泡，避免点删除时同时触发卡片的「进入编辑」
                      e.stopPropagation();
                      handleDelete(char);
                    }}
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
            <p className="text-[0.6875rem] text-slate-600 mt-0.5">
              {t("wizard.sceneReferencesHint")}
            </p>
          </div>
          {sceneReferences.some((s) => !s.imageUrl && s.prompt.trim()) && (
            <button
              onClick={handleBatchScenes}
              disabled={isGenerating}
              className="flex items-center gap-1.5 rounded px-2 py-1 text-[0.6875rem] text-violet-400 hover:bg-violet-950/30 transition disabled:opacity-50"
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
                onChange={(e) => updateAsset(scene.id, { name: e.target.value })}
                placeholder="场景名称 (如: 城市街道)"
                className="w-full bg-transparent text-sm font-medium text-slate-200 placeholder:text-slate-600 focus:outline-none"
              />
              <AiPolishField
                value={scene.description}
                onChange={(v) => updateAsset(scene.id, { description: v })}
                systemPrompt={SYSTEM_PROMPT_DESCRIPTION_ZH}
                resetKey={scene.id}
                placeholder="中文描述"
                singleLine
                bare
                appearanceClass="bg-transparent text-xs text-slate-400 placeholder:text-slate-600"
              />
              <AiPolishField
                value={scene.prompt}
                onChange={(v) => updateAsset(scene.id, { prompt: v })}
                systemPrompt={SYSTEM_PROMPT_VISUAL_PROMPT}
                resetKey={scene.id}
                placeholder="English prompt for image generation..."
                rows={2}
                bare
                appearanceClass="bg-transparent text-xs text-slate-300 placeholder:text-slate-600"
              />
              {scene.error && (
                <p className="truncate text-[0.625rem] text-red-400" title={scene.error}>
                  生成失败：{scene.error}
                </p>
              )}
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
                onClick={() => removeAsset(scene.id)}
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

      {/* ── Product references section（产品主体一致性锚点） ─────────────── */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-300">
              {t("wizard.productReferences")} ({products.length})
            </h3>
            <p className="text-[0.6875rem] text-slate-600 mt-0.5">
              {t("wizard.productReferencesHint")}
            </p>
          </div>
          {products.some((p) => !p.imageUrl && p.prompt.trim()) && (
            <button
              onClick={handleBatchProducts}
              disabled={isGenerating}
              className="flex items-center gap-1.5 rounded px-2 py-1 text-[0.6875rem] text-violet-400 hover:bg-violet-950/30 transition disabled:opacity-50"
            >
              {isGenerating ? <Loader2 size={11} className="animate-spin" /> : <Wand2 size={11} />}
              {t("wizard.generateAllProducts")}
            </button>
          )}
        </div>

        {products.map((product) => (
          <div
            key={product.id}
            className="group flex items-start gap-3 rounded-xl border border-slate-700 bg-slate-800/50 p-3 transition hover:border-slate-600"
          >
            {/* Product image preview */}
            <div className="h-16 w-24 shrink-0 overflow-hidden rounded-lg border border-slate-700 bg-slate-800">
              {product.imageUrl ? (
                <img
                  src={product.imageUrl}
                  alt={product.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-slate-600">
                  <ImageIcon size={16} />
                </div>
              )}
            </div>

            {/* Product fields */}
            <div className="min-w-0 flex-1 flex flex-col gap-1.5">
              <input
                type="text"
                value={product.name}
                onChange={(e) => updateAsset(product.id, { name: e.target.value })}
                placeholder="产品名称 (如: 白色羽绒服)"
                className="w-full bg-transparent text-sm font-medium text-slate-200 placeholder:text-slate-600 focus:outline-none"
              />
              <AiPolishField
                value={product.description}
                onChange={(v) => updateAsset(product.id, { description: v })}
                systemPrompt={SYSTEM_PROMPT_DESCRIPTION_ZH}
                resetKey={product.id}
                placeholder="中文描述"
                singleLine
                bare
                appearanceClass="bg-transparent text-xs text-slate-400 placeholder:text-slate-600"
              />
              <AiPolishField
                value={product.prompt}
                onChange={(v) => updateAsset(product.id, { prompt: v })}
                systemPrompt={SYSTEM_PROMPT_VISUAL_PROMPT}
                resetKey={product.id}
                placeholder="English prompt for image generation..."
                rows={2}
                bare
                appearanceClass="bg-transparent text-xs text-slate-300 placeholder:text-slate-600"
              />
              {product.error && (
                <p className="truncate text-[0.625rem] text-red-400" title={product.error}>
                  生成失败：{product.error}
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex shrink-0 flex-col gap-1 opacity-0 transition group-hover:opacity-100">
              <button
                onClick={() => handleGenerateProduct(product)}
                disabled={!product.prompt.trim() || generatingProducts.has(product.id)}
                className="rounded p-1.5 text-violet-400 hover:bg-violet-950/30 disabled:opacity-30"
                title="生成产品图"
              >
                {generatingProducts.has(product.id) ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Wand2 size={12} />
                )}
              </button>
              <button
                onClick={() => removeAsset(product.id)}
                className="rounded p-1.5 text-slate-500 hover:bg-red-950 hover:text-red-400"
                title="删除"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}

        <button
          onClick={handleAddProduct}
          className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-slate-600 bg-slate-800/30 px-4 py-2.5 text-xs text-slate-400 transition hover:border-emerald-500 hover:text-emerald-400"
        >
          <Plus size={14} />
          {t("wizard.addProduct")}
        </button>
      </section>

      {/* ── Style reference section ───────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-300">
            {t("wizard.styleReference")}
          </h3>
          <p className="text-[0.6875rem] text-slate-600 mt-0.5">
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
              {project?.style || t("wizard.styleAutoHint")}
            </p>
            {project?.styleReferenceError && (
              <p className="mt-1 truncate text-[0.625rem] text-red-400" title={project.styleReferenceError}>
                生成失败：{project.styleReferenceError}
              </p>
            )}
            <button
              onClick={handleGenerateStyle}
              disabled={generatingStyle}
              className="mt-2 flex items-center gap-1.5 rounded px-3 py-1.5 text-[0.6875rem] text-violet-400 hover:bg-violet-950/30 transition disabled:opacity-50"
            >
              {generatingStyle ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <Wand2 size={11} />
              )}
              {styleReferenceUrl ? t("wizard.regenerateStyleRef") : t("wizard.generateStyleRef")}
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
