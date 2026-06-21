// ────────────────────────────────────────────────────────────────────────────
// src/services/scriptService.ts
// Generates structured shots from a user prompt using the text model.
// ────────────────────────────────────────────────────────────────────────────

import type { Shot } from "@/stores/projectStore";
import { MODELS } from "@/lib/models";

interface GenerateScriptOptions {
  apiKey: string;
  baseUrl: string;
  prompt: string;
  language: "zh" | "en";
  aspectRatio: string;
}

interface RawShot {
  scriptText: string;
  visualPrompt: string;
  duration: number;
}

/**
 * Extract JSON object from a model response that may contain markdown fences,
 * preamble text, or trailing commentary.
 */
function extractJsonFromResponse(content: string): string | null {
  // 1. Try markdown code block first (```json ... ``` or ``` ... ```)
  const fenced = content.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenced) {
    const inner = fenced[1].trim();
    if (inner.startsWith("{")) return inner;
  }

  // 2. Try to find the outermost { ... } that contains "shots"
  // Use brace-counting to avoid greedy over-match
  const start = content.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  for (let i = start; i < content.length; i++) {
    if (content[i] === "{") depth++;
    if (content[i] === "}") depth--;
    if (depth === 0) {
      return content.slice(start, i + 1);
    }
  }

  // 3. Fallback: last resort greedy match
  const fallback = content.match(/\{[\s\S]*\}/);
  return fallback ? fallback[0] : null;
}

const MAX_SCRIPT_RETRIES = 2;

/**
 * Call the text model to generate a structured shot list from a user prompt.
 * Returns an array of shots (without id/index/status — those are added by the store).
 */
export async function generateScript(
  opts: GenerateScriptOptions,
): Promise<Omit<Shot, "id" | "index" | "status">[]> {
  const systemPrompt =
    opts.language === "zh"
      ? `你是一位专业的短视频分镜策划师。用户会给你一个主题或想法，你需要将其拆分为 4-6 个分镜镜头。

严格按以下 JSON 格式返回，不要包含任何其他文字：
{
  "shots": [
    {
      "scriptText": "该镜头的旁白/文案（中文，简短有力）",
      "visualPrompt": "该镜头的画面描述（英文，用于 AI 图像生成，详细具体，包含风格、构图、光线）",
      "duration": 5
    }
  ]
}

要求：
- 每个镜头 duration 为 3、5 或 8 秒
- visualPrompt 必须用英文，描述要具体、可视化
- scriptText 用用户相同的语言
- 整体节奏要有起承转合
- 总镜头数 4-6 个`
      : `You are a professional short-video storyboard planner. The user will give you a topic or idea. Break it into 4-6 shot scenes.

Return strictly in this JSON format, no other text:
{
  "shots": [
    {
      "scriptText": "Narration/copy for this shot (short, punchy)",
      "visualPrompt": "Detailed visual description for AI image generation (English, include style, composition, lighting)",
      "duration": 5
    }
  ]
}

Requirements:
- Each shot duration: 3, 5, or 8 seconds
- visualPrompt must be in English, detailed and visual
- scriptText in the user's language
- Overall pacing: setup, development, climax, resolution
- 4-6 shots total`;

  const url = `${opts.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_SCRIPT_RETRIES; attempt++) {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model: MODELS.text,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: opts.prompt },
        ],
        temperature: 0.7,
        max_tokens: 2048,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`Script API error ${resp.status}: ${body}`);
    }

    const contentType = resp.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      const body = await resp.text().catch(() => "");
      throw new Error(
        `Script API 返回了非 JSON 响应 (Content-Type: ${contentType})。请检查 Base URL 是否正确。响应前 200 字符：${body.slice(0, 200)}`,
      );
    }

    const json = await resp.json();
    const content: string = json.choices?.[0]?.message?.content ?? "";

    const jsonStr = extractJsonFromResponse(content);
    if (!jsonStr) {
      lastError = new Error(
        `无法从模型响应中提取 JSON（第 ${attempt + 1} 次尝试）。响应内容：${content.slice(0, 200)}`,
      );
      if (attempt < MAX_SCRIPT_RETRIES) continue;
      throw lastError;
    }

    try {
      const parsed = JSON.parse(jsonStr) as { shots: RawShot[] };
      if (!Array.isArray(parsed.shots) || parsed.shots.length === 0) {
        throw new Error("Model returned empty or invalid shots array.");
      }

      const shots = parsed.shots.map((s) => ({
        scriptText: s.scriptText ?? "",
        visualPrompt: s.visualPrompt ?? "",
        duration: [3, 5, 8].includes(s.duration) ? s.duration : 5,
      }));

      // Validate: every shot must have a non-empty visualPrompt
      // If empty, generate a fallback from scriptText
      for (const shot of shots) {
        if (!shot.visualPrompt.trim() && shot.scriptText.trim()) {
          shot.visualPrompt = `Cinematic shot: ${shot.scriptText.trim()}, professional lighting, high quality, detailed composition`;
        }
      }

      // If any shot still has empty visualPrompt, reject and retry
      const hasEmpty = shots.some((s) => !s.visualPrompt.trim());
      if (hasEmpty && attempt < MAX_SCRIPT_RETRIES) {
        lastError = new Error("部分分镜缺少画面描述，自动重试...");
        continue;
      }

      return shots;
    } catch (parseErr) {
      lastError = new Error(
        `JSON 解析失败（第 ${attempt + 1} 次尝试）：${parseErr instanceof Error ? parseErr.message : String(parseErr)}。提取内容：${jsonStr.slice(0, 200)}`,
      );
      if (attempt < MAX_SCRIPT_RETRIES) continue;
      throw lastError;
    }
  }

  throw lastError ?? new Error("Script generation failed after retries.");
}
