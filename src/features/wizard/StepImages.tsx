// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/StepImages.tsx
// Step 4: Generate images for all shots, with re-roll support.
// 2026-09-24 双栏改造：左镜头轨 + 右常驻详情（选中态是页面局部 state，不进 store）。
// ⚠ 页面不得改成 WizardShell 的路由级子组件，也不得加 key —— 下方的自动生成
// effect 与「从缺到齐」边沿检测一旦重挂载就会再触发一次批量生图（烧配额）。
// ────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from "react";
import { useProjectStore, selectActiveProject } from "@/stores/projectStore";
import { useT } from "@/i18n";
import { PromptSubFields } from "./PromptSubFields";
import { Lightbox } from "@/components/ui/Lightbox";
import { useWizardActions } from "./useWizardActions";
import { pendingImageShots, shotsWithoutVisualPrompt } from "@/lib/shotQueue";
import { MEDIA_FRAME, placeholderClass, resolveAspect } from "@/lib/mediaLayout";
import { syncSelectionWithShots } from "@/lib/railSelection";
import { explainShotReferences } from "@/lib/referencePlan";
import { ReviewCheckpoint } from "./ReviewCheckpoint";
import { StepProgressBar } from "./StepProgressBar";
import { StepHeader } from "./StepHeader";
import { WizardShell } from "./WizardShell";
import { WizardRail } from "./WizardRail";
import { WizardMessages } from "./WizardMessages";
import { confirmDialog } from "@/components/ui/ConfirmDialog";
import { RefreshCw } from "lucide-react";

