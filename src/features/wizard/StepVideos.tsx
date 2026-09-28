// ────────────────────────────────────────────────────────────────────────────
// src/features/wizard/StepVideos.tsx
// Step 5: Generate videos for all shots.
// 2026-09-24 双栏改造：左镜头轨 + 右常驻详情（播放器、镜级进度、衔接解释）。
// ⚠ 页面继续在组件内部渲染 WizardShell，不得加 key：重挂载会让下方自动生成
// effect 再跑一次批量视频任务（按秒计费）。
// ⚠ 衔接解释只读：planShotContinuity / tailFrame 的结果只在发请求时派生、绝不写回 store，
// 以维持「随请求重算、刷新后自动降级为仅锁本镜首帧」（useDualFrame/lastFrameUrl 已归 RUNTIME 字段，写回不再清空视频）。
// ────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useRef } from "react";
import { useProjectStore, selectActiveProject } from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useT } from "@/i18n";
import { PromptSubFields } from "./PromptSubFields";
import { Lightbox } from "@/components/ui/Lightbox";
import { useWizardActions } from "./useWizardActions";
import { pendingVideoShots } from "@/lib/shotQueue";
import { hasActiveVideoTask } from "./useVideoActions";
import { MEDIA_FRAME, placeholderClass, resolveAspect } from "@/lib/mediaLayout";
import { syncSelectionWithShots } from "@/lib/railSelection";
import { describeFirstFrameSource, firstFrameSourceKey } from "@/lib/firstFrameSource";
import { snapshotTailFrames } from "@/lib/tailFrameStore";
import { StepProgressBar } from "./StepProgressBar";
import { StepHeader } from "./StepHeader";
import { WizardShell } from "./WizardShell";
import { WizardRail } from "./WizardRail";
import { WizardMessages } from "./WizardMessages";
import { ExpandableSection } from "./ExpandableSection";
import { confirmDialog } from "@/components/ui/ConfirmDialog";
import { RefreshCw } from "lucide-react";

