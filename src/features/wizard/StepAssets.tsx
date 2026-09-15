// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/StepAssets.tsx
// Step 2: Asset preparation — characters / scenes / products / style anchor.
// Generates reference images used as img2img anchors for storyboard consistency.
// ────────────────────────────────────────────────────────────────────────────

import { useState, useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
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
import { VisualDirectionEditor } from "./VisualDirectionEditor";
import { AssetEditor } from "./AssetEditor";
import { useWizardActions, hasActiveAssetTask } from "./useWizardActions";
import { generateImage, aspectRatioToImageParams } from "@/services/imageService";
import { Lightbox } from "@/components/ui/Lightbox";
import { confirmDialog } from "@/components/ui/ConfirmDialog";
import {
  composeTextToImagePrompt,
  assetImageBoundary,
  getStylePrompt,
  getStyleReferenceUrl,
} from "@/lib/promptComposer";

export function StepAssets() {
  const t = useT();
  const project = useProjectStore(selectActiveProject);
  const removeAsset = useProjectStore((s) => s.removeAsset);
  const addAsset = useProjectStore((s) => s.addAsset);
  const updateAssetByProjectIdIfRevision = useProjectStore((s) => s.updateAssetByProjectIdIfRevision);
  const setWizardStep = useProjectStore((s) => s.setWizardStep);
  const providerConfig = useSettingsStore((s) => s.providerConfig);
  const { generateAssetImages, generateStyleReference } = useWizardActions();

  const [editingChar, setEditingChar] = useState<Asset | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [showVisualDirectionEditor, setShowVisualDirectionEditor] = useState(false);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [generatingScenes, setGeneratingScenes] = useState<Set<string>>(new Set());
  const [generatingProducts, setGeneratingProducts] = useState<Set<string>>(new Set());
  const [generatingProps, setGeneratingProps] = useState<Set<string>>(new Set());
  const [generatingStyle, setGeneratingStyle] = useState(false);
  // 本页任一生成请求进行中（批量 / 风格 / 单项场景 / 单项产品）：
  // 统一禁用所有生成按钮 —— 批量与单项可能重复提交同一资产（双倍配额消耗），
  // 且共用集中式限流器，逐个排队不如明确禁用直观。全部请求返回后恢复。
  const anyGenerating =
    project?.assetGenerationStarted === true || generatingStyle || generatingScenes.size > 0 || generatingProducts.size > 0 || generatingProps.size > 0;

  const assets = project?.assets ?? [];
  const characters = assets.filter((a) => a.type === "character");
  const sceneReferences = assets.filter((a) => a.type === "scene");
  const products = assets.filter((a) => a.type === "product");
  const props = assets.filter((a) => a.type === "prop");
  const styleAsset = assets.find((a) => a.type === "style");
  const styleReferenceUrl = project ? getStyleReferenceUrl(project) : undefined;
  const assetGroups = [
    { count: characters.length, ready: characters.filter((char) => Boolean(char.imageUrl || char.avatarUrl)).length },
    { count: sceneReferences.length, ready: sceneReferences.filter((scene) => Boolean(scene.imageUrl)).length },
    { count: products.length, ready: products.filter((product) => Boolean(product.imageUrl)).length },
    { count: props.length, ready: props.filter((prop) => Boolean(prop.imageUrl)).length },
  ];
  const totalAssetCount = assetGroups.reduce((sum, group) => sum + group.count, 0);
  const readyAssetCount = assetGroups.reduce((sum, group) => sum + group.ready, 0);
  const hasMissingAssets = !styleReferenceUrl || assetGroups.some((group) => group.ready < group.count);

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

  const handleDelete = async (char: Asset) => {
    const ok = await confirmDialog({
      title: t("characters.delete"),
      message: t("characters.deleteConfirm", { name: char.name }),
      confirmLabel: t("dialog.confirm"),
      variant: "danger",
    });
    if (ok) removeAsset(char.id);
  };

  const handleDeleteAsset = async (asset: Asset) => {
    const ok = await confirmDialog({
      title: t("dialog.delete"),
      message: t("wizard.assetDeleteConfirm", { name: asset.name || "未命名资产" }),
      confirmLabel: t("dialog.confirm"),
      variant: "danger",
    });
    if (ok) removeAsset(asset.id);
  };

  const handleEditorClose = () => {
    setShowEditor(false);
    setEditingChar(null);
  };

  const handleAssetEditorClose = () => setEditingAsset(null);

  // ── Batch generate portraits ──────────────────────────────────────────

  // ── Batch generate scene images ───────────────────────────────────────

  // ── Batch generate product images ─────────────────────────────────────

  // ── Batch generate prop images ─────────────────────────────────────────

  const handleFillMissing = async () => {
    await generateAssetImages({
      generatePortraits: characters.some((char) => !char.imageUrl && !char.avatarUrl),
      generateScenes: sceneReferences.some((scene) => !scene.imageUrl && scene.prompt.trim()),
      generateProducts: products.some((product) => !product.imageUrl && product.prompt.trim()),
      generateProps: props.some((prop) => !prop.imageUrl && prop.prompt.trim()),
      generateStyle: !styleReferenceUrl,
    });
  };

  // ── Scene reference handlers ──────────────────────────────────────────

  const handleAddScene = () => {
    addAsset({ type: "scene", name: "", prompt: "", description: "" });
  };

  const handleGenerateScene = async (scene: Asset) => {
    await generateSingleAssetImage(scene, setGeneratingScenes, "scene");
  };

  // ── Product reference handlers ────────────────────────────────────────

  const handleAddProduct = () => {
    addAsset({ type: "product", name: "", prompt: "", description: "" });
  };

  const generateSingleAssetImage = async (
    asset: Asset,
    setGenerating: Dispatch<SetStateAction<Set<string>>>,
    kind: "scene" | "product" | "prop",
  ) => {
    const targetProjectId = project?.id;
    if (!targetProjectId || !asset.prompt.trim() || !providerConfig.apiKey) return;
    const expectedRevision = asset.renderRevision ?? 0;
    setGenerating((prev) => new Set(prev).add(asset.id));
    try {
      const { size, ratio } = aspectRatioToImageParams(project?.aspectRatio ?? "16:9");
      // ⚠️ 2026-09-15 事故决策：风格母版不再作为 i2i 参考图（内容会被整体复制），
      // 风格一致性由 stylePrompt 文本承载；主体边界句防止模型画入角色/剧情。
      const stylePrompt = project ? getStylePrompt(project) : undefined;
      const url = await generateImage({
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        prompt: composeTextToImagePrompt({
          subject: `${assetImageBoundary(kind)} ${asset.prompt}`.trim(),
          style: stylePrompt,
        }),
        size,
        ratio,
      });
      updateAssetByProjectIdIfRevision(targetProjectId, asset.id, expectedRevision, {
        imageUrl: url,
        error: undefined,
      });
    } catch (err) {
      updateAssetByProjectIdIfRevision(targetProjectId, asset.id, expectedRevision, {
        error: err instanceof Error ? err.message : String(err),
      });
      console.error(`Failed to generate ${kind} image:`, err);
    } finally {
      setGenerating((prev) => {
        const next = new Set(prev);
        next.delete(asset.id);
        return next;
      });
    }
  };

  const handleAddProp = () => {
    addAsset({ type: "prop", name: "", prompt: "", description: "" });
  };

  const handleGenerateProp = async (prop: Asset) => {
    await generateSingleAssetImage(prop, setGeneratingProps, "prop");
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

  if (showVisualDirectionEditor) {
    return <VisualDirectionEditor onClose={() => setShowVisualDirectionEditor(false)} onGenerate={() => handleGenerateStyle()} generating={generatingStyle} />;
  }

  if (editingAsset) {
    const generating = editingAsset.type === "scene"
      ? generatingScenes.has(editingAsset.id)
      : editingAsset.type === "product"
        ? generatingProducts.has(editingAsset.id)
        : generatingProps.has(editingAsset.id);
    const regenerate = async (asset: Asset) => {
      if (asset.type === "scene") await handleGenerateScene(asset);
      if (asset.type === "product") await generateSingleAssetImage(asset, setGeneratingProducts, "product");
      if (asset.type === "prop") await handleGenerateProp(asset);
    };
    return <AssetEditor asset={editingAsset} onClose={handleAssetEditorClose} onGenerate={regenerate} generating={generating} />;
  }

  if (showEditor) {
    return <CharacterEditor character={editingChar} onClose={handleEditorClose} />;
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8">
      {/* Title */}
      <div>
        <p className="text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-accent">{t("wizard.stepAssets")}</p>
        <h2 className="mt-1 text-xl font-bold text-ink">{t("wizard.assetWorkbenchTitle")}</h2>
        <p className="mt-1 max-w-2xl text-xs text-ink-4">{t("wizard.assetWorkbenchHint")}</p>
      </div>

      {/* 无资产提示：可直接下一步（等价跳过），但说明一致性影响 */}
      {characters.length === 0 && sceneReferences.length === 0 && products.length === 0 && props.length === 0 && (
        <p className="rounded-lg border border-warn/50 bg-warn-deep/20 px-3 py-2 text-center text-[0.6875rem] text-warn/90">
          {t("wizard.noAssetsContinueHint")}
        </p>
      )}

      {/* ── Visual direction section: upstream of all assets ───────────── */}
      <section
        role="button"
        tabIndex={0}
        aria-disabled={!project?.visualDirection}
        onClick={() => project?.visualDirection && setShowVisualDirectionEditor(true)}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && project?.visualDirection) {
            e.preventDefault();
            setShowVisualDirectionEditor(true);
          }
        }}
        title={project?.visualDirection ? (t("wizard.editVisualDirection" as never) as string) : undefined}
        className="cursor-pointer rounded-2xl border border-accent/40 bg-accent-deep/10 p-4 transition hover:border-accent focus:border-accent focus:outline-none"
      >
        <div className="flex items-start gap-4">
          <div className="flex h-24 w-36 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-accent/30 bg-app">
            {styleReferenceUrl ? (
              <Lightbox src={styleReferenceUrl} alt={t("wizard.visualDirectionReference" as never) as string}>
                <img src={styleReferenceUrl} alt={t("wizard.visualDirectionReference" as never) as string} className="h-full w-full object-cover" />
              </Lightbox>
            ) : <ImageIcon size={20} className="text-ink-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[0.6875rem] font-medium uppercase tracking-[0.12em] text-accent">{t("wizard.visualDirectionTitle" as never) as string}</p>
            <p className="mt-1 text-base font-semibold text-ink">{project?.visualDirection?.name || styleAsset?.name || project?.style || t("wizard.visualDirectionUnset" as never) as string}</p>
            <p className="mt-1 text-xs text-ink-3">{styleAsset?.description || t("wizard.visualDirectionDescription" as never) as string}</p>
            <p className="mt-2 text-[0.6875rem] text-ink-5">{t("wizard.visualDirectionHint" as never) as string}</p>
            {project?.styleReferenceError && <p className="mt-1 truncate text-[0.625rem] text-danger" title={project.styleReferenceError}>{project.styleReferenceError}</p>}
          </div>
        </div>
      </section>

      {/* ── Readiness overview ─────────────────────────────────────────── */}
      <section className="rounded-xl border border-line bg-raised/30 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-ink">{t("wizard.assetReadinessTitle")}</h3>
            <p className="mt-0.5 text-[0.6875rem] text-ink-5">{t("wizard.assetReadinessHint")}</p>
          </div>
          <button onClick={() => void handleFillMissing()} disabled={anyGenerating || !hasMissingAssets} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-accent-solid px-3 py-2 text-[0.6875rem] font-medium text-white transition hover:bg-accent-solid disabled:cursor-not-allowed disabled:opacity-50">
            {anyGenerating ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
            {t("wizard.fillMissingAssets")}
          </button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          {[
            [t("characters.title"), characters.length, characters.filter((char) => Boolean(char.imageUrl || char.avatarUrl)).length],
            [t("wizard.worldScenes"), sceneReferences.length, sceneReferences.filter((scene) => Boolean(scene.imageUrl)).length],
            [t("wizard.coreSubject"), products.length, products.filter((product) => Boolean(product.imageUrl)).length],
            [t("wizard.keyObjects"), props.length, props.filter((prop) => Boolean(prop.imageUrl)).length],
          ].map(([label, count, ready]) => (
            <div key={String(label)} className="rounded-lg border border-line-soft bg-app/60 px-3 py-2">
              <p className="text-xs font-medium text-ink-2">{label}</p>
              <p className="mt-1 text-[0.6875rem] text-ink-5">{ready} / {count} {t("wizard.readyCount")}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[0.6875rem] text-ink-4">{t("wizard.readinessSummary", { ready: readyAssetCount, total: totalAssetCount })}</p>
      </section>

      {/* ── Characters section ────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink-2">
            {t("characters.title")} ({characters.length})
          </h3>
        </div>

        {characters.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2">
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
                className="group relative flex cursor-pointer items-center gap-3 overflow-hidden rounded-xl border border-line bg-raised/50 p-2.5 transition hover:border-line-strong focus:border-success focus:outline-none"
              >
                <div className="relative flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-app">
                  {(char.imageUrl || char.avatarUrl) ? (
                    <Lightbox src={char.imageUrl || char.avatarUrl} alt={char.name}>
                      <img
                        src={char.imageUrl || char.avatarUrl}
                        alt={char.name}
                        className="h-full w-full object-contain"
                      />
                    </Lightbox>
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-sm text-ink-4">
                      {char.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1 py-1 pr-1">
                  <p className="text-sm font-medium text-ink">{char.name}</p>
                  <p className="mt-0.5 text-xs text-ink-4 line-clamp-2">
                    {(char.description || char.appearancePrompt || "—").split("\n")[0]}
                  </p>
                  {char.error && (
                    <p className="mt-0.5 truncate text-[0.625rem] text-danger" title={char.error}>
                      {t("assetEditor.generateFailedWith", { message: char.error })}
                    </p>
                  )}
                </div>
                <div className="absolute right-2 top-2 flex shrink-0 gap-1 opacity-0 transition group-hover:opacity-100">
                  <button
                    onClick={(e) => {
                      // 阻止冒泡，避免点删除时同时触发卡片的「进入编辑」
                      e.stopPropagation();
                      handleDelete(char);
                    }}
                    className="rounded p-1.5 text-ink-4 hover:bg-danger-deep hover:text-danger"
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
            <ImageIcon size={24} className="text-ink-5" />
            <p className="text-xs text-ink-5">{t("wizard.noAssetsHint")}</p>
          </div>
        )}

        <button
          onClick={handleAdd}
          className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong bg-raised/30 px-4 py-2.5 text-xs text-ink-3 transition hover:border-success hover:text-success"
        >
          <UserPlus size={14} />
          {t("characters.add")}
        </button>
      </section>

      {/* ── Scene references section ──────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-ink-2">
              {t("wizard.sceneReferences")} ({sceneReferences.length})
            </h3>
            <p className="text-[0.6875rem] text-ink-5 mt-0.5">
              {t("wizard.sceneReferencesHint")}
            </p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {sceneReferences.map((scene) => (
          <div
            key={scene.id}
            role="button"
            tabIndex={0}
            onClick={() => setEditingAsset(scene)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setEditingAsset(scene); } }}
            className="group relative flex cursor-pointer items-center gap-3 overflow-hidden rounded-xl border border-line bg-raised/50 p-2.5 transition hover:border-line-strong focus:border-accent focus:outline-none"
          >
            {/* Scene image preview（点击放大查看） */}
            <div className="relative flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-app" onClick={(e) => e.stopPropagation()}>
              {scene.imageUrl ? (
                <Lightbox src={scene.imageUrl} alt={scene.name}>
                  <img
                    src={scene.imageUrl}
                    alt={scene.name}
                    className="h-full w-full object-contain"
                  />
                </Lightbox>
              ) : (
                <div className="flex h-full w-full items-center justify-center text-ink-5">
                  <ImageIcon size={16} />
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1 py-1 pr-1">
              <p className="text-sm font-medium text-ink">{scene.name || t("assetEditor.unnamedScene")}</p>
              <p className="mt-0.5 line-clamp-2 text-xs text-ink-4">{(scene.description || scene.prompt || "—").split("\n")[0]}</p>
              {scene.error && <p className="mt-0.5 truncate text-[0.625rem] text-danger" title={scene.error}>{t("assetEditor.generateFailedWith", { message: scene.error })}</p>}
            </div>

            {/* Actions */}
            <div className="absolute right-2 top-2 flex shrink-0 flex-col gap-1 opacity-0 transition group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => void handleDeleteAsset(scene)}
                className="rounded p-1.5 text-ink-4 hover:bg-danger-deep hover:text-danger"
                title={t("assetEditor.delete")}
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
          ))}
        </div>

        <button
          onClick={handleAddScene}
          className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong bg-raised/30 px-4 py-2.5 text-xs text-ink-3 transition hover:border-success hover:text-success"
        >
          <Plus size={14} />
          {t("wizard.addScene")}
        </button>
      </section>

      {/* ── Product references section（产品主体一致性锚点） ─────────────── */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-ink-2">
              {t("wizard.productReferences")} ({products.length})
            </h3>
            <p className="text-[0.6875rem] text-ink-5 mt-0.5">
              {t("wizard.productReferencesHint")}
            </p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {products.map((product) => (
          <div
            key={product.id}
            role="button"
            tabIndex={0}
            onClick={() => setEditingAsset(product)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setEditingAsset(product); } }}
            className="group relative flex cursor-pointer items-center gap-3 overflow-hidden rounded-xl border border-line bg-raised/50 p-2.5 transition hover:border-line-strong focus:border-accent focus:outline-none"
          >
            {/* Product image preview（点击放大查看） */}
            <div className="relative flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-app" onClick={(e) => e.stopPropagation()}>
              {product.imageUrl ? (
                <Lightbox src={product.imageUrl} alt={product.name}>
                  <img
                    src={product.imageUrl}
                    alt={product.name}
                    className="h-full w-full object-contain"
                  />
                </Lightbox>
              ) : (
                <div className="flex h-full w-full items-center justify-center text-ink-5">
                  <ImageIcon size={16} />
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1 py-1 pr-1">
              <p className="text-sm font-medium text-ink">{product.name || t("assetEditor.unnamedProduct")}</p>
              <p className="mt-0.5 line-clamp-2 text-xs text-ink-4">{(product.description || product.prompt || "—").split("\n")[0]}</p>
              {product.error && <p className="mt-0.5 truncate text-[0.625rem] text-danger" title={product.error}>{t("assetEditor.generateFailedWith", { message: product.error })}</p>}
            </div>

            {/* Actions */}
            <div className="absolute right-2 top-2 flex shrink-0 flex-col gap-1 opacity-0 transition group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => void handleDeleteAsset(product)}
                className="rounded p-1.5 text-ink-4 hover:bg-danger-deep hover:text-danger"
                title={t("assetEditor.delete")}
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
          ))}
        </div>

        <button
          onClick={handleAddProduct}
          className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong bg-raised/30 px-4 py-2.5 text-xs text-ink-3 transition hover:border-success hover:text-success"
        >
          <Plus size={14} />
          {t("wizard.addProduct")}
        </button>
      </section>

      {/* ── Props / key objects section ─────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-ink-2">
              {t("wizard.propReferences")} ({props.length})
            </h3>
            <p className="mt-0.5 text-[0.6875rem] text-ink-5">
              {t("wizard.propReferencesHint")}
            </p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {props.map((prop) => (
          <div
            key={prop.id}
            role="button"
            tabIndex={0}
            onClick={() => setEditingAsset(prop)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setEditingAsset(prop); } }}
            className="group relative flex cursor-pointer items-center gap-3 overflow-hidden rounded-xl border border-line bg-raised/50 p-2.5 transition hover:border-line-strong focus:border-accent focus:outline-none"
          >
            <div className="relative flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-app" onClick={(e) => e.stopPropagation()}>
              {prop.imageUrl ? (
                <Lightbox src={prop.imageUrl} alt={prop.name}>
                  <img src={prop.imageUrl} alt={prop.name} className="h-full w-full object-contain" />
                </Lightbox>
              ) : (
                <div className="flex h-full w-full items-center justify-center text-ink-5">
                  <ImageIcon size={16} />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1 py-1 pr-1">
              <p className="text-sm font-medium text-ink">{prop.name || t("assetEditor.unnamedProp")}</p>
              <p className="mt-0.5 line-clamp-2 text-xs text-ink-4">{(prop.description || prop.prompt || "—").split("\n")[0]}</p>
              {prop.error && <p className="mt-0.5 truncate text-[0.625rem] text-danger" title={prop.error}>{t("assetEditor.generateFailedWith", { message: prop.error })}</p>}
            </div>
            <div className="absolute right-2 top-2 flex shrink-0 flex-col gap-1 opacity-0 transition group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => void handleDeleteAsset(prop)}
                className="rounded p-1.5 text-ink-4 hover:bg-danger-deep hover:text-danger"
                title={t("assetEditor.delete")}
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
          ))}
        </div>

        <button
          onClick={handleAddProp}
          className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong bg-raised/30 px-4 py-2.5 text-xs text-ink-3 transition hover:border-success hover:text-success"
        >
          <Plus size={14} />
          {t("wizard.addProp")}
        </button>
      </section>


      {/* ── Asset review gate ──────────────────────────────────────────── */}
      {project?.automationMode !== "auto" && (
        <div className="rounded-xl border border-line bg-raised/50 p-4">
          <h3 className="text-sm font-semibold text-ink">{t("review.assetsQualityCheck")}</h3>
          <p className="mt-1 text-xs text-ink-3">{t("review.assetsHint")}</p>
          <button
            onClick={() => {
              useProjectStore.getState().updateProject({ assetsReviewed: true });
              setWizardStep(3);
            }}
            disabled={anyGenerating}
            className="mt-3 rounded-lg bg-success-solid px-4 py-2 text-xs font-medium text-white transition hover:bg-success-solid disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("review.confirmAssets")}
          </button>
        </div>
      )}
    </div>
  );
}
