import { randomUUID } from "node:crypto";
import type pino from "pino";
import { createHash } from "node:crypto";
import { getErrorMessage } from "@getpaseo/protocol/error-utils";
import { compactProviderSnapshot } from "@getpaseo/protocol/provider-snapshot-codec";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import { consumeCodexRateLimitResetCredit } from "../../agent/providers/codex/account-rpc.js";
import {
  isGlobalProviderSnapshotKey,
  resolveSnapshotCwd,
  sameSnapshotRecords,
  type ProviderSnapshotManager,
  type ProviderSnapshot,
  type ProviderSnapshotTransition,
} from "../../agent/provider-snapshot-manager.js";
import {
  filterSelectableAgentModels,
  type AgentFeature,
  type AgentProvider,
  type AgentSessionConfig,
  type ProviderSnapshotEntry,
} from "../../agent/agent-sdk-types.js";
import type { ProviderAvailability } from "../../agent/agent-manager.js";
import type { ProviderUsageService } from "../../../services/quota-fetcher/service.js";
import type { GrokUsageService } from "../../../services/quota-fetcher/providers/grok-usage-service.js";
import type { ReclaudeAccountService } from "../../../services/reclaude/reclaude-account-service.js";
import { expandTilde } from "../../../utils/path.js";

// COMPAT(customModeIcons): the only mode icons known to clients before v0.1.84. Any
// other icon name is downgraded to "ShieldCheck" for those clients.
const LEGACY_MODE_ICONS = new Set<string>([
  "ShieldCheck",
  "ShieldAlert",
  "ShieldOff",
  "ShieldQuestionMark",
]);

/**
 * The collaborators a provider-catalog request reaches that are NOT part of the
 * provider domain. Two are CLIENT-COMPAT predicates the Session shell owns because
 * agent-lifecycle shares the visibility gate: both read client state (appVersion /
 * capabilities) LIVE, mutated post-construction via updateAppVersion /
 * updateClientCapabilities. The two agent-control reads expose provider availability
 * and draft features the AgentManager owns.
 */
export interface ProviderCatalogSessionHost {
  emit(msg: SessionOutboundMessage): void;
  // COMPAT(providersSnapshot): visibility gating for older clients lives on the shell
  // (agent-lifecycle shares it). Reads appVersion live.
  isProviderVisibleToClient(provider: string): boolean;
  // COMPAT(customModeIcons): reads clientCapabilities live.
  supportsCustomModeIcons(): boolean;
  supportsCompactProviderSnapshots(): boolean;
  supportsProviderSnapshotReferences(): boolean;
  publishSnapshot(project: () => SessionOutboundMessage | null): void;
  listProviderAvailability(): Promise<ProviderAvailability[]>;
  listDraftFeatures(config: AgentSessionConfig): Promise<AgentFeature[]>;
}

export interface ProviderCatalogSessionOptions {
  host: ProviderCatalogSessionHost;
  providerSnapshotManager: ProviderSnapshotManager;
  providerUsageService: ProviderUsageService;
  reclaude: ReclaudeAccountService;
  grokUsage: GrokUsageService;
  logger: pino.Logger;
}

/**
 * A client's provider catalog surface: model / mode / feature listing, the providers
 * snapshot push + pull, and provider diagnostics. The snapshot PUSH (start) and
 * every PULL handler gate visibility and downgrade mode icons through the SAME predicates,
 * so an older client sees one consistent provider set across both paths — the COMPAT
 * invariant the shell could only enforce by code proximity before this carve.
 */
export class ProviderCatalogSession {
  private readonly host: ProviderCatalogSessionHost;
  private readonly providerSnapshotManager: ProviderSnapshotManager;
  private readonly providerUsageService: ProviderUsageService;
  private readonly reclaude: ReclaudeAccountService;
  private readonly grokUsage: GrokUsageService;
  private readonly logger: pino.Logger;
  private unsubscribeSnapshotEvents: (() => void) | null = null;

