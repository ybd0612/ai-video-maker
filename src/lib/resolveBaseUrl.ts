/**
 * Resolves the API base URL for fetch calls.
 * Simply cleans trailing slashes from the configured URL.
 */
export function resolveBaseUrl(configuredUrl: string): string {
  return configuredUrl.replace(/\/+$/, "");
}
