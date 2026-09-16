// ────────────────────────────────────────────────────────────────────────────
// src/lib/generationParams.ts
// 生成参数决策层：影响效果的采样参数（temperature / topP / Thinking）
// 由大模型按用途决定，代码只负责范围校验与缓存。
//
// 原则（2026-09-15 用户确立）：代码管结构化数据与流程控制，效果判断归大模型。
// 因此这里不预设"某用途该用多少温度"，只做三件事：
//   1. 把用途与上下文交给模型，由模型选择参数；
//   2. 对返回值做范围校验（结构校验属代码职责，越界一律拒绝）；
//   3. 按用途 + 缓存键复用上一次决策，避免每次调用都问一遍。
//
// 不暴露的参数（属结构问题，不是效果问题）：
//   - max_tokens：固定模型上限，防长 JSON 被截断（见 lib/models.ts）；
//   - 图像 size / ratio：画幅由项目设置决定；
//   - 视频 size / seconds / mode：接口约束与画幅。
// ────────────────────────────────────────────────────────────────────────────

import { createAIService } from "@/services/ai/factory";
import { parseJsonFromResponse } from "@/lib/jsonResponse";
import {
  buildSystemPrompt as buildRulesSystemPrompt,
  getActiveRules,
} from "@/lib/promptRules";

/** 生成用途：既作为参数决策的上下文，也作为缓存隔离粒度 */
export type GenerationPurpose =
  | "visualDirection"
  | "visualDirectionAudit"
  | "assetExtraction"
  | "storyboard"
  | "storyboardOutline"
  | "shotEdit"
  | "shotReroll"
  | "styleRef"
  | "stylePromptAudit"
  | "characterAppearance"
  | "fieldAssist";

export interface GenerationParams {
  temperature: number;
  topP?: number;
  enableThinking: boolean;
}

/**
 * 中性兜底：参数决策不可用（无 key / 网络失败 / 解析失败）时使用。
 * 这不是"最佳值"，只是一个安全可用的默认，避免阻塞生成链路。
 */
export const NEUTRAL_GENERATION_PARAMS: GenerationParams = {
  temperature: 0.7,
  enableThinking: false,
};

/** 合法区间以模型文档为准（temperature 0~2，top_p 0~1） */
export const TEMPERATURE_RANGE = [0, 2] as const;
export const TOP_P_RANGE = [0.01, 1] as const;

/**
 * 结构性禁用 Thinking 的用途（不交模型决策，与 max_tokens 同类的结构问题）：
 * 审计/重写是"格式化改写"任务，深度推理收益低但耗时翻倍 ——
 * 2026-09-15 实测同一视觉方向重写调用 63.6s → 117.6s
 * （completionTokens 1608 中 900+ 为 thinking，正文仅 661 chars）。
 */
const THINKING_FIXED_FALSE_PURPOSES: ReadonlySet<GenerationPurpose> = new Set([
  "visualDirectionAudit",
  "stylePromptAudit",
]);

function inRange(
  value: unknown,
  range: readonly [number, number],
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= range[0] &&
    value <= range[1]
  );
}

/**
 * 结构校验：只接受合法区间内的数值与布尔值，越界 / 缺失 / 类型错误一律退回 fallback。
 * 代码不猜"合理值"，只拒绝非法值。
 */
export function clampGenerationParams(
  raw: unknown,
  fallback: GenerationParams = NEUTRAL_GENERATION_PARAMS,
): GenerationParams {
  const record = (
    raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}
  ) as Record<string, unknown>;

  const temperature = inRange(record.temperature, TEMPERATURE_RANGE)
    ? record.temperature
    : fallback.temperature;
  const topP = inRange(record.topP, TOP_P_RANGE) ? record.topP : fallback.topP;
  const enableThinking =
    typeof record.enableThinking === "boolean"
      ? record.enableThinking
      : fallback.enableThinking;

  return topP === undefined
    ? { temperature, enableThinking }
    : { temperature, topP, enableThinking };
}

export interface ResolveGenerationParamsOptions {
  purpose: GenerationPurpose;
  apiKey: string;
  baseUrl: string;
  /** 该用途的运行上下文（语言、画幅、资产规模等），供模型判断 */
  context?: string;
  /** 缓存隔离键（通常为项目 id）；同用途同键复用上次决策 */
  cacheKey?: string;
  /** 跳读缓存，强制重新决策 */
  force?: boolean;
}

/** 用途 + 缓存键 → 已决策参数 */
const paramCache = new Map<string, GenerationParams>();

function cacheKeyOf(opts: ResolveGenerationParamsOptions): string {
  return `${opts.purpose}:${opts.cacheKey ?? ""}`;
}

/**
 * 让模型为该用途决定采样参数（结果按用途缓存）。
 * 决策失败不抛错：退化为 NEUTRAL_GENERATION_PARAMS，保证生成链路继续。
 */
export async function resolveGenerationParams(
  opts: ResolveGenerationParamsOptions,
): Promise<GenerationParams> {
  const key = cacheKeyOf(opts);
  if (!opts.force) {
    const cached = paramCache.get(key);
    if (cached) return cached;
  }

  try {
    const service = createAIService({
      provider: "openai",
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl,
    });
    const context = opts.context?.trim();
    const result = await service.chatCompletion({
      messages: [
        {
          role: "system",
          content: buildRulesSystemPrompt("generationParams", "en", getActiveRules()),
        },
        {
          role: "user",
          content: [
            `Purpose: ${opts.purpose}`,
            context ? `Context:\n${context}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      // 元调用自身只能用中性参数（参数决策无法先问自己），不影响任何内容产出的质量。
      temperature: NEUTRAL_GENERATION_PARAMS.temperature,
      enableThinking: false,
    });

    const parsed = parseJsonFromResponse<Record<string, unknown>>(result.content);
    const resolved = clampGenerationParams(parsed, NEUTRAL_GENERATION_PARAMS);
    // 结构约束：审计/重写类用途 Thinking 恒关（见 THINKING_FIXED_FALSE_PURPOSES 注释）
    const final = THINKING_FIXED_FALSE_PURPOSES.has(opts.purpose)
      ? { ...resolved, enableThinking: false }
      : resolved;
    paramCache.set(key, final);
    return final;
  } catch (err) {
    console.warn(
      `Generation param decision failed for ${opts.purpose}, using neutral params:`,
      err,
    );
    return NEUTRAL_GENERATION_PARAMS;
  }
}

/** 清空参数决策缓存（测试用；切换项目时可选择性调用）。 */
export function clearGenerationParamCache(): void {
  paramCache.clear();
}
