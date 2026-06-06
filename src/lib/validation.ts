// ────────────────────────────────────────────────────────────────────────────
// src/lib/validation.ts
// Centralized input validation & sanitization utilities.
// ────────────────────────────────────────────────────────────────────────────

/* ── Text sanitization ───────────────────────────────────────────────────── */

/** Trim leading/trailing whitespace and collapse internal runs of whitespace */
export function sanitizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Strip characters that are dangerous in data URIs / innerHTML contexts */
export function sanitizeRichText(value: string): string {
  return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim();
}

/* ── Length guards ───────────────────────────────────────────────────────── */

export interface LengthOptions {
  min?: number;
  max?: number;
}

/**
 * Validate string length. Returns `null` when valid, or a human-readable
 * error string when invalid.
 */
export function validateLength(value: string, opts: LengthOptions): string | null {
  const { min = 0, max = Infinity } = opts;
  if (value.length < min) return `至少需要 ${min} 个字符`;
  if (value.length > max) return `最多允许 ${max} 个字符`;
  return null;
}

/* ── URL validation ──────────────────────────────────────────────────────── */

export function isValidUrl(value: string): boolean {
  if (!value) return true; // empty is OK (optional field)
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/* ── API key format ──────────────────────────────────────────────────────── */

export function isValidApiKey(value: string): boolean {
  if (!value.trim()) return false;
  // Must start with sk- or similar alphanumeric prefix, minimum 10 chars
  return /^[a-zA-Z0-9][a-zA-Z0-9\-_]{8,}$/.test(value.trim());
}

/* ── Node label ──────────────────────────────────────────────────────────── */

export function sanitizeNodeLabel(value: string): string {
  // Trim, collapse spaces, cap at 40 chars
  return sanitizeText(value).slice(0, 40);
}

/* ── Task name ───────────────────────────────────────────────────────────── */

export function sanitizeTaskName(value: string): string {
  // Trim, collapse spaces, strip control chars, cap at 20 chars
  return sanitizeText(value)
    .replace(/[\x00-\x1F\x7F]/g, "")
    .slice(0, 20);
}

/* ── Prompt textarea ─────────────────────────────────────────────────────── */

const PROMPT_MAX_LENGTH = 10000;

export function sanitizePrompt(value: string): string {
  return sanitizeRichText(value).slice(0, PROMPT_MAX_LENGTH);
}

/* ── Number clamping ─────────────────────────────────────────────────────── */

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