  constructor(options: ProviderCatalogSessionOptions) {
    this.host = options.host;
    this.providerSnapshotManager = options.providerSnapshotManager;
    this.providerUsageService = options.providerUsageService;
    this.reclaude = options.reclaude;
    this.grokUsage = options.grokUsage;
    this.logger = options.logger;
  }

  get isObserving(): boolean {
    return this.unsubscribeSnapshotEvents !== null;
  }

  start(): void {
    if (this.unsubscribeSnapshotEvents) return;
    const handleProviderSnapshotChange = (transition: ProviderSnapshotTransition) => {
      this.host.publishSnapshot(() => {
        const previous = this.visibleSnapshot(transition.previous);
        const current = this.visibleSnapshot(transition.current);
        if (sameSnapshotRecords(previous.records, current.records)) return null;
        return { type: "providers_snapshot_update", payload: this.snapshotPayload(current) };
      });
    };
    this.providerSnapshotManager.on("change", handleProviderSnapshotChange);
    this.unsubscribeSnapshotEvents = () => {
      this.providerSnapshotManager.off("change", handleProviderSnapshotChange);
    };
  }

  dispose(): void {
    if (this.unsubscribeSnapshotEvents) {
      this.unsubscribeSnapshotEvents();
      this.unsubscribeSnapshotEvents = null;
    }
  }

  // COMPAT(customModeIcons): rewrite icons unknown to v0.1.83 clients (whose MODE_ICONS
  // map is a closed enum and would render `undefined`, crashing in render). Drop
  // this and the cap gate when floor >= v0.1.84.
  private downgradeModeIconsForClient<T extends { icon?: string }>(
    modes: T[],
    customModeIcons = this.host.supportsCustomModeIcons(),
  ): T[] {
    if (customModeIcons) return modes;
    return modes.map((mode) =>
      mode.icon && !LEGACY_MODE_ICONS.has(mode.icon) ? { ...mode, icon: "ShieldCheck" } : mode,
    );
  }

  private visibleSnapshot(snapshot: ProviderSnapshot): ProviderSnapshot {
    // COMPAT(providersSnapshot): use the shell's current visibility policy for both sides.
    return {
      ...snapshot,
      records: snapshot.records.filter(({ entry }) =>
        this.host.isProviderVisibleToClient(entry.provider),
      ),
    };
  }

  private snapshotPayload(snapshot: ProviderSnapshot, request?: { ifNoneMatch?: string }) {
    const { records } = snapshot;
    const customModeIcons = this.host.supportsCustomModeIcons();
    const compact = this.host.supportsCompactProviderSnapshots();
    const references = this.host.supportsProviderSnapshotReferences();
    const envelope = {
      ...(!isGlobalProviderSnapshotKey(snapshot.cwd) ? { cwd: snapshot.cwd } : {}),
      generatedAt: new Date().toISOString(),
    };
    const clientEntries = () =>
      records.map(({ entry }) =>
        entry.modes && !customModeIcons
          ? { ...entry, modes: this.downgradeModeIconsForClient(entry.modes, customModeIcons) }
          : entry,
      );
    if (!compact) {
      return { ...envelope, entries: clientEntries() };
    }

    // COMPAT(providerSnapshotReferences): added in v0.7.2, remove legacy full
    // pushes and embedded freshness after 2027-03-06 once the client floor supports references.
    const snapshotHash = createHash("sha256")
      .update(
        JSON.stringify([
          "paseo.providers-snapshot/1",
          references ? "references" : "embedded",
          customModeIcons ? "icons" : "legacy-icons",
          records.map(({ entry, contentHash }) => [
            entry.provider,
            contentHash,
            references ? null : (entry.fetchedAt ?? null),
          ]),
        ]),
      )
      .digest("base64url");
    const fetchedAt = references
      ? Object.fromEntries(
          records.flatMap(({ entry }) =>
            entry.fetchedAt ? [[entry.provider, entry.fetchedAt]] : [],
          ),
        )
      : undefined;
    const identified = { ...envelope, entries: [], snapshotHash, fetchedAt };
    if (request && request.ifNoneMatch === snapshotHash) {
      return { ...identified, notModified: true as const };
    }
    if (!request && references) return identified;

    const entries = clientEntries();
    const content = references
      ? entries.map(({ fetchedAt: _fetchedAt, ...entry }) => entry)
      : entries;
    return { ...identified, compactSnapshot: compactProviderSnapshot(content) };
  }

