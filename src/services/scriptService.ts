// ────────────────────────────────────────────────────────────────────────────
// src/services/scriptService.ts
// Generates structured shots from a user prompt using the text model.
// ────────────────────────────────────────────────────────────────────────────

import type { Shot } from "@/stores/projectStore";

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
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: "agnes-2.0-flash",
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

  const json = await resp.json();
  const content: string = json.choices?.[0]?.message?.content ?? "";

  // Extract JSON from the response (may be wrapped in markdown code block)
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Failed to parse script JSON from model response.");
  }

  const parsed = JSON.parse(jsonMatch[0]) as { shots: RawShot[] };
  if (!Array.isArray(parsed.shots) || parsed.shots.length === 0) {
    throw new Error("Model returned empty or invalid shots array.");
  }

  return parsed.shots.map((s) => ({
    scriptText: s.scriptText ?? "",
    visualPrompt: s.visualPrompt ?? "",
    duration: [3, 5, 8].includes(s.duration) ? s.duration : 5,
  }));
}
