// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/StepAssets.tsx
// Step 2: Asset preparation — characters / scenes / products / style anchor.
// Generates reference images used as img2img anchors for storyboard consistency.
// ────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  useProjectStore, selectActiveProject,
  type Asset,
} from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useT } from "@/i18n";
import { ImageIcon, Loader2, Wand2 } from "lucide-react";
import { CharacterEditor } from "@/features/characters/CharacterEditor";
import { AssetListSection } from "./AssetListSection";
import { VisualDirectionEditor } from "./VisualDirectionEditor";
import { AssetEditor } from "./AssetEditor";
import { ReviewCheckpoint } from "./ReviewCheckpoint";
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
  const { generateAssetImages, generateStyleReference, generateStoryboard } = useWizardActions();

  const [editingChar, setEditingChar] = useState<Asset | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [showVisualDirectionEditor, setShowVisualDirectionEditor] = useState(false);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [generatingScenes, setGeneratingScenes] = useState<Set<string>>(new Set());
  const [generatingProducts, setGeneratingProducts] = useState<Set<string>>(new Set());
  const [generatingProps, setGeneratingProps] = useState<Set<string>>(new Set());
  const [generatingStyle, setGeneratingStyle] = useState(false);
  // 「进入分镜」过程态：在本页等待分镜首个镜头就绪后再切到步骤 3，
  // 与「想法 → 资产」同构（不在生成前切页，避免用户进去先看一屏转圈）。
  const [enteringStoryboard, setEnteringStoryboard] = useState(false);
  const [storyboardError, setStoryboardError] = useState<string | null>(null);

  // 卸载守卫：切页后 onProgress / finally 里的 setState 已无意义
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
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

  /**
   * 进入分镜页：先在资产页触发生成分镜，首个镜头就绪后再切页
   * （与「想法 → 资产」同构，避免用户进去先看一屏转圈）。
   * - 已有分镜内容：直接切页，绝不覆盖用户已确认的内容；
   * - 生成失败（大纲阶段异常）：留在资产页展示错误，用户可重试。
   */
  const enterStoryboard = async () => {
    const targetProjectId = project?.id;
    if (!targetProjectId) return;
    const idea = (project?.ideaPrompt ?? "").trim();
    const hasContent = (project?.shots ?? []).some((s) => s.scriptText.trim() || s.visualPrompt.trim());
    if (hasContent || !idea) {
      setWizardStep(3);
      return;
    }

    setEnteringStoryboard(true);
    setStoryboardError(null);
    let navigated = false;
    try {
      await generateStoryboard(idea, {
        onProgress: () => {
          // 首个镜头就该绪（成功或失败）即切页：进去立刻有内容可审，其余镜头继续填充
          if (navigated) return;
          navigated = true;
          setWizardStep(3);
        },
      });
    } catch (err) {
      setStoryboardError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) setEnteringStoryboard(false);
    }
  };

  /** 审核卡点确认：置审核标记后进入分镜（生成与切页统一由 enterStoryboard 处理） */
  const handleConfirmAssets = async () => {
    const targetProjectId = project?.id;
    if (!targetProjectId) return;
    useProjectStore.getState().updateProjectById(targetProjectId, (p) => ({ ...p, assetsReviewed: true }));
    await enterStoryboard();
  };

  // auto 模式：全部资产有图后自动推进到 Step 3（分镜页挂载后会自动生成分镜）。
  // 仅在本次观察期间「从缺到齐」（false→true）时推进：挂载时已全部就绪
  // （如从后续步骤返回）不推进，避免用户无法返回上一步修改。
  // 失败/手动资产无图会卡住推进 —— 与 StepImages 的 allImaged 语义一致，用户手动处理。
  const prevAllImagedByProjectRef = useRef<Record<string, boolean>>({});
  const allAssetsImaged = assets.length > 0 && assets.every((a) => !!a.imageUrl);
  useEffect(() => {
    const pid = project?.id;
    if (!pid) return;
    const prev = prevAllImagedByProjectRef.current[pid] ?? allAssetsImaged;
    prevAllImagedByProjectRef.current[pid] = allAssetsImaged;
    if (allAssetsImaged && !prev && project?.automationMode === "auto") {
      // 与半自动一致：先在资产页等待分镜首个镜头就绪，再切页（避免进去看一屏转圈）
      void enterStoryboard();
    }
  }, [allAssetsImaged, project?.id, project?.automationMode, setWizardStep]);

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
      {/* ── Characters（列表模板复用） ──────────────────────────────────── */}
      <AssetListSection
        title={t("characters.title")}
        assets={characters}
        emptyHint={t("wizard.noAssetsHint")}
        addLabel={t("characters.add")}
        addIcon="userPlus"
        onAdd={handleAdd}
        onOpen={handleEdit}
        onDelete={handleDelete}
        deleteLabel={t("characters.delete")}
        imageOf={(a) => a.imageUrl || a.avatarUrl}
        unnamedLabel="?"
        summaryOf={(a) => (a.description || a.appearancePrompt || "—").split("\n")[0]}
        errorOf={(a) => a.error}
      />

      {/* ── Scene references ──────────────────────────────────────────── */}
      <AssetListSection
        title={t("wizard.sceneReferences")}
        hint={t("wizard.sceneReferencesHint")}
        assets={sceneReferences}
        emptyHint={t("wizard.noAssetsHint")}
        addLabel={t("wizard.addScene")}
        onAdd={handleAddScene}
        onOpen={setEditingAsset}
        onDelete={handleDeleteAsset}
        deleteLabel={t("assetEditor.delete")}
        imageOf={(a) => a.imageUrl}
        unnamedLabel={t("assetEditor.unnamedScene")}
        summaryOf={(a) => (a.description || a.prompt || "—").split("\n")[0]}
        errorOf={(a) => a.error}
      />

      {/* ── Product references（产品主体一致性锚点） ────────────────────── */}
      <AssetListSection
        title={t("wizard.productReferences")}
        hint={t("wizard.productReferencesHint")}
        assets={products}
        emptyHint={t("wizard.noAssetsHint")}
        addLabel={t("wizard.addProduct")}
        onAdd={handleAddProduct}
        onOpen={setEditingAsset}
        onDelete={handleDeleteAsset}
        deleteLabel={t("assetEditor.delete")}
        imageOf={(a) => a.imageUrl}
        unnamedLabel={t("assetEditor.unnamedProduct")}
        summaryOf={(a) => (a.description || a.prompt || "—").split("\n")[0]}
        errorOf={(a) => a.error}
      />

      {/* ── Props / key objects ─────────────────────────────────────────── */}
      <AssetListSection
        title={t("wizard.propReferences")}
        hint={t("wizard.propReferencesHint")}
        assets={props}
        emptyHint={t("wizard.noAssetsHint")}
        addLabel={t("wizard.addProp")}
        onAdd={handleAddProp}
        onOpen={setEditingAsset}
        onDelete={handleDeleteAsset}
        deleteLabel={t("assetEditor.delete")}
        imageOf={(a) => a.imageUrl}
        unnamedLabel={t("assetEditor.unnamedProp")}
        summaryOf={(a) => (a.description || a.prompt || "—").split("\n")[0]}
        errorOf={(a) => a.error}
      />



      {/* ── Asset review gate（统一卡点实现）───────────────────────────── */}
      <ReviewCheckpoint
        mode={project?.automationMode ?? "semi-auto"}
        titleKey="review.assetsQualityCheck"
        hintKey="review.assetsHint"
        confirmLabelKey="review.confirmAssets"
        confirmDisabled={anyGenerating || enteringStoryboard}
        confirmPending={enteringStoryboard}
        confirmPendingLabelKey="wizard.storyboardPreparing"
        onConfirm={() => void handleConfirmAssets()}
        footer={<>
          {enteringStoryboard && (
            <p className="mt-2 text-[0.625rem] text-ink-5">{t("wizard.storyboardEnterHint")}</p>
          )}
          {storyboardError && (
            <p className="mt-2 text-[0.625rem] text-danger">{storyboardError}</p>
          )}
        </>}
      />
    </div>
  );
}
