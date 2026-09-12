// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/StepImages.tsx
// Step 4: Generate images for all shots, with re-roll support.
// ────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef } from "react";
import { useProjectStore, selectActiveProject } from "@/stores/projectStore";
import { useT } from "@/i18n";
import { ShotCard } from "./ShotCard";
import { PromptSubFields } from "./PromptSubFields";
import { Lightbox } from "@/components/ui/Lightbox";
import { useWizardActions } from "./useWizardActions";
import { ReviewCheckpoint } from "./ReviewCheckpoint";
import { confirmDialog } from "@/components/ui/ConfirmDialog";
import { RefreshCw } from "lucide-react";

export function StepImages() {
  const t = useT();
  const project = useProjectStore(selectActiveProject);
  const setWizardStep = useProjectStore((s) => s.setWizardStep);
  const { generateImagesForStep, rerollImage } = useWizardActions();

  const shots = project?.shots ?? [];
  const imagedCount = shots.filter((s) => !!s.imageUrl).length;
  const allImaged = shots.length > 0 && shots.every((s) => !!s.imageUrl);
  const failedCount = shots.filter((s) => s.status === "failed").length;
  // 缺少画面描述的镜头：不会参与图片生成（静默跳过会让用户困惑）
  const missingPromptCount = shots.filter((s) => !s.visualPrompt.trim()).length;
  // 所有 shot 均已落定（成功或失败）时才显示审核卡点，避免失败时用户卡住
  const allSettled = shots.length > 0 && shots.every((s) => !!s.imageUrl || s.status === "failed");
  const generatingCount = shots.filter((s) => s.status === "imaging").length;

  // 自动开始/恢复图片生成：挂载时触发一次（shots.length 变化时重算）。
  // 注意：不依赖 imageGenerationStarted —— 批量生成内部会把它置 true，
  // 若加入依赖会导致 effect 重入，误杀进行中的图片请求。
  useEffect(() => {
    if (shots.length > 0) {
      const needsImages = shots.some((s) => !s.imageUrl);
      if (needsImages) {
        generateImagesForStep();
      }
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

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 py-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-200">
          {t("wizard.step4")} ({imagedCount}/{shots.length})
        </h2>
        <div className="flex items-center gap-2">
          {generatingCount > 0 && (
            <span className="flex items-center gap-1 text-[0.6875rem] text-violet-400">
              <RefreshCw size={11} className="animate-spin" />
              {generatingCount} {t("wizard.generating")}
            </span>
          )}
          {failedCount > 0 && (
            <button
              onClick={() => generateImagesForStep()}
              disabled={generatingCount > 0}
              className="flex items-center gap-1 rounded px-2 py-1 text-[0.6875rem] text-red-400 hover:bg-red-950/30 transition disabled:opacity-50"
            >
              <RefreshCw size={11} />
              {t("wizard.retryFailed")} ({failedCount})
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
            className="flex items-center gap-1 rounded px-2 py-1 text-[0.6875rem] text-emerald-400 hover:bg-emerald-950/30 transition disabled:opacity-50"
          >
            <RefreshCw size={11} />
            {t("wizard.rerollAll")}
          </button>
        </div>
      </div>

      {/* 缺少画面描述的镜头提示（不会参与生成） */}
      {missingPromptCount > 0 && (
        <div className="rounded-lg border border-amber-800 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
          {t("wizard.missingVisualPrompt", { count: missingPromptCount })}
        </div>
      )}

      {/* 步骤级进度条 */}
      {shots.length > 0 && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full bg-violet-500 transition-all duration-300"
            style={{ width: `${(imagedCount / shots.length) * 100}%` }}
          />
        </div>
      )}

      <div className="flex flex-col gap-2">
        {shots.map((shot) => (
          <ShotCard
            key={shot.id}
            shot={shot}
            mode="image"
            onReroll={() => rerollImage(shot.id)}
            isGenerating={shot.status === "imaging"}
          >
            {shot.imageUrl && (
              <Lightbox src={shot.imageUrl} alt={`Shot ${shot.index + 1}`}>
                <div className="overflow-hidden rounded-md border border-slate-700">
                  <img
                    src={shot.imageUrl}
                    alt={`Shot ${shot.index + 1}`}
                    className="w-full object-contain max-h-48"
                  />
                </div>
              </Lightbox>
            )}
            <PromptSubFields shotId={shot.id} sections={["image", "negative"]} />
          </ShotCard>
        ))}
      </div>

      {allSettled && (
        <ReviewCheckpoint
          mode={project?.automationMode ?? "semi-auto"}
          onConfirm={() => setWizardStep(5)}
          failedShots={shots
            .filter((s) => s.status === "failed")
            .map((s) => ({ index: s.index, error: s.error }))}
          onRetryFailed={() => generateImagesForStep()}
        />
      )}
    </div>
  );
}