  private emitProviderDisabledResponse(
    kind: "models" | "modes",
    provider: AgentProvider,
    requestId: string,
    fetchedAt: string,
  ): void {
    const payload = {
      provider,
      error: `Provider ${provider} is disabled`,
      fetchedAt,
      requestId,
    };
    if (kind === "models") {
      this.host.emit({ type: "list_provider_models_response", payload });
    } else {
      this.host.emit({ type: "list_provider_modes_response", payload });
    }
  }

  async handleListProviderModelsRequest(
    msg: Extract<SessionInboundMessage, { type: "list_provider_models_request" }>,
  ): Promise<void> {
    const cwd = resolveCatalogRequestCwd(msg.cwd);
    const fetchedAt = new Date().toISOString();

    const entry = await this.getProviderSnapshotEntryForRead(cwd, msg.provider);

    if (!entry) {
      this.host.emit({
        type: "list_provider_models_response",
        payload: {
          provider: msg.provider,
          error: `Unknown provider: ${msg.provider}`,
          fetchedAt,
          requestId: msg.requestId,
        },
      });
      return;
    }

    if (!entry.enabled) {
      this.emitProviderDisabledResponse("models", msg.provider, msg.requestId, fetchedAt);
      return;
    }

    if (entry.status === "ready") {
      this.host.emit({
        type: "list_provider_models_response",
        payload: {
          provider: msg.provider,
          models: filterSelectableAgentModels(entry.models),
          error: null,
          fetchedAt: entry.fetchedAt ?? fetchedAt,
          requestId: msg.requestId,
        },
      });
      return;
    }

    const errorMessage =
      entry.status === "error"
        ? (entry.error ?? `Failed to list models for ${msg.provider}`)
        : `Provider ${msg.provider} is not available`;

    this.host.emit({
      type: "list_provider_models_response",
      payload: {
        provider: msg.provider,
        error: errorMessage,
        fetchedAt,
        requestId: msg.requestId,
      },
    });
  }

  async handleListProviderModesRequest(
    msg: Extract<SessionInboundMessage, { type: "list_provider_modes_request" }>,
  ): Promise<void> {
    const fetchedAt = new Date().toISOString();
    const cwd = resolveCatalogRequestCwd(msg.cwd);
    const entry = await this.getProviderSnapshotEntryForRead(cwd, msg.provider);

    if (!entry) {
      this.host.emit({
        type: "list_provider_modes_response",
        payload: {
          provider: msg.provider,
          error: `Unknown provider: ${msg.provider}`,
          fetchedAt,
          requestId: msg.requestId,
        },
      });
      return;
    }

    if (!entry.enabled) {
      this.emitProviderDisabledResponse("modes", msg.provider, msg.requestId, fetchedAt);
      return;
    }

    if (entry.status === "ready") {
      this.host.emit({
        type: "list_provider_modes_response",
        payload: {
          provider: msg.provider,
          modes: this.downgradeModeIconsForClient(entry.modes ?? []),
          error: null,
          fetchedAt: entry.fetchedAt ?? fetchedAt,
          requestId: msg.requestId,
        },
      });
      return;
    }

    const errorMessage =
      entry.status === "error"
        ? (entry.error ?? `Failed to list modes for ${msg.provider}`)
        : `Provider ${msg.provider} is not available`;

    this.host.emit({
      type: "list_provider_modes_response",
      payload: {
        provider: msg.provider,
        error: errorMessage,
        fetchedAt,
        requestId: msg.requestId,
      },
    });
  }

