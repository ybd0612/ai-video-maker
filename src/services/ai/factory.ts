// ────────────────────────────────────────────────────────────────────────────
// src/services/ai/factory.ts
// Factory for creating provider-specific AI service instances.
// ────────────────────────────────────────────────────────────────────────────

import type { AIService } from "./index";
import { OpenAIService } from "./openai";

interface ProviderConfig {
  provider: string;
  apiKey: string;
  baseUrl: string;
}

export function createAIService(config: ProviderConfig): AIService {
  switch (config.provider) {
    case "openai":
      return new OpenAIService({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
      });
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}
