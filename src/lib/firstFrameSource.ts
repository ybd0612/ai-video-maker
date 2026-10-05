// ────────────────────────────────────────────────────────────────────────────
// src/lib/firstFrameSource.ts
// 「本镜首帧从哪来、为什么没衔接」的唯一解释器（纯函数，不写 store）。
// 与 videoPlan 的素材决策同源：都走 shotContinuity 的同一套闸门，
// 因此界面解释与实际请求素材不会各说各话。
// ────────────────────────────────────────────────────────────────────────────

import {
  buildHandoffMap,
  planShotContinuity,
  type ContinuitySkipReason,
  type ShotForContinuity,
} from "@/lib/shotContinuity";
import type { VideoConsistency } from "@/lib/videoPlan";
import type { TranslationKey } from "@/i18n";

export type FirstFrameSource =
  | { kind: "manual-tail" }
  | { kind: "handoff"; fromShotId: string }
  | { kind: "self"; because: "consistency-off" | "tail-missing" | "tail-local-only" | ContinuitySkipReason };

export function describeFirstFrameSource(input: {
  shotId: string;
  shots: readonly ShotForContinuity[];
  useDualFrame: boolean;
  lastFrameUrl?: string;
  consistency: VideoConsistency;
  tailFrames: Record<string, string>;
}): FirstFrameSource {
  const { shotId, shots, useDualFrame, lastFrameUrl, consistency, tailFrames } = input;
  if (useDualFrame && lastFrameUrl) return { kind: "manual-tail" };
  if (consistency === "off") return { kind: "self", because: "consistency-off" };

  const decisions = planShotContinuity(shots);
  const handoff = buildHandoffMap(decisions).get(shotId);
  if (handoff) {
    const tailFrame = tailFrames[handoff];
    if (!tailFrame) return { kind: "self", because: "tail-missing" };
    return tailFrame.startsWith("blob:")
      ? { kind: "self", because: "tail-local-only" }
      : { kind: "handoff", fromShotId: handoff };
  }
  const own = decisions.find((d) => d.shotId === shotId);
  if (!own || own.linked) return { kind: "self", because: "last-shot" };
  return { kind: "self", because: own.reason };
}

const FALLBACK: TranslationKey = "videoPlan.firstFrame.self";

const BECAUSE_KEYS: Record<string, TranslationKey> = {
  "consistency-off": "videoPlan.firstFrame.off",
  "tail-missing": "videoPlan.firstFrame.tailMissing",
  "tail-local-only": "videoPlan.firstFrame.tailLocalOnly",
  "last-shot": "videoPlan.firstFrame.firstShot",
  "no-first-frame": "videoPlan.firstFrame.prevNoImage",
  "scene-unknown": "videoPlan.firstFrame.sceneUnknown",
  "scene-changed": "videoPlan.firstFrame.sceneChanged",
  "cast-disjoint": "videoPlan.firstFrame.castDisjoint",
  "size-unknown": "videoPlan.firstFrame.sizeUnknown",
  "size-gap": "videoPlan.firstFrame.sizeGap",
};

export function firstFrameSourceKey(src: FirstFrameSource): TranslationKey {
  if (src.kind === "handoff") return "videoPlan.firstFrame.handoff";
  if (src.kind === "manual-tail") return "videoPlan.firstFrame.manualTail";
  return BECAUSE_KEYS[src.because] ?? FALLBACK;
}
