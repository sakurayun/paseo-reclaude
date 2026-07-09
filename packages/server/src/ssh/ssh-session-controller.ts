import { getErrorMessage } from "@getpaseo/protocol/error-utils";
import type { SessionInboundMessage, SessionOutboundMessage } from "@getpaseo/protocol/messages";

import type { SshForwardStore } from "./ssh-forward-store.js";
import type { SshHostStore } from "./ssh-host-store.js";
import type { SshKeyStore } from "./ssh-key-store.js";
import type { SshKnownHostStore } from "./ssh-known-host-store.js";
import type { SshLogStore } from "./ssh-log-store.js";

type SshInbound = Extract<SessionInboundMessage, { type: `ssh.${string}` }>;
type SshInboundOf<TType extends SshInbound["type"]> = Extract<SshInbound, { type: TType }>;

// Result of a connect attempt, produced by the connection layer (P2). Kept as a
// structured object so the controller can shape the wire response uniformly.
export type SshConnectResult =
  | {
      outcome: "connected";
      terminal: { id: string; name: string; cwd: string; workspaceId?: string };
    }
  | { outcome: "error"; error: string }
  | {
      outcome: "host_key_mismatch";
      error: string;
      observedKey: {
        host: string;
        port?: number;
        keyType: string;
        fingerprintSha256: string;
        publicKeyBase64: string;
      };
    };

export type SshConnectHandler = (input: {
  hostId: string;
  cols?: number;
  rows?: number;
  // Workspace placement for the terminal record (see SshHostsConnectRequestSchema).
  workspaceId?: string;
  cwd?: string;
}) => Promise<SshConnectResult>;

export interface SshSessionControllerDeps {
  hostStore: SshHostStore;
  keyStore: SshKeyStore;
  forwardStore: SshForwardStore;
  knownHostStore: SshKnownHostStore;
  logStore: SshLogStore;
  emit: (msg: SessionOutboundMessage) => void;
  // Injected by P2; when absent, connect returns a not-implemented error.
  connectHandler?: SshConnectHandler;
  // Injected by P5; when absent, start/stop report unavailable.
  forwardStart?: (id: string) => Promise<{ ok: boolean; error?: string }>;
  forwardStop?: (id: string) => Promise<{ ok: boolean }>;
}

export interface SshSessionController {
  dispatch(msg: SessionInboundMessage): Promise<void> | undefined;
}

// Strips undefined values so optional wire fields can be forwarded to store
// inputs without a conditional spread per field (exactOptionalPropertyTypes).
function definedProps<T extends Record<string, unknown>>(
  obj: T,
): { [K in keyof T]?: Exclude<T[K], undefined> } {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out as { [K in keyof T]?: Exclude<T[K], undefined> };
}