export function StepVideos() {
  const t = useT();
  const project = useProjectStore(selectActiveProject);
  const aspect = resolveAspect(project?.aspectRatio);
  const plan = useSettingsStore((s) => s.providerConfig.plan);
  const videoConsistency = useSettingsStore((s) => s.videoConsistency);
  const setWizardStep = useProjectStore((s) => s.setWizardStep);
  const { generateVideosForStep, rerollVideo, giveUpVideoTask } = useWizardActions();

  const shots = project?.shots ?? [];
  const videoedCount = shots.filter((s) => !!s.videoUrl).length;
  const allVideoed = shots.length > 0 && shots.every((s) => !!s.videoUrl);
  const failedCount = shots.filter((s) => s.status === "failed").length;
  // 仅用于「N 生成中」计数；**不得**参与按钮禁用 —— 服务端不给终态时它恒为真，
  // 会把「补做缺失」永久禁掉（2026-09-28 事故：其余镜头两小时无法开工）
  const generatingCount = shots.filter((s) => s.status === "videoing").length;
  // 按钮禁用的唯一判据：该项目是否真有批量在跑（模块级注册表，与代码守卫同口径）
  const batchActive = project ? hasActiveVideoTask(project.id) : false;
  // 与批量生成同一口径：待补做 = 有图 + 有动态描述 + 无视频 + 非生成中（含失败镜头）
  const pending = pendingVideoShots(shots);
  const pendingCount = pending.length;
  // 排队中的镜头：已准备好但尚未开始生成
  const queueCount = pending.filter((s) => s.status === "imaged").length;
  // 成本预估：成片总时长 + 待生成视频的配额消耗（时长秒数）
  const totalDuration = shots.reduce((sum, s) => sum + (s.duration || 0), 0);
  const pendingSeconds = pending.reduce((sum, s) => sum + (s.duration || 0), 0);

  // 双栏选中态：页面局部，不持久化（设计稿 §16 决策 2）
  const [currentShotId, setCurrentShotId] = useState<string | undefined>(undefined);
  const [railCompact, setRailCompact] = useState(false);
  const currentId = syncSelectionWithShots(shots.map((s) => s.id), currentShotId);
  const current = shots.find((s) => s.id === currentId);

  // 生成完成 toast：allVideoed 从 false→true 时短暂提示
  const [showDoneToast, setShowDoneToast] = useState(false);
  const prevAllVideoedRef = useRef(allVideoed);
  useEffect(() => {
    if (allVideoed && !prevAllVideoedRef.current) {
      setShowDoneToast(true);
      const timer = setTimeout(() => setShowDoneToast(false), 4000);
      prevAllVideoedRef.current = allVideoed;
      return () => clearTimeout(timer);
    }
    prevAllVideoedRef.current = allVideoed;
  }, [allVideoed]);

  // 自动开始/恢复视频生成：挂载时触发一次（shots.length 变化时重算）。
  // 存在已计费的在飞任务时批量会自行不新建（见 useVideoActions.buildTasks），
  // 那些镜头由容器挂载时的 resumePendingVideoTasks 并发续轮询，故此处无需并入该集合。
  // 注意：不依赖 videoGenerationStarted —— 批量生成内部会把它置 true，
  // 若加入依赖会导致 effect 重入，generateVideosForStep 的幂等守卫会跳过，但更稳妥的做法是只触发一次。
  useEffect(() => {
    if (pendingVideoShots(shots).length > 0) {
      generateVideosForStep();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shots.length]);

  // auto 模式：所有视频完成后自动推进到 Step 6。
  // 仅在本次观察期间「从缺到齐」（false→true）时推进：挂载时已全部就绪
  // （如从后续步骤返回）不推进，避免用户无法返回上一步修改。
  const prevAllVideoedByProjectRef = useRef<Record<string, boolean>>({});
  useEffect(() => {
    const pid = project?.id;
    if (!pid) return;
    const prev = prevAllVideoedByProjectRef.current[pid] ?? allVideoed;
    prevAllVideoedByProjectRef.current[pid] = allVideoed;
    if (allVideoed && !prev && project?.automationMode === "auto") {
      setWizardStep(6);
    }
  }, [allVideoed, project?.id, project?.automationMode, setWizardStep]);

  // 首帧来源解释：与 videoPlan 的素材决策同源（都走 shotContinuity 闸门），只读不写回
  const firstFrameSource = current && project
    ? describeFirstFrameSource({
        shotId: current.id,
        shots: project.shots.map((s) => ({
          id: s.id,
          index: s.index,
          imageUrl: s.imageUrl,
          activeSceneId: s.activeSceneId,
          activeCharacterIds: s.activeCharacterIds,
          shotSize: s.shotSize,
        })),
        useDualFrame: current.useDualFrame,
        lastFrameUrl: current.lastFrameUrl,
        consistency: videoConsistency,
        tailFrames: snapshotTailFrames(),
      })
    : null;
  const handoffIndex = firstFrameSource?.kind === "handoff"
    ? shots.find((s) => s.id === firstFrameSource.fromShotId)?.index
    : undefined;

  return (
    <WizardShell
      header={<>
        <StepHeader
          titleKey="wizard.step5"
          done={videoedCount}
          total={shots.length}
          actions={<>
            {generatingCount > 0 && (
              <span className="flex items-center gap-1 text-[0.6875rem] text-warn">
                <RefreshCw className="h-3 w-3 animate-spin" />
                {generatingCount} {t("wizard.generating")}
              </span>
            )}
            {queueCount > 0 && (
              <span className="text-[0.6875rem] text-ink-4">
                {t("wizard.queueCount", { count: queueCount })} ·{" "}
                {t(plan === "default" ? "wizard.queueHintDefault" : "wizard.queueHintFaster")}
              </span>
            )}
            {pendingCount > 0 && (
              <button
                onClick={() => generateVideosForStep()}
                disabled={batchActive}
                className={`flex items-center gap-1 rounded px-2 py-1 text-[0.6875rem] transition disabled:opacity-50 ${
                  failedCount > 0 ? "text-danger hover:bg-danger-deep/30" : "text-warn hover:bg-warn-deep/30"
                }`}
                title={t("wizard.retryPendingHint")}
              >
                <RefreshCw className="h-3 w-3" />
                {t(failedCount > 0 ? "wizard.retryFailed" : "wizard.retryPending")} ({pendingCount})
              </button>
            )}
            <button
              onClick={async () => {
                // 全部重新生成：先确认成本（整套视频配额），再清空走批量生成（幂等 + 并发受控）
                const ok = await confirmDialog({
                  title: t("wizard.rerollAllConfirmTitle"),
                  message: t("wizard.rerollAllVideosConfirm", { count: shots.filter((s) => !!s.videoUrl).length }),
                  confirmLabel: t("dialog.confirm"),
                  variant: "danger",
                });
                if (!ok) return;
                const pid = project?.id;
                if (!pid) return;
                for (const s of shots) {
                  if (s.videoUrl) {
                    useProjectStore.getState().updateShotByProjectId(pid, s.id, {
                      videoUrl: undefined,
                      status: "imaged",
                      videoProgress: 0,
                    });
                  }
                }
                generateVideosForStep();
              }}
              disabled={batchActive}
              className="flex items-center gap-1 rounded px-2 py-1 text-[0.6875rem] text-success hover:bg-success-deep/30 transition disabled:opacity-50"
            >
              <RefreshCw className="h-3 w-3" />
              {t("wizard.rerollAll")}
            </button>
          </>}
        />

        {/* 成本预估：成片总时长 + 待生成视频配额消耗 */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[0.6875rem] text-ink-4">
          <span>{t("wizard.videoDurationEstimate", { seconds: totalDuration })}</span>
          {pendingSeconds > 0 && (
            <span className="text-warn/80">
              {t("wizard.videoQuotaEstimate", { seconds: pendingSeconds })}
            </span>
          )}
        </div>

        {/* 步骤级进度条（语义色与图片页统一为 accent） */}
        <StepProgressBar done={videoedCount} total={shots.length} />

        {/* 生成完成 toast */}
        {showDoneToast && (
          <div className="rounded-lg border border-success bg-success-deep/40 px-4 py-2.5 text-center text-xs text-success">
            ✓ {t("wizard.videosDone")}
          </div>
        )}
      </>}
      rail={
        <WizardRail
          shots={shots}
          currentId={currentId}
          onSelect={setCurrentShotId}
          aspect={aspect}
          mode="video"
          pendingIds={pending.map((s) => s.id)}
          compact={railCompact}
          onToggleCompact={() => setRailCompact((v) => !v)}
        />
      }
      detail={current && firstFrameSource ? (
        <div key={current.id} className="flex flex-col gap-3">
          {/* 衔接解释：说清本镜首帧从哪来、为什么没接上 */}
          <p className="text-[0.6875rem] text-ink-3">
            {t(firstFrameSourceKey(firstFrameSource), handoffIndex === undefined ? {} : { index: handoffIndex + 1 })}
          </p>

          <div className="flex gap-2">
            {current.imageUrl && (
              <Lightbox src={current.imageUrl} alt={`Ref ${current.index + 1}`}>
                <div className={`${MEDIA_FRAME.detailSecondary[aspect].containerClass} shrink-0 overflow-hidden rounded-md border border-line`}>
                  <img
                    src={current.imageUrl}
                    alt={`Ref ${current.index + 1}`}
                    className={MEDIA_FRAME.detailSecondary[aspect].mediaClass}
                  />
                </div>
              </Lightbox>
            )}
            {current.videoUrl ? (
              <div className={`${MEDIA_FRAME.detailPrimary[aspect].containerClass} overflow-hidden rounded-md border border-line bg-surface`}>
                <video
                  src={current.videoUrl}
                  controls
                  loop
                  className={`${MEDIA_FRAME.detailPrimary[aspect].mediaClass} bg-app`}
                />
              </div>
            ) : current.status === "videoing" ? (
              <div className={`${placeholderClass(aspect)} border-warn bg-warn-deep/10`}>
                <div className="flex flex-col items-center gap-1">
                  <div className="h-1.5 w-20 overflow-hidden rounded-full bg-raised">
                    <div
                      className="h-full rounded-full bg-warn-solid transition-all duration-500"
                      style={{ width: `${current.videoProgress ?? 0}%` }}
                    />
                  </div>
                  <span className="text-[0.625rem] text-warn">
                    {current.videoProgress ?? 0}%
                  </span>
                  {current.videoRetryCount && current.videoRetryCount > 0 && (
                    <span className="text-[0.5625rem] text-ink-4">
                      Retry {current.videoRetryCount}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div className={`${placeholderClass(aspect)} border-line bg-raised/30`}>
                <span className="text-[0.625rem] text-ink-5">{t("wizard.waiting")}</span>
              </div>
            )}
          </div>

          <ExpandableSection title={t("pipeline.motionPrompt")} text={current.motionPrompt} />
          <PromptSubFields shotId={current.id} sections={["motion"]} />

          <WizardMessages error={current.error} />
        </div>
      ) : (
        <p className="text-xs text-ink-4">{t("rail.empty")}</p>
      )}
      detailActions={current ? (
        <>
          <button
            type="button"
            onClick={() => rerollVideo(current.id)}
            disabled={batchActive || current.status === "videoing"}
            className="flex items-center gap-1 rounded-md border border-line px-3 py-1.5 text-xs text-success transition hover:bg-success-deep/30 disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${current.status === "videoing" ? "animate-spin" : ""}`} />
            {t("wizard.reroll")}
          </button>
          {/* 服务端既不吐片也不给终态时的显式出口：判死权在用户，代码不猜时长 */}
          {current.status === "videoing" && current.videoTaskId && (
            <button
              type="button"
              onClick={async () => {
                const ok = await confirmDialog({
                  title: t("wizard.giveUpConfirmTitle"),
                  message: t("wizard.giveUpConfirmMessage", { videoId: current.videoTaskId ?? "" }),
                  confirmLabel: t("wizard.giveUpVideoTask"),
                  variant: "danger",
                });
                if (ok) giveUpVideoTask(current.id);
              }}
              disabled={batchActive}
              title={t("wizard.giveUpVideoTaskHint")}
              className="flex items-center rounded-md border border-line px-3 py-1.5 text-xs text-danger transition hover:bg-danger-deep/30 disabled:opacity-50"
            >
              {t("wizard.giveUpVideoTask")}
            </button>
          )}
          {allVideoed && (
            <button
              type="button"
              onClick={() => setWizardStep(6)}
              className="flex items-center gap-1.5 rounded-md bg-success-solid px-4 py-1.5 text-xs font-medium text-white transition hover:bg-success-solid"
            >
              {t("wizard.goAssembly")}
            </button>
          )}
        </>
      ) : null}
    />
  );
}
