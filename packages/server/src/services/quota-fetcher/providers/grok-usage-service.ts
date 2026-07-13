import type { Logger } from "pino";
import type { ProviderUsage } from "../../../server/messages.js";
import type { ProviderApiFetch, ProviderUsageFetcher } from "../provider.js";
import { unavailableUsage } from "../usage.js";
import { GrokQuotaProvider, resolveGrokAccessToken } from "./grok.js";

export interface GrokUsageServiceOptions {
  logger: Logger;
  fetch?: ProviderApiFetch;
  homeDir?: string;
  /** Override the live billing fetcher (tests). */
  liveFetcher?: GrokQuotaProvider;
  /** Override auth probe (tests). */
  resolveToken?: () => Promise<string | null>;
  now?: () => number;
}

export interface GrokStatus {
  authenticated: boolean;
}

// Emitted when the cached Grok usage snapshot changes (live sync). The daemon
// broadcasts this to every connected client so they patch the Grok card in place.
export interface GrokUsageChange {
  authenticated: boolean;
  usage: ProviderUsage | null;
}

const GROK_IDENTITY = {
  providerId: "grok",
  displayName: "Grok Build",
} as const;

// Automatic syncs (e.g. opening the context-window meter) are throttled to at
// most once per this window; an explicit "sync usage" button press bypasses it.
const GROK_SYNC_THROTTLE_MS = 5 * 60 * 1000;

/**
 * Grok Build usage is decoupled from the unified provider-usage list the same
 * way ReClaude is: the list path only ever reads `getCachedUsage()` (no network),
 * so the top "refresh" button never hits the Grok billing API. The cached
 * snapshot is updated ONLY by `syncUsage()`, driven by the dedicated button
 * (or a throttled auto-sync from the context meter).
 */
export class GrokUsageService {
  private readonly liveFetcher: GrokQuotaProvider;
  private readonly resolveToken: () => Promise<string | null>;
  private readonly logger: Logger;
  private readonly now: () => number;
  private cachedUsage: ProviderUsage | null = null;
  private lastSyncAtMs = 0;
  private readonly changeListeners = new Set<(change: GrokUsageChange) => void>();

  constructor(options: GrokUsageServiceOptions) {
    this.logger = options.logger.child({ module: "grok-usage-service" });
    this.liveFetcher =
      options.liveFetcher ??
      new GrokQuotaProvider({
        logger: this.logger,
        fetch: options.fetch,
        homeDir: options.homeDir,
      });
    this.resolveToken =
      options.resolveToken ?? (() => resolveGrokAccessToken({ homeDir: options.homeDir }));
    this.now = options.now ?? Date.now;
  }

  onChange(listener: (change: GrokUsageChange) => void): () => void {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }

  private emitChange(authenticated: boolean): void {
    if (this.changeListeners.size === 0) {
      return;
    }
    // Always send the current cache (or a placeholder when empty) so peers stay
    // in sync after a forced refresh, including error / unavailable states.
    const change: GrokUsageChange = {
      authenticated,
      usage: this.getCachedUsage(),
    };
    for (const listener of this.changeListeners) {
      try {
        listener(change);
      } catch (error) {
        this.logger.error({ err: error }, "grok change listener failed");
      }
    }
  }

  async status(): Promise<GrokStatus> {
    const token = await this.resolveToken();
    return { authenticated: Boolean(token) };
  }

  /**
   * Read-only: last synced snapshot or an "unavailable" placeholder.
   * NEVER hits the network — keeps provider.usage.list / refresh Grok-quiet.
   */
  getCachedUsage(): ProviderUsage {
    if (this.cachedUsage) {
      return {
        ...this.cachedUsage,
        providerId: GROK_IDENTITY.providerId,
        displayName: GROK_IDENTITY.displayName,
      };
    }
    return this.placeholder();
  }

  /**
   * Live fetch from the Grok billing API — the ONLY networked usage path.
   * Automatic triggers pass force=false and are throttled; the explicit
   * "sync usage" button passes force=true.
   */
  async syncUsage(options?: { force?: boolean }): Promise<ProviderUsage> {
    if (
      !options?.force &&
      this.cachedUsage &&
      this.now() - this.lastSyncAtMs < GROK_SYNC_THROTTLE_MS
    ) {
      return this.getCachedUsage();
    }

    const usage = await this.liveFetcher.fetchUsage();
    this.cachedUsage = {
      ...usage,
      fetchedAt: new Date(this.now()).toISOString(),
    };
    this.lastSyncAtMs = this.now();
    // Available / error implies we had credentials; probe token for the rest.
    const authenticated =
      usage.status === "available" ||
      usage.status === "error" ||
      Boolean(await this.resolveToken());
    this.emitChange(authenticated);
    return this.getCachedUsage();
  }

  /** ProviderUsageFetcher for the unified list — cache only, no network. */
  asCachedFetcher(): ProviderUsageFetcher {
    return {
      providerId: GROK_IDENTITY.providerId,
      displayName: GROK_IDENTITY.displayName,
      fetchUsage: async () => this.getCachedUsage(),
    };
  }

  private placeholder(): ProviderUsage {
    return unavailableUsage({
      ...GROK_IDENTITY,
      error: null,
    });
  }
}
