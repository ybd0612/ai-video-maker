// ────────────────────────────────────────────────────────────────────────────
// src/lib/plans.ts
// Agnes AI 访问计划与用量限制配置（单一事实源）。
//
// 数据来源：https://agnes-ai.cn/zh-Hans/docs/tokenplan （生效 2026-06-22）
// ⚠️ 本表按官方文档给出的「实际 RPM」取值，只是**开环粗过滤**，防不住 429：
// 2026-09-23 实测免费档文档值 text RPM=20，而服务端在 12 请求/38s 与 7 请求/37s
// 就返回 429，等待分支一次都没触发；同期另有 20 请求/60s 全绿的窗口，
// 说明真实限额不是单纯按请求条数计。429 的兜底在 services/rateLimit.ts
// （收到 429 后按分钟级登记冷却，同 kind 请求一律等到窗口解除）。
// 新增入口务必同时挂上该闭环，不要靠本表兜量。
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
 * 视频批量并发数。
 * 免费档视频 RPM=1，并发再高也只会撞 429；企业 2；Token Plan 3。
 */
export function videoConcurrencyFor(plan: PlanConfig): number {
  if (plan.accessType === "tokenplan") return 3;
  return rpmFor(plan, "video") <= 1 ? 1 : 2;
}

/**
 * 允许同时挂着的在飞视频任务上限 = 并发 + 1。
 *
 * 为什么不是「有在飞就不开工」：服务端可能受理某个任务后既不出片也不给终态
 * （2026-09-28 实测 GET 返回 200 + status=in_progress + internal_progress=0 +
 * expires_at=null，挂 2 小时 14 分）。旧口径让其余镜头整批陪绑停摆，界面上
 * 「补做缺失」又被禁用，等于没有出路。留 1 个余量既能保住那条已计费任务的
 * 续轮询身份，又不会无上限地把饱和队列越挤越死。
 */
export function videoInFlightCapFor(plan: PlanConfig): number {
  return videoConcurrencyFor(plan) + 1;
}

/**
 * 将尺寸串映射到官方尺寸档位。
 * - 档位串（"1K"/"2K"/"3K"/"4K"，大小写不敏感）直接透传；
 * - 像素尺寸串（如 "1344x768" / "1024x1024"）按官方档位长边解析：
 *   1K≈1312、2K≈2624、3K≈3936、4K≈5248；
 * - 无法识别时回退 1K。
 */
export function imageSizeToTier(size: string | undefined): SizeTier {
  const tierMatch = /^\s*(1K|2K|3K|4K)\s*$/i.exec(size ?? "");
  if (tierMatch) return tierMatch[1].toUpperCase() as SizeTier;
  const m = /^(\d+)\s*x\s*(\d+)$/i.exec(size?.trim() ?? "");
  if (!m) return "1K";
  const maxEdge = Math.max(Number(m[1]), Number(m[2]));
  if (maxEdge < 1500) return "1K";
  if (maxEdge < 2700) return "2K";
  if (maxEdge < 4000) return "3K";
  return "4K";
}
