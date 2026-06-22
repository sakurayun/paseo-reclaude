import type { Logger } from "pino";

import type { ProviderUsage } from "../../server/messages.js";
import type { ReclaudeCredentialsStore } from "../../server/reclaude-credentials-store.js";
import { unavailableUsage } from "../quota-fetcher/usage.js";
import { ReclaudeClient, type ReclaudeUsageIdentity } from "./reclaude-client.js";

export interface ReclaudeAccountServiceOptions {
  store: ReclaudeCredentialsStore;
  // Whether the Claude provider is currently configured to launch via the
  // reclaude binary (i.e. `providers.claude.command[0] === "reclaude"`).
  isActive: () => boolean;
  logger: Logger;
  client?: ReclaudeClient;
}

export interface ReclaudeStatus {
  active: boolean;
  loggedIn: boolean;
  email: string | null;
}

export type ReclaudeLoginStep =
  | { step: "completed" }
  | { step: "mfa_required"; mfaChallengeToken: string };

// Bundles the reclaude HTTP client + the persisted session cookie + the
// "is reclaude active" check behind one object, shared by both the usage quota
// provider and the provider.reclaude.* RPC handlers.
//
// Usage is decoupled from the unified provider-usage list: the quota provider
// only ever reads `getCachedUsage()` (no network), so the top "refresh" button
// and any auto-refresh never hit reclaude.ai. The cached snapshot is updated
// ONLY by `syncUsage()`, driven by the dedicated "sync usage" button.
// Automatic syncs (e.g. opening the context-window meter) are throttled to at
// most once per this window; an explicit "sync usage" button press bypasses it.
const RECLAUDE_SYNC_THROTTLE_MS = 5 * 60 * 1000;

export class ReclaudeAccountService {
  private readonly store: ReclaudeCredentialsStore;
  private readonly client: ReclaudeClient;
  private readonly isActiveFn: () => boolean;
  private readonly logger: Logger;
  // The MFA verify step needs the email that started the login so it can be
  // persisted alongside the cookie. Keep it in memory keyed by challenge token.
  private readonly pendingEmailByChallenge = new Map<string, string>();
  // Last live-synced usage snapshot. In-memory only; a daemon restart clears it
  // and the card prompts the user to sync again.
  private cachedUsage: ProviderUsage | null = null;
  private lastSyncAtMs = 0;

  constructor(options: ReclaudeAccountServiceOptions) {
    this.store = options.store;
    this.client = options.client ?? new ReclaudeClient();
    this.isActiveFn = options.isActive;
    this.logger = options.logger.child({ module: "reclaude-account-service" });
  }

  isActive(): boolean {
    return this.isActiveFn();
  }

  status(): ReclaudeStatus {
    const creds = this.store.get();
    return {
      active: this.isActive(),
      loggedIn: Boolean(creds?.cookie),
      email: creds?.email ?? null,
    };
  }

  async login(params: { email: string; password: string }): Promise<ReclaudeLoginStep> {
    const outcome = await this.client.login(params);
    if (outcome.step === "completed") {
      await this.store.set({ cookie: outcome.cookie, email: params.email });
      return { step: "completed" };
    }
    this.pendingEmailByChallenge.set(outcome.mfaChallengeToken, params.email);
    return { step: "mfa_required", mfaChallengeToken: outcome.mfaChallengeToken };
  }

  async verifyMfa(params: { challengeToken: string; code: string }): Promise<void> {
    const { cookie } = await this.client.verifyMfa(params);
    const email =
      this.pendingEmailByChallenge.get(params.challengeToken) ?? this.store.get()?.email ?? "";
    await this.store.set({ cookie, email });
    this.pendingEmailByChallenge.delete(params.challengeToken);
  }

  async logout(): Promise<void> {
    const creds = this.store.get();
    if (creds?.cookie) {
      await this.client.logout(creds.cookie);
    }
    await this.store.clear();
    this.cachedUsage = null;
    this.lastSyncAtMs = 0;
  }

  // Read-only: returns the last synced snapshot (re-tagged with the caller's
  // provider identity) or an "unavailable" placeholder. NEVER hits the network,
  // so the unified usage list and its refresh button stay reclaude-quiet.
  getCachedUsage(identity: ReclaudeUsageIdentity): ProviderUsage {
    if (!this.store.get()?.cookie) {
      return this.placeholder(identity);
    }
    if (this.cachedUsage) {
      return {
        ...this.cachedUsage,
        providerId: identity.providerId,
        displayName: identity.displayName,
      };
    }
    return this.placeholder(identity);
  }

  // Live fetch from reclaude.ai — the ONLY networked usage path. Updates the
  // cached snapshot and returns it. On an expired/rejected cookie, clears the
  // session so the UI falls back to "sign in".
  //
  // Automatic triggers (e.g. opening the context-window meter) pass force=false
  // and are throttled to once per RECLAUDE_SYNC_THROTTLE_MS — within that window
  // they return the cached snapshot without hitting the network. The explicit
  // "sync usage" button passes force=true to always pull fresh data.
  async syncUsage(
    identity: ReclaudeUsageIdentity,
    options?: { force?: boolean },
  ): Promise<ProviderUsage> {
    const cookie = this.store.get()?.cookie;
    if (!cookie) {
      this.cachedUsage = null;
      this.lastSyncAtMs = 0;
      return this.placeholder(identity);
    }
    if (
      !options?.force &&
      this.cachedUsage &&
      Date.now() - this.lastSyncAtMs < RECLAUDE_SYNC_THROTTLE_MS
    ) {
      return this.getCachedUsage(identity);
    }
    const result = await this.client.fetchUsage(cookie, identity);
    if (result === "NEEDS_AUTH") {
      this.logger.info("ReClaude session cookie rejected; clearing stored credentials");
      await this.store.clear();
      this.cachedUsage = null;
      this.lastSyncAtMs = 0;
      return this.placeholder(identity);
    }
    this.cachedUsage = result;
    this.lastSyncAtMs = Date.now();
    return result;
  }

  private placeholder(identity: ReclaudeUsageIdentity): ProviderUsage {
    return { ...unavailableUsage(identity), sourceLabel: "ReClaude" };
  }
}
