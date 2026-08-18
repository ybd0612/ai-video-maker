// ────────────────────────────────────────────────────────────────────────────
// src/lib/plans.ts
// Agnes AI 访问计划与用量限制配置（单一事实源）。
//
// 数据来源：https://agnes-ai.com/zh-Hans/docs/tokenplan （生效 2026-06-22）
// 代码中以文档给出的「实际 RPM」作为安全执行上限（更保守，避免触发 429）。
//
// 访问类型（accessType）：
//   - default   免费 / 默认用户（未订阅 Token Plan、未完成企业认证）
//   - enterprise 企业认证用户（更高基准 RPM）
//   - tokenplan Token Plan 订阅用户（Starter / Plus / Pro 三档，额外有订阅配额）
//
// 注意：同一用户可能同时持多种类型密钥，彼此限制池独立。本应用每个用户仅一个
// API Key，故按其在设置中选择的套餐（plan）执行对应限制即可。
// ────────────────────────────────────────────────────────────────────────────

/* ── 时间窗口（毫秒） ──────────────────────────────────────────────────────── */

export const WINDOW = {
  /** 5 小时（Token Plan 文本配额窗口） */
  FIVE_HOURS: 5 * 60 * 60 * 1000,
  /** 1 周（Token Plan 文本配额窗口） */
  WEEK: 7 * 24 * 60 * 60 * 1000,
  /** 1 天（图片 / 视频配额窗口） */
  DAY: 24 * 60 * 60 * 1000,
  /** 1 分钟（RPM 滑动窗口） */
  MINUTE: 60 * 1000,
} as const;

/* ── 类型 ────────────────────────────────────────────────────────────────── */

export type PlanId = "default" | "enterprise" | "starter" | "plus" | "pro";
export type AccessType = "default" | "enterprise" | "tokenplan";
export type ModelKind = "text" | "image" | "video";

/** 图片尺寸档位（对应官方 1K / 2K / 3K / 4K） */
export type SizeTier = "1K" | "2K" | "3K" | "4K";

/* ── RPM 限制表（实际 RPM，作为安全上限） ──────────────────────────────────── */

interface RpmTable {
  text: number;
  image: Record<SizeTier, number>;
  video: number;
}

/* ── 订阅配额（仅 Token Plan 有；按档位区分文本，图片/视频各档相同） ──────────── */

interface QuotaConfig {
  /** 文本请求：每 5 小时上限 */
  textPer5h?: number;
  /** 文本请求：每周上限 */
  textPerWeek?: number;
  /** 图片：每日生成张数上限 */
  imagePerDay?: number;
  /** 视频：每日生成秒数上限 */
  videoSecondsPerDay?: number;
}

export interface PlanConfig {
  id: PlanId;
  /** 设置下拉显示名（中文） */
  label: string;
  /** 设置下拉显示名（英文） */
  labelEn: string;
  accessType: AccessType;
  rpm: RpmTable;
  quota: QuotaConfig;
}

/* ── 套餐定义 ──────────────────────────────────────────────────────────────── */

export const PLANS: Record<PlanId, PlanConfig> = {
  default: {
    id: "default",
    label: "免费 / 默认",
    labelEn: "Free / Default",
    accessType: "default",
    rpm: {
      text: 20,
      image: { "1K": 20, "2K": 10, "3K": 1, "4K": 1 },
      video: 1,
    },
    quota: {},
  },
  enterprise: {
    id: "enterprise",
    label: "企业认证",
    labelEn: "Enterprise",
    accessType: "enterprise",
    rpm: {
      text: 40,
      image: { "1K": 40, "2K": 20, "3K": 1, "4K": 1 },
      video: 2,
    },
    quota: {},
  },
  starter: {
    id: "starter",
    label: "Token Plan · Starter",
    labelEn: "Token Plan · Starter",
    accessType: "tokenplan",
    rpm: {
      text: 1000,
      image: { "1K": 100, "2K": 80, "3K": 1, "4K": 1 },
      video: 5,
    },
    quota: { textPer5h: 1500, textPerWeek: 15000, imagePerDay: 4000, videoSecondsPerDay: 500 },
  },
  plus: {
    id: "plus",
    label: "Token Plan · Plus",
    labelEn: "Token Plan · Plus",
    accessType: "tokenplan",
    rpm: {
      text: 1000,
      image: { "1K": 100, "2K": 80, "3K": 1, "4K": 1 },
      video: 5,
    },
    quota: { textPer5h: 7500, textPerWeek: 75000, imagePerDay: 4000, videoSecondsPerDay: 500 },
  },
  pro: {
    id: "pro",
    label: "Token Plan · Pro",
    labelEn: "Token Plan · Pro",
    accessType: "tokenplan",
    rpm: {
      text: 1000,
      image: { "1K": 100, "2K": 80, "3K": 1, "4K": 1 },
      video: 5,
    },
    quota: { textPer5h: 30000, textPerWeek: 300000, imagePerDay: 4000, videoSecondsPerDay: 500 },
  },
};

export const DEFAULT_PLAN: PlanId = "default";

/* ── 工具函数 ──────────────────────────────────────────────────────────────── */

/** 解析套餐配置；非法值回退到 default。 */
export function resolvePlan(id: PlanId | undefined | null): PlanConfig {
  if (id && PLANS[id]) return PLANS[id];
  return PLANS[DEFAULT_PLAN];
}

/** 取某套餐某模型种类的 RPM 上限（图片按尺寸档位）。 */
export function rpmFor(plan: PlanConfig, kind: ModelKind, tier?: SizeTier): number {
  if (kind === "image") return plan.rpm.image[tier ?? "1K"];
  return plan.rpm[kind];
}

/**
 * 将像素尺寸字符串（如 "1344x768" / "1024x1024"）映射到官方尺寸档位。
 * 依据官方档位长边：1K≈1312、2K≈2624、3K≈3936、4K≈5248。
 */
export function imageSizeToTier(size: string | undefined): SizeTier {
  const m = /^(\d+)\s*x\s*(\d+)$/i.exec(size?.trim() ?? "");
  if (!m) return "1K";
  const maxEdge = Math.max(Number(m[1]), Number(m[2]));
  if (maxEdge < 1500) return "1K";
  if (maxEdge < 2700) return "2K";
  if (maxEdge < 4000) return "3K";
  return "4K";
}