  private async getProviderSnapshotEntryForRead(
    cwd: string | undefined,
    provider: AgentProvider,
  ): Promise<ProviderSnapshotEntry | undefined> {
    const manager = this.providerSnapshotManager;
    const findEntry = () =>
      manager.getSnapshot(cwd).records.find(({ entry }) => entry.provider === provider)?.entry;

    let entry = findEntry();
    if (entry && !entry.enabled) {
      return entry;
    }
    if (!entry || entry.status === "loading") {
      // Awaits the in-flight warmup (deduped per-cwd) so old clients still get
      // a resolved answer rather than a loading placeholder.
      await manager.warmUpSnapshotForCwd({ cwd, providers: [provider] });
      entry = findEntry();
    }
    return entry;
  }

  private buildDraftAgentSessionConfig(draftConfig: {
    provider: AgentProvider;
    cwd: string;
    modeId?: string;
    model?: string;
    thinkingOptionId?: string;
    featureValues?: Record<string, unknown>;
  }): AgentSessionConfig {
    return {
      provider: draftConfig.provider,
      cwd: expandTilde(draftConfig.cwd),
      ...(draftConfig.modeId ? { modeId: draftConfig.modeId } : {}),
      ...(draftConfig.model ? { model: draftConfig.model } : {}),
      ...(draftConfig.thinkingOptionId ? { thinkingOptionId: draftConfig.thinkingOptionId } : {}),
      ...(draftConfig.featureValues ? { featureValues: draftConfig.featureValues } : {}),
    };
  }

  async handleListProviderFeaturesRequest(
    msg: Extract<SessionInboundMessage, { type: "list_provider_features_request" }>,
  ): Promise<void> {
    const fetchedAt = new Date().toISOString();
    try {
      const sessionConfig = this.buildDraftAgentSessionConfig(msg.draftConfig);
      const features = await this.host.listDraftFeatures(sessionConfig);
      this.host.emit({
        type: "list_provider_features_response",
        payload: {
          provider: msg.draftConfig.provider,
          features,
          error: null,
          fetchedAt,
          requestId: msg.requestId,
        },
      });
    } catch (error) {
      this.logger.error(
        { err: error, provider: msg.draftConfig.provider, draftConfig: msg.draftConfig },
        `Failed to list features for ${msg.draftConfig.provider}`,
      );
      this.host.emit({
        type: "list_provider_features_response",
        payload: {
          provider: msg.draftConfig.provider,
          error: getErrorMessage(error),
          fetchedAt,
          requestId: msg.requestId,
        },
      });
    }
  }

  async handleListAvailableProvidersRequest(
    msg: Extract<SessionInboundMessage, { type: "list_available_providers_request" }>,
  ): Promise<void> {
    const fetchedAt = new Date().toISOString();
    try {
      const providers = (await this.host.listProviderAvailability()).filter((provider) =>
        this.host.isProviderVisibleToClient(provider.provider),
      );
      this.host.emit({
        type: "list_available_providers_response",
        payload: {
          providers,
          error: null,
          fetchedAt,
          requestId: msg.requestId,
        },
      });
    } catch (error) {
      this.logger.error({ err: error }, "Failed to list provider availability");
      this.host.emit({
        type: "list_available_providers_response",
        payload: {
          providers: [],
          error: getErrorMessage(error),
          fetchedAt,
          requestId: msg.requestId,
        },
      });
    }
  }

  async handleGetProvidersSnapshotRequest(
    msg: Extract<SessionInboundMessage, { type: "get_providers_snapshot_request" }>,
  ): Promise<void> {
    const cwd = msg.cwd?.trim() ? resolveSnapshotCwd(expandTilde(msg.cwd)) : undefined;
    const snapshot = this.visibleSnapshot(this.providerSnapshotManager.getSnapshot(cwd));
    this.host.emit({
      type: "get_providers_snapshot_response",
      payload: {
        ...this.snapshotPayload(snapshot, { ifNoneMatch: msg.ifNoneMatch }),
        requestId: msg.requestId,
      },
    });
  }

