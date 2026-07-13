import { afterEach, describe, expect, it } from "vitest";
import type { ConnectConfig } from "ssh2";
import type { SshHostInfo } from "@getpaseo/protocol/messages";
import {
  applyCredentials,
  resolveLocalSshAgentEndpoint,
  SshAgentUnavailableError,
} from "./ssh-connect-config.js";
import type { SshHostStore } from "./ssh-host-store.js";
import type { SshKeyStore } from "./ssh-key-store.js";

function host(overrides: Partial<SshHostInfo> = {}): SshHostInfo {
  return { id: "h1", label: "Box", address: "10.0.0.1", ...overrides };
}

function emptyStores(): { hostStore: SshHostStore; keyStore: SshKeyStore } {
  return {
    hostStore: {
      getSecrets: () => ({}),
    } as unknown as SshHostStore,
    keyStore: {
      getMaterial: () => undefined,
    } as unknown as SshKeyStore,
  };
}

describe("resolveLocalSshAgentEndpoint", () => {
  it("reads SSH_AUTH_SOCK on unix", () => {
    expect(resolveLocalSshAgentEndpoint({ SSH_AUTH_SOCK: "/tmp/agent.sock" }, "darwin")).toBe(
      "/tmp/agent.sock",
    );
    expect(resolveLocalSshAgentEndpoint({}, "linux")).toBeNull();
  });

  it("uses the OpenSSH named pipe on windows", () => {
    expect(resolveLocalSshAgentEndpoint({}, "win32")).toBe("\\\\.\\pipe\\openssh-ssh-agent");
  });
});

describe("applyCredentials agent options", () => {
  const originalSock = process.env.SSH_AUTH_SOCK;

  afterEach(() => {
    if (originalSock === undefined) {
      delete process.env.SSH_AUTH_SOCK;
    } else {
      process.env.SSH_AUTH_SOCK = originalSock;
    }
  });

  it("uses the agent for auth when useAgent is set", () => {
    process.env.SSH_AUTH_SOCK = "/tmp/agent.sock";
    const config: ConnectConfig = { host: "10.0.0.1" };
    const stores = emptyStores();
    applyCredentials(config, host({ useAgent: true }), stores.hostStore, stores.keyStore);
    expect(config.agent).toBe("/tmp/agent.sock");
    expect(config.agentForward).toBeUndefined();
  });

  it("enables agent forwarding independently of useAgent", () => {
    process.env.SSH_AUTH_SOCK = "/tmp/agent.sock";
    const config: ConnectConfig = { host: "10.0.0.1" };
    const stores = emptyStores();
    applyCredentials(
      config,
      host({ useAgent: false, agentForwarding: true }),
      stores.hostStore,
      stores.keyStore,
    );
    expect(config.agent).toBe("/tmp/agent.sock");
    expect(config.agentForward).toBe(true);
  });

  it("throws when agent is required but SSH_AUTH_SOCK is missing", () => {
    delete process.env.SSH_AUTH_SOCK;
    if (process.platform === "win32") {
      // Windows always has a fixed pipe path — nothing to assert about missing sock.
      return;
    }
    const config: ConnectConfig = { host: "10.0.0.1" };
    const stores = emptyStores();
    expect(() =>
      applyCredentials(config, host({ useAgent: true }), stores.hostStore, stores.keyStore),
    ).toThrow(SshAgentUnavailableError);
  });
});