export function StepImages() {
  const t = useT();
  const project = useProjectStore(selectActiveProject);
  const aspect = resolveAspect(project?.aspectRatio);
  const setWizardStep = useProjectStore((s) => s.setWizardStep);
  const updateProject = useProjectStore((s) => s.updateProject);
  const { generateImagesForStep, rerollImage } = useWizardActions();

  const shots = project?.shots ?? [];
  const imagedCount = shots.filter((s) => !!s.imageUrl).length;
  const allImaged = shots.length > 0 && shots.every((s) => !!s.imageUrl);
  const failedCount = shots.filter((s) => s.status === "failed").length;
  // 与批量生成同一口径：待补做 = 无图 + 非生成中 + 有画面提示词（含失败镜头）
  const pendingShots = pendingImageShots(shots);
  const pendingCount = pendingShots.length;
  // 缺画面提示词的镜头永远不会被生成，必须单独提示而不是静默跳过
  const noPromptCount = shotsWithoutVisualPrompt(shots).length;
  // 所有 shot 均已落定（成功或失败）时才显示审核卡点，避免失败时用户卡住
  const allSettled = shots.length > 0 && shots.every((s) => !!s.imageUrl || s.status === "failed");
  const generatingCount = shots.filter((s) => s.status === "imaging").length;

  // 双栏选中态：页面局部，不持久化（设计稿 §16 决策 2）
  const [currentShotId, setCurrentShotId] = useState<string | undefined>(undefined);
  const [railCompact, setRailCompact] = useState(false);
  const currentId = syncSelectionWithShots(shots.map((s) => s.id), currentShotId);
  const current = shots.find((s) => s.id === currentId);

  // 自动开始/恢复图片生成：挂载时触发一次（shots.length 变化时重算）。
  // 注意：不依赖 imageGenerationStarted —— 批量生成内部会把它置 true，
  // 若加入依赖会导致 effect 重入，误杀进行中的图片请求。
  useEffect(() => {
    if (pendingImageShots(shots).length > 0) {
      generateImagesForStep();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shots.length]);

  // auto 模式：所有图片完成后自动推进到 Step 5（跳过审核卡点）。
  // 仅在本次观察期间「从缺到齐」（false→true）时推进：挂载时已全部就绪
  // （如从后续步骤返回）不推进，避免用户无法返回上一步修改。
  const prevAllImagedByProjectRef = useRef<Record<string, boolean>>({});
  useEffect(() => {
    const pid = project?.id;
    if (!pid) return;
    const prev = prevAllImagedByProjectRef.current[pid] ?? allImaged;
    prevAllImagedByProjectRef.current[pid] = allImaged;
    if (allImaged && !prev && project?.automationMode === "auto") {
      setWizardStep(5);
    }
  }, [allImaged, project?.id, project?.automationMode, setWizardStep]);

  const refAssignment = current && project
    ? explainShotReferences(current, { assets: project.assets, styleReferenceUrl: project.styleReferenceUrl })
    : null;

  return (
    <WizardShell
      header={<>
        <StepHeader
          titleKey="wizard.step4"
          done={imagedCount}
          total={shots.length}
          actions={<>
            {generatingCount > 0 && (
              <span className="flex items-center gap-1 text-[0.6875rem] text-accent">
                <RefreshCw size={11} className="animate-spin" />
                {generatingCount} {t("wizard.generating")}
              </span>
            )}
            {pendingCount > 0 && (
              <button
                onClick={() => generateImagesForStep()}
                disabled={generatingCount > 0}
                className={`flex items-center gap-1 rounded px-2 py-1 text-[0.6875rem] transition disabled:opacity-50 ${
                  failedCount > 0 ? "text-danger hover:bg-danger-deep/30" : "text-warn hover:bg-warn-deep/30"
                }`}
                title={t("wizard.retryPendingHint")}
              >
                <RefreshCw size={11} />
                {t(failedCount > 0 ? "wizard.retryFailed" : "wizard.retryPending")} ({pendingCount})
              </button>
            )}
            <button
              onClick={async () => {
                // 全部重新生成：先确认成本（整套图片配额），再清空走批量生成（幂等 + 并发受控）
                const ok = await confirmDialog({
                  title: t("wizard.rerollAllConfirmTitle"),
                  message: t("wizard.rerollAllImagesConfirm", { count: shots.filter((s) => !!s.imageUrl).length }),
                  confirmLabel: t("dialog.confirm"),
                  variant: "danger",
                });
                if (!ok) return;
                const pid = project?.id;
                if (!pid) return;
                for (const s of shots) {
                  if (s.imageUrl) {
                    useProjectStore.getState().updateShotByProjectId(pid, s.id, {
                      imageUrl: undefined,
                      status: "scripted",
                    });
                  }
                }
                generateImagesForStep();
              }}
              disabled={generatingCount > 0}
              className="flex items-center gap-1 rounded px-2 py-1 text-[0.6875rem] text-success hover:bg-success-deep/30 transition disabled:opacity-50"
            >
              <RefreshCw size={11} />
              {t("wizard.rerollAll")}
            </button>
          </>}
        />

        {/* 待补做镜头（可能被失效规则清空过）：给出定点补做入口，避免整套重做 */}
        {pendingCount > 0 && generatingCount === 0 && (
          <div className="rounded-lg border border-warn/60 bg-warn-deep/20 px-3 py-2 text-xs text-warn">
            {t("wizard.pendingImagesHint", { count: pendingCount })}
          </div>
        )}

        {/* 缺少画面描述的镜头提示（不会参与生成） */}
        {noPromptCount > 0 && (
          <div className="rounded-lg border border-warn bg-warn-deep/30 px-3 py-2 text-xs text-warn">
            {t("wizard.missingVisualPrompt", { count: noPromptCount })}
          </div>
        )}

        <StepProgressBar done={imagedCount} total={shots.length} />
      </>}
      rail={
        <WizardRail
          shots={shots}
          currentId={currentId}
          onSelect={setCurrentShotId}
          aspect={aspect}
          mode="image"
          pendingIds={pendingShots.map((s) => s.id)}
          compact={railCompact}
          onToggleCompact={() => setRailCompact((v) => !v)}
        />
      }
      detail={current ? (
        <div key={current.id} className="flex flex-col gap-3">
          {current.imageUrl ? (
            <Lightbox src={current.imageUrl} alt={`Shot ${current.index + 1}`}>
              <div className={`${MEDIA_FRAME.detailPrimary[aspect].containerClass} overflow-hidden rounded-md border border-line`}>
                <img
                  src={current.imageUrl}
                  alt={`Shot ${current.index + 1}`}
                  loading="lazy"
                  className={MEDIA_FRAME.detailPrimary[aspect].mediaClass}
                />
              </div>
            </Lightbox>
          ) : (
            <div className={`${placeholderClass(aspect)} border-line`}>
              <span className="text-[0.625rem] text-ink-4">{t("rail.noImageYet")}</span>
            </div>
          )}

          {/* 参考位被景别/总数拒收时说明原因，不再静默少送参考图 */}
          {refAssignment && refAssignment.rejected.length > 0 && (
            <p className="text-[0.6875rem] text-ink-3">
              {t("image.refRejected", { count: refAssignment.rejected.length })}：
              {refAssignment.rejected
                .map((r) => `${r.name}（${t(r.because === "size-budget" ? "image.refBecauseSize" : "image.refBecauseTotal")}）`)
                .join("、")}
            </p>
          )}

          <PromptSubFields shotId={current.id} sections={["image"]} />
          <WizardMessages error={current.error} />

          {allSettled && (
            <ReviewCheckpoint
              mode={project?.automationMode ?? "semi-auto"}
              onConfirm={() => {
                updateProject({ imagesReviewed: true });
                setWizardStep(5);
              }}
              failedShots={shots
                .filter((s) => s.status === "failed")
                .map((s) => ({ index: s.index, error: s.error }))}
              onRetryFailed={() => generateImagesForStep()}
            />
          )}
        </div>
      ) : (
        <p className="text-xs text-ink-4">{t("rail.empty")}</p>
      )}
      detailActions={current ? (
        <button
          type="button"
          onClick={() => rerollImage(current.id)}
          disabled={current.status === "imaging"}
          className="flex items-center gap-1 rounded-md border border-line px-3 py-1.5 text-xs text-success transition hover:bg-success-deep/30 disabled:opacity-50"
        >
          <RefreshCw size={11} className={current.status === "imaging" ? "animate-spin" : undefined} />
          {t("wizard.reroll")}
        </button>
      ) : null}
    />
  );
}