export function createSshSessionController(deps: SshSessionControllerDeps): SshSessionController {
  const { hostStore, keyStore, forwardStore, knownHostStore, logStore, emit } = deps;

  function handleHostsMessage(msg: SshInbound): Promise<void> | undefined {
    switch (msg.type) {
      case "ssh.hosts.list.request": {
        const { hosts, groups } = hostStore.list();
        emit({
          type: "ssh.hosts.list.response",
          payload: { hosts, groups, requestId: msg.requestId },
        });
        return undefined;
      }
      case "ssh.hosts.create.request": {
        try {
          const host = hostStore.createHost({
            host: msg.host,
            ...definedProps({ password: msg.password, proxyPassword: msg.proxyPassword }),
          });
          emit({
            type: "ssh.hosts.create.response",
            payload: { host, error: null, requestId: msg.requestId },
          });
        } catch (error) {
          emit({
            type: "ssh.hosts.create.response",
            payload: { host: null, error: getErrorMessage(error), requestId: msg.requestId },
          });
        }
        return undefined;
      }
      case "ssh.hosts.update.request": {
        try {
          const host = hostStore.updateHost({
            id: msg.id,
            host: msg.host,
            ...(msg.password !== undefined ? { password: msg.password } : {}),
            ...(msg.proxyPassword !== undefined ? { proxyPassword: msg.proxyPassword } : {}),
          });
          emit({
            type: "ssh.hosts.update.response",
            payload: {
              host: host ?? null,
              error: host ? null : "Host not found",
              requestId: msg.requestId,
            },
          });
        } catch (error) {
          emit({
            type: "ssh.hosts.update.response",
            payload: { host: null, error: getErrorMessage(error), requestId: msg.requestId },
          });
        }
        return undefined;
      }
      case "ssh.hosts.delete.request": {
        const success = hostStore.deleteHost(msg.id);
        emit({
          type: "ssh.hosts.delete.response",
          payload: {
            id: msg.id,
            success,
            error: success ? null : "Host not found",
            requestId: msg.requestId,
          },
        });
        return undefined;
      }
      case "ssh.hosts.connect.request":
        return handleConnect(msg);
      default:
        return undefined;
    }
  }

  function handleGroupsMessage(msg: SshInbound): Promise<void> | undefined {
    switch (msg.type) {
      case "ssh.host_groups.create.request": {
        const group = hostStore.createGroup({
          name: msg.name,
          ...definedProps({ parentId: msg.parentId }),
        });
        emit({
          type: "ssh.host_groups.create.response",
          payload: { group, error: null, requestId: msg.requestId },
        });
        return undefined;
      }
      case "ssh.host_groups.rename.request": {
        const group = hostStore.renameGroup(msg.id, msg.name);
        emit({
          type: "ssh.host_groups.rename.response",
          payload: {
            group: group ?? null,
            error: group ? null : "Group not found",
            requestId: msg.requestId,
          },
        });
        return undefined;
      }
      case "ssh.host_groups.delete.request": {
        const success = hostStore.deleteGroup(msg.id);
        emit({
          type: "ssh.host_groups.delete.response",
          payload: {
            id: msg.id,
            success,
            error: success ? null : "Group not found",
            requestId: msg.requestId,
          },
        });
        return undefined;
      }
      default:
        return undefined;
    }
  }

  function handleKeysMessage(msg: SshInbound): Promise<void> | undefined {
    switch (msg.type) {
      case "ssh.keys.list.request": {
        emit({
          type: "ssh.keys.list.response",
          payload: { keys: keyStore.list(), requestId: msg.requestId },
        });
        return undefined;
      }
      case "ssh.keys.create.request": {
        try {
          const key = keyStore.create({
            label: msg.label,
            privateKey: msg.privateKey,
            ...definedProps({
              publicKey: msg.publicKey,
              certificate: msg.certificate,
              passphrase: msg.passphrase,
            }),
          });
          emit({
            type: "ssh.keys.create.response",
            payload: { key, error: null, requestId: msg.requestId },
          });
        } catch (error) {
          emit({
            type: "ssh.keys.create.response",
            payload: { key: null, error: getErrorMessage(error), requestId: msg.requestId },
          });
        }
        return undefined;
      }
      case "ssh.keys.update.request": {
        const key = keyStore.update({
          id: msg.id,
          ...definedProps({
            label: msg.label,
            privateKey: msg.privateKey,
            publicKey: msg.publicKey,
            certificate: msg.certificate,
            passphrase: msg.passphrase,
          }),
        });
        emit({
          type: "ssh.keys.update.response",
          payload: {
            key: key ?? null,
            error: key ? null : "Key not found",
            requestId: msg.requestId,
          },
        });
        return undefined;
      }
      case "ssh.keys.delete.request": {
        const success = keyStore.delete(msg.id);
        emit({
          type: "ssh.keys.delete.response",
          payload: {
            id: msg.id,
            success,
            error: success ? null : "Key not found",
            requestId: msg.requestId,
          },
        });
        return undefined;
      }
      default:
        return undefined;
    }
  }

  function handleForwardsMessage(msg: SshInbound): Promise<void> | undefined {
    switch (msg.type) {
      case "ssh.forwards.list.request": {
        const { forwards, runtime } = forwardStore.list();
        emit({
          type: "ssh.forwards.list.response",
          payload: { forwards, runtime, requestId: msg.requestId },
        });
        return undefined;
      }
      case "ssh.forwards.create.request": {
        try {
          const forward = forwardStore.create({
            hostId: msg.hostId,
            forwardType: msg.forwardType,
            listenPort: msg.listenPort,
            ...definedProps({
              label: msg.label,
              bindAddress: msg.bindAddress,
              targetHost: msg.targetHost,
              targetPort: msg.targetPort,
              autoStart: msg.autoStart,
            }),
          });
          emit({
            type: "ssh.forwards.create.response",
            payload: { forward, error: null, requestId: msg.requestId },
          });
        } catch (error) {
          emit({
            type: "ssh.forwards.create.response",
            payload: { forward: null, error: getErrorMessage(error), requestId: msg.requestId },
          });
        }
        return undefined;
      }
      case "ssh.forwards.update.request": {
        const forward = forwardStore.update(
          msg.id,
          definedProps({
            hostId: msg.hostId,
            forwardType: msg.forwardType,
            listenPort: msg.listenPort,
            label: msg.label,
            bindAddress: msg.bindAddress,
            targetHost: msg.targetHost,
            targetPort: msg.targetPort,
            autoStart: msg.autoStart,
          }),
        );
        emit({
          type: "ssh.forwards.update.response",
          payload: {
            forward: forward ?? null,
            error: forward ? null : "Forward not found",
            requestId: msg.requestId,
          },
        });
        return undefined;
      }
      case "ssh.forwards.delete.request": {
        const success = forwardStore.delete(msg.id);
        emit({
          type: "ssh.forwards.delete.response",
          payload: {
            id: msg.id,
            success,
            error: success ? null : "Forward not found",
            requestId: msg.requestId,
          },
        });
        return undefined;
      }
      case "ssh.forwards.start.request":
        return handleForwardStart(msg);
      case "ssh.forwards.stop.request":
        return handleForwardStop(msg);
      default:
        return undefined;
    }
  }

  async function handleForwardStart(
    msg: SshInboundOf<"ssh.forwards.start.request">,
  ): Promise<void> {
    if (!deps.forwardStart) {
      emit({
        type: "ssh.forwards.start.response",
        payload: {
          id: msg.id,
          success: false,
          error: "Port forwarding runtime is not available on this host",
          requestId: msg.requestId,
        },
      });
      return;
    }
    try {
      const result = await deps.forwardStart(msg.id);
      emit({
        type: "ssh.forwards.start.response",
        payload: {
          id: msg.id,
          success: result.ok,
          error: result.ok ? null : (result.error ?? "Failed to start forward"),
          requestId: msg.requestId,
        },
      });
    } catch (error) {
      emit({
        type: "ssh.forwards.start.response",
        payload: {
          id: msg.id,
          success: false,
          error: getErrorMessage(error),
          requestId: msg.requestId,
        },
      });
    }
  }

  async function handleForwardStop(msg: SshInboundOf<"ssh.forwards.stop.request">): Promise<void> {
    if (!deps.forwardStop) {
      emit({
        type: "ssh.forwards.stop.response",
        payload: { id: msg.id, success: true, error: null, requestId: msg.requestId },
      });
      return;
    }
    try {
      const result = await deps.forwardStop(msg.id);
      emit({
        type: "ssh.forwards.stop.response",
        payload: { id: msg.id, success: result.ok, error: null, requestId: msg.requestId },
      });
    } catch (error) {
      emit({
        type: "ssh.forwards.stop.response",
        payload: {
          id: msg.id,
          success: false,
          error: getErrorMessage(error),
          requestId: msg.requestId,
        },
      });
    }
  }

  function handleKnownHostsMessage(msg: SshInbound): Promise<void> | undefined {
    switch (msg.type) {
      case "ssh.known_hosts.list.request": {
        emit({
          type: "ssh.known_hosts.list.response",
          payload: { knownHosts: knownHostStore.list(), requestId: msg.requestId },
        });
        return undefined;
      }
      case "ssh.known_hosts.trust.request": {
        try {
          const knownHost = knownHostStore.trust({
            host: msg.host,
            ...definedProps({ port: msg.port }),
            keyType: msg.keyType,
            publicKey: Buffer.from(msg.publicKeyBase64, "base64"),
          });
          emit({
            type: "ssh.known_hosts.trust.response",
            payload: { knownHost, error: null, requestId: msg.requestId },
          });
        } catch (error) {
          emit({
            type: "ssh.known_hosts.trust.response",
            payload: { knownHost: null, error: getErrorMessage(error), requestId: msg.requestId },
          });
        }
        return undefined;
      }
      case "ssh.known_hosts.delete.request": {
        const success = knownHostStore.delete(msg.id);
        emit({
          type: "ssh.known_hosts.delete.response",
          payload: {
            id: msg.id,
            success,
            error: success ? null : "Known host not found",
            requestId: msg.requestId,
          },
        });
        return undefined;
      }
      case "ssh.known_hosts.import.request": {
        try {
          const { imported, skipped } = knownHostStore.importFromFile(msg.path);
          emit({
            type: "ssh.known_hosts.import.response",
            payload: { imported, skipped, error: null, requestId: msg.requestId },
          });
        } catch (error) {
          emit({
            type: "ssh.known_hosts.import.response",
            payload: {
              imported: 0,
              skipped: 0,
              error: getErrorMessage(error),
              requestId: msg.requestId,
            },
          });
        }
        return undefined;
      }
      default:
        return undefined;
    }
  }

  function handleLogsMessage(msg: SshInbound): Promise<void> | undefined {
    if (msg.type !== "ssh.logs.list.request") {
      return undefined;
    }
    emit({
      type: "ssh.logs.list.response",
      payload: { entries: logStore.list(msg.limit), requestId: msg.requestId },
    });
    return undefined;
  }

  async function handleConnect(msg: SshInboundOf<"ssh.hosts.connect.request">): Promise<void> {
    if (!deps.connectHandler) {
      emit({
        type: "ssh.hosts.connect.response",
        payload: {
          terminal: null,
          error: "SSH connect is not available on this host",
          requestId: msg.requestId,
        },
      });
      return;
    }
    try {
      const result = await deps.connectHandler({
        hostId: msg.hostId,
        ...definedProps({
          cols: msg.cols,
          rows: msg.rows,
          workspaceId: msg.workspaceId,
          cwd: msg.cwd,
        }),
      });
      emitConnectResult(result, msg.requestId);
    } catch (error) {
      emit({
        type: "ssh.hosts.connect.response",
        payload: { terminal: null, error: getErrorMessage(error), requestId: msg.requestId },
      });
    }
  }

  function emitConnectResult(result: SshConnectResult, requestId: string): void {
    if (result.outcome === "connected") {
      emit({
        type: "ssh.hosts.connect.response",
        payload: { terminal: result.terminal, error: null, requestId },
      });
      return;
    }
    if (result.outcome === "host_key_mismatch") {
      emit({
        type: "ssh.hosts.connect.response",
        payload: {
          terminal: null,
          error: result.error,
          code: "host_key_mismatch",
          observedKey: result.observedKey,
          requestId,
        },
      });
      return;
    }
    emit({
      type: "ssh.hosts.connect.response",
      payload: { terminal: null, error: result.error, requestId },
    });
  }

  return {
    dispatch(msg: SessionInboundMessage): Promise<void> | undefined {
      if (!msg.type.startsWith("ssh.")) {
        return undefined;
      }
      const sshMsg = msg as SshInbound;
      // Synchronous handlers emit and return undefined; the trailing resolved
      // promise marks every ssh.* message as consumed so the session's
      // dispatch chain never falls through to another handler.
      return (
        handleHostsMessage(sshMsg) ??
        handleGroupsMessage(sshMsg) ??
        handleKeysMessage(sshMsg) ??
        handleForwardsMessage(sshMsg) ??
        handleKnownHostsMessage(sshMsg) ??
        handleLogsMessage(sshMsg) ??
        Promise.resolve()
      );
    },
  };
}
