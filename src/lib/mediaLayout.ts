// ────────────────────────────────────────────────────────────────────────────
// src/lib/mediaLayout.ts
// 画幅 → 版式的唯一口径。三页各自写死 max-h-48 / h-24，导致 9:16 竖屏素材
// 被 letterbox 成扁条、两侧大片空白（2026-09-23 取证）。所有出图/出片的容器类串
// 一律从这里取，页面不得再自带尺寸判断 —— Tailwind 需要静态类串，因此用
// 「完整字面量映射表」而不是运行时拼类（拼类不会被 JIT 收集）。
// ────────────────────────────────────────────────────────────────────────────

import type { AspectRatio } from "@/stores/projectTypes";

/** 与 projectStore 新建项目的默认画幅保持一致 */
export const DEFAULT_ASPECT: AspectRatio = "16:9";

const ASPECTS: readonly AspectRatio[] = ["9:16", "16:9", "1:1"];

/** 持久化数据 / 旧项目可能缺字段或非字符串，统一回落默认画幅，不抛错也不猜。 */
export function resolveAspect(value: unknown): AspectRatio {
  return ASPECTS.includes(value as AspectRatio) ? (value as AspectRatio) : DEFAULT_ASPECT;
}

/** 宽高比本身（容器查询与占位块共用） */
export const ASPECT_RATIO_CSS: Record<AspectRatio, string> = {
  "9:16": "aspect-[9/16]",
  "16:9": "aspect-[16/9]",
  "1:1": "aspect-square",
};

export type MediaSlot = "railThumb" | "detailPrimary" | "detailSecondary";

export interface MediaFrame {
  /** 容器类串：决定占位形状与是否撑满 */
  containerClass: string;
  /** img / video 类串：决定填充方式 */
  mediaClass: string;
}

export const MEDIA_FRAME: Record<MediaSlot, Record<AspectRatio, MediaFrame>> = {
  // 轨上缩略图：铺满格位、裁剪填满，竖横幅各自比例正确即可，不追求看清细节
  railThumb: {
    "9:16": { containerClass: "aspect-[9/16] w-full", mediaClass: "h-full w-full object-cover" },
    "16:9": { containerClass: "aspect-[16/9] w-full", mediaClass: "h-full w-full object-cover" },
    "1:1": { containerClass: "aspect-square w-full", mediaClass: "h-full w-full object-cover" },
  },
  // 详情主媒体：必须完整看得见（用户就是来验收这一帧的），因此竖幅按高度优先，
  // 绝不再用「w-full + max-h」—— 那正是今天竖屏两侧留白的直接原因。
  detailPrimary: {
    "9:16": { containerClass: "h-[58vh] max-h-[620px] aspect-[9/16]", mediaClass: "h-full w-full object-contain" },
    "16:9": { containerClass: "w-full max-h-[62vh] aspect-[16/9]", mediaClass: "h-full w-full object-contain" },
    "1:1": { containerClass: "h-[52vh] max-h-[560px] aspect-square", mediaClass: "h-full w-full object-contain" },
  },
  // 详情次级位（参考图条、尾帧预览等）：小图裁剪填满
  detailSecondary: {
    "9:16": { containerClass: "h-20 aspect-[9/16]", mediaClass: "h-full w-full object-cover" },
    "16:9": { containerClass: "h-20 w-36", mediaClass: "h-full w-full object-cover" },
    "1:1": { containerClass: "h-20 w-20", mediaClass: "h-full w-full object-cover" },
  },
};
