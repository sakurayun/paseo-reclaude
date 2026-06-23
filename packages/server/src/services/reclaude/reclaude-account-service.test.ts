import { describe, expect, it } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import type {
  ReclaudeCredentials,
  ReclaudeCredentialsStore,
} from "../../server/reclaude-credentials-store.js";
import type { ProviderUsage } from "../../server/messages.js";
import { ReclaudeAccountService, type ReclaudeUsageChange } from "./reclaude-account-service.js";
import type { ReclaudeClient } from "./reclaude-client.js";

class InMemoryCredentialsStore implements ReclaudeCredentialsStore {
  private credentials: ReclaudeCredentials | null = null;
  async initialize(): Promise<void> {}
  get(): ReclaudeCredentials | null {
    return this.credentials;
  }
  async set(input: { cookie: string; email: string }): Promise<void> {
    this.credentials = { ...input, savedAt: "1970-01-01T00:00:00.000Z" };
  }
  async clear(): Promise<void> {
    this.credentials = null;
  }
  async flush(): Promise<void> {}
}

const SYNCED_USAGE: ProviderUsage = {
  providerId: "claude",
  displayName: "Claude",
  status: "ok",
  planLabel: "Max",
  sourceLabel: "ReClaude",
  windows: [],
  balances: [],
  details: [],
  error: null,
};

function createFakeClient(overrides: Partial<ReclaudeClient> = {}): ReclaudeClient {
  return {
    login: async () => ({ step: "completed", cookie: "cookie-1" }),
    verifyMfa: async () => ({ cookie: "cookie-1" }),
    logout: async () => {},
    fetchUsage: async () => SYNCED_USAGE,
    ...overrides,
  } as unknown as ReclaudeClient;
}

function createService(client: ReclaudeClient): ReclaudeAccountService {
  return new ReclaudeAccountService({
    store: new InMemoryCredentialsStore(),
    isActive: () => true,
    logger: createTestLogger(),
    client,
  });
}

describe("ReclaudeAccountService change broadcast", () => {
  it("emits a logged-in change on login", async () => {
    const service = createService(createFakeClient());
    const changes: ReclaudeUsageChange[] = [];
    service.onChange((change) => changes.push(change));

    await service.login({ email: "a@b.com", password: "pw" });

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ active: true, loggedIn: true, email: "a@b.com" });
    // Signed in but not yet synced: usage is null so peers preserve their existing card
    // instead of clobbering it with an "unavailable" placeholder.
    expect(changes[0].usage).toBeNull();
  });

  it("emits the fresh usage on a forced sync", async () => {
    const service = createService(createFakeClient());
    const changes: ReclaudeUsageChange[] = [];
    await service.login({ email: "a@b.com", password: "pw" });
    service.onChange((change) => changes.push(change));

    await service.syncUsage({ providerId: "claude", displayName: "Claude" }, { force: true });

    expect(changes).toHaveLength(1);
    expect(changes[0].usage).toMatchObject({
      providerId: "claude",
      status: "ok",
      planLabel: "Max",
    });
  });

  it("emits a logged-out change on logout", async () => {
    const service = createService(createFakeClient());
    await service.login({ email: "a@b.com", password: "pw" });
    const changes: ReclaudeUsageChange[] = [];
    service.onChange((change) => changes.push(change));

    await service.logout();

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ loggedIn: false, email: null });
    // Signed out: send the unavailable placeholder so peers clear their usage card.
    expect(changes[0].usage).toMatchObject({ status: "unavailable", sourceLabel: "ReClaude" });
  });

  it("stops notifying after unsubscribe", async () => {
    const service = createService(createFakeClient());
    const changes: ReclaudeUsageChange[] = [];
    const unsubscribe = service.onChange((change) => changes.push(change));
    unsubscribe();

    await service.login({ email: "a@b.com", password: "pw" });

    expect(changes).toHaveLength(0);
  });
});
