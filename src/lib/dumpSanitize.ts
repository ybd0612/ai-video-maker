// ────────────────────────────────────────────────────────────────────────────
// src/lib/dumpSanitize.ts
// Zero-dependency pure helpers for the dev debug-dump feature.
// Keeps secrets (providerConfig.apiKey) out of files written to disk.
// ────────────────────────────────────────────────────────────────────────────

/** Placeholder written in place of the API key in dump files. */
export const MASKED_API_KEY = "[masked]";

export interface DumpInput {
  project: unknown;
  settings: unknown;
}

/**
 * Build the dump payload with secrets masked.
 * Pure function — safe to unit-test in Node without browser globals.
 */
export function sanitizeForDump(input: DumpInput): Record<string, unknown> {
  const { project, settings } = input;

  let safeSettings = settings;
  if (
    settings !== null &&
    typeof settings === "object" &&
    "providerConfig" in settings
  ) {
    const providerConfig = (
      settings as { providerConfig?: unknown }
    ).providerConfig;
    if (providerConfig !== null && typeof providerConfig === "object") {
      safeSettings = {
        ...(settings as Record<string, unknown>),
        providerConfig: {
          ...(providerConfig as Record<string, unknown>),
          apiKey: MASKED_API_KEY,
        },
      };
    }
  }

  return {
    _dumpedAt: new Date().toISOString(),
    project,
    settings: safeSettings,
  };
}