  async handleRefreshProvidersSnapshotRequest(
    msg: Extract<SessionInboundMessage, { type: "refresh_providers_snapshot_request" }>,
  ): Promise<void> {
    if (msg.cwd) {
      await this.providerSnapshotManager.refreshSnapshotForCwd({
        cwd: expandTilde(msg.cwd),
        providers: msg.providers,
      });
    } else {
      await this.providerSnapshotManager.refreshSettingsSnapshot({
        providers: msg.providers,
      });
    }
    this.host.emit({
      type: "refresh_providers_snapshot_response",
      payload: {
        acknowledged: true,
        requestId: msg.requestId,
      },
    });
  }

  async handleProviderDiagnosticRequest(
    msg: Extract<SessionInboundMessage, { type: "provider_diagnostic_request" }>,
  ): Promise<void> {
    try {
      const { diagnostic } = await this.providerSnapshotManager.getProviderDiagnostic(msg.provider);
      this.host.emit({
        type: "provider_diagnostic_response",
        payload: {
          provider: msg.provider,
          diagnostic,
          requestId: msg.requestId,
        },
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        { err, provider: msg.provider },
        `Failed to get provider diagnostic for ${msg.provider}`,
      );
      this.host.emit({
        type: "rpc_error",
        payload: {
          requestId: msg.requestId,
          requestType: msg.type,
          error: `Failed to get provider diagnostic: ${err.message}`,
          code: "provider_diagnostic_failed",
        },
      });
    }
  }

  async handleProviderUsageListRequest(
    msg: Extract<SessionInboundMessage, { type: "provider.usage.list.request" }>,
  ): Promise<void> {
    try {
      const usage = await this.providerUsageService.listUsage();
      this.host.emit({
        type: "provider.usage.list.response",
        payload: {
          requestId: msg.requestId,
          fetchedAt: usage.fetchedAt,
          providers: usage.providers,
        },
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error({ err }, "Failed to list provider usage");
      this.host.emit({
        type: "rpc_error",
        payload: {
          requestId: msg.requestId,
          requestType: msg.type,
          error: `Failed to list provider usage: ${err.message}`,
          code: "provider_usage_list_failed",
        },
      });
    }
  }

  // COMPAT(codexRateLimitReset): added in v0.1.116, remove gate after 2026-12-26.
  // Consume one earned Codex rate-limit reset credit via a short-lived
  // `codex app-server`. Irreversible (spends a limited earned credit), so the
  // client always confirms before sending. A successful "reset" drops the usage
  // cache so the next provider.usage.list re-fetches the new windows.
  async handleCodexConsumeResetCreditRequest(
    msg: Extract<SessionInboundMessage, { type: "provider.codex.consume_reset_credit.request" }>,
  ): Promise<void> {
    try {
      const outcome = await consumeCodexRateLimitResetCredit({
        logger: this.logger,
        idempotencyKey: randomUUID(),
      });
      if (outcome === "reset") {
        this.providerUsageService.invalidateCache();
      }
      this.host.emit({
        type: "provider.codex.consume_reset_credit.response",
        payload: { requestId: msg.requestId, outcome, error: null },
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error({ err }, "Failed to consume Codex rate-limit reset credit");
      this.host.emit({
        type: "provider.codex.consume_reset_credit.response",
        payload: { requestId: msg.requestId, outcome: "unavailable", error: err.message },
      });
    }
  }

  async handleReclaudeStatusRequest(
    msg: Extract<SessionInboundMessage, { type: "provider.reclaude.status.request" }>,
  ): Promise<void> {
    const status = this.reclaude.status();
    this.host.emit({
      type: "provider.reclaude.status.response",
      payload: {
        requestId: msg.requestId,
        active: status.active,
        loggedIn: status.loggedIn,
        email: status.email,
      },
    });
  }

  async handleReclaudeLoginRequest(
    msg: Extract<SessionInboundMessage, { type: "provider.reclaude.login.request" }>,
  ): Promise<void> {
    try {
      const result = await this.reclaude.login({ email: msg.email, password: msg.password });
      // Signing in only stores the session cookie. We deliberately do NOT touch
      // the provider-usage cache here so other providers (e.g. Codex) are not
      // re-fetched; reclaude usage is pulled separately via the sync RPC.
      this.host.emit({
        type: "provider.reclaude.login.response",
        payload: {
          requestId: msg.requestId,
          step: result.step,
          mfaChallengeToken: result.step === "mfa_required" ? result.mfaChallengeToken : null,
        },
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error({ err }, "ReClaude sign-in failed");
      this.host.emit({
        type: "rpc_error",
        payload: {
          requestId: msg.requestId,
          requestType: msg.type,
          error: err.message,
          code: "provider_reclaude_login_failed",
        },
      });
    }
  }

  async handleReclaudeVerifyMfaRequest(
    msg: Extract<SessionInboundMessage, { type: "provider.reclaude.mfa.request" }>,
  ): Promise<void> {
    try {
      await this.reclaude.verifyMfa({ challengeToken: msg.challengeToken, code: msg.code });
      this.host.emit({
        type: "provider.reclaude.mfa.response",
        payload: { requestId: msg.requestId, step: "completed" },
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error({ err }, "ReClaude MFA verification failed");
      this.host.emit({
        type: "rpc_error",
        payload: {
          requestId: msg.requestId,
          requestType: msg.type,
          error: err.message,
          code: "provider_reclaude_mfa_failed",
        },
      });
    }
  }

  async handleReclaudeLogoutRequest(
    msg: Extract<SessionInboundMessage, { type: "provider.reclaude.logout.request" }>,
  ): Promise<void> {
    try {
      await this.reclaude.logout();
      this.host.emit({
        type: "provider.reclaude.logout.response",
        payload: { requestId: msg.requestId, ok: true },
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error({ err }, "ReClaude sign-out failed");
      this.host.emit({
        type: "rpc_error",
        payload: {
          requestId: msg.requestId,
          requestType: msg.type,
          error: err.message,
          code: "provider_reclaude_logout_failed",
        },
      });
    }
  }

  async handleReclaudeSyncUsageRequest(
    msg: Extract<SessionInboundMessage, { type: "provider.reclaude.sync.request" }>,
  ): Promise<void> {
    try {
      // The only path that live-fetches usage from reclaude.ai. Driven by the
      // dedicated "sync usage" button (force) or the context-window meter
      // (throttled), never by the list refresh.
      const usage = await this.reclaude.syncUsage(
        { providerId: "claude", displayName: "Claude" },
        { force: msg.force === true },
      );
      this.host.emit({
        type: "provider.reclaude.sync.response",
        payload: { requestId: msg.requestId, usage },
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error({ err }, "ReClaude usage sync failed");
      this.host.emit({
        type: "rpc_error",
        payload: {
          requestId: msg.requestId,
          requestType: msg.type,
          error: err.message,
          code: "provider_reclaude_sync_failed",
        },
      });
    }
  }

  async handleGrokStatusRequest(
    msg: Extract<SessionInboundMessage, { type: "provider.grok.status.request" }>,
  ): Promise<void> {
    const status = await this.grokUsage.status();
    this.host.emit({
      type: "provider.grok.status.response",
      payload: {
        requestId: msg.requestId,
        authenticated: status.authenticated,
      },
    });
  }

  async handleGrokSyncUsageRequest(
    msg: Extract<SessionInboundMessage, { type: "provider.grok.sync.request" }>,
  ): Promise<void> {
    try {
      // The only path that live-fetches Grok billing. Driven by the dedicated
      // "sync usage" button (force) or the context-window meter (throttled).
      const usage = await this.grokUsage.syncUsage({ force: msg.force === true });
      this.host.emit({
        type: "provider.grok.sync.response",
        payload: { requestId: msg.requestId, usage },
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error({ err }, "Grok usage sync failed");
      this.host.emit({
        type: "rpc_error",
        payload: {
          requestId: msg.requestId,
          requestType: msg.type,
          error: err.message,
          code: "provider_grok_sync_failed",
        },
      });
    }
  }
}

function resolveCatalogRequestCwd(cwd?: string | null): string | undefined {
  const trimmed = cwd?.trim();
  return trimmed ? expandTilde(trimmed) : undefined;
}
