import path from "node:path";

import { createSshForwardStore, type SshForwardStore } from "./ssh-forward-store.js";
import { createSshHostStore, type SshHostStore } from "./ssh-host-store.js";
import { createSshKeyStore, type SshKeyStore } from "./ssh-key-store.js";
import { createSshKnownHostStore, type SshKnownHostStore } from "./ssh-known-host-store.js";
import { createSshLogStore, type SshLogStore } from "./ssh-log-store.js";
import type { SshConnectHandler } from "./ssh-session-controller.js";

// Daemon-global bundle of the SSH manager's persistent stores, created once in
// bootstrap and shared by every client session (like portForwardManager). The
// connection/terminal layer (P2) and forward runtime (P5) attach to these.
export interface SshManager {
  hostStore: SshHostStore;
  keyStore: SshKeyStore;
  forwardStore: SshForwardStore;
  knownHostStore: SshKnownHostStore;
  logStore: SshLogStore;
  // Set by bootstrap once the connection/terminal layer is wired. Sessions
  // read it when constructing their SSH controller. Undefined = connect
  // unavailable (returns a not-implemented error).
  connectHandler?: SshConnectHandler;
  // Port-forward lifecycle, wired in bootstrap alongside connectHandler.
  forwardStart?: (id: string) => Promise<{ ok: boolean; error?: string }>;
  forwardStop?: (id: string) => Promise<{ ok: boolean }>;
  dispose(): void;
}

export interface SshManagerOptions {
  // Directory under PASEO_HOME where the SSH store files live.
  directory: string;
}

export function createSshManager(options: SshManagerOptions): SshManager {
  const { directory } = options;
  const hostStore = createSshHostStore({
    hostsPath: path.join(directory, "ssh-hosts.json"),
    secretsPath: path.join(directory, "ssh-secrets.json"),
  });
  const keyStore = createSshKeyStore({ storePath: path.join(directory, "ssh-keys.json") });
  const forwardStore = createSshForwardStore({
    storePath: path.join(directory, "ssh-forwards.json"),
  });
  const knownHostStore = createSshKnownHostStore({
    storePath: path.join(directory, "ssh-known-hosts.json"),
  });
  const logStore = createSshLogStore({ storePath: path.join(directory, "ssh-logs.json") });

  return {
    hostStore,
    keyStore,
    forwardStore,
    knownHostStore,
    logStore,
    dispose(): void {
      hostStore.dispose();
      keyStore.dispose();
      forwardStore.dispose();
      knownHostStore.dispose();
      logStore.dispose();
    },
  };
}
