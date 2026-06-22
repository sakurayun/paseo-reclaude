import type { Logger } from "pino";
import type { ProviderUsage } from "../../server/messages.js";
import type { ReclaudeAccountService } from "../reclaude/reclaude-account-service.js";

export type ProviderApiFetch = typeof fetch;

export interface ProviderUsageFetcher {
  readonly providerId: string;
  readonly displayName: string;
  fetchUsage(): Promise<ProviderUsage>;
}

export interface ProviderUsageFetcherFactoryOptions {
  logger: Logger;
  fetch?: ProviderApiFetch;
  // When present, the Claude provider sources its usage from reclaude.ai instead
  // of the direct Anthropic OAuth endpoint while reclaude is the active binary.
  reclaude?: ReclaudeAccountService;
}

export interface ProviderUsageFetcherManifestEntry {
  readonly providerId: string;
  create(options: ProviderUsageFetcherFactoryOptions): ProviderUsageFetcher;
}
