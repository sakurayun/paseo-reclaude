// Fork-owned. Terminal records carry no explicit SSH identity — an SSH
// terminal is just a session owned by the in-process ssh terminal manager (or,
// for Mosh/FIDO2/handshake fallbacks, a local pty running the system ssh
// binary). This in-memory registry is the authoritative terminalId → host
// mapping so MCP tools and the reveal push can label terminals without
// changing the terminal record shape. Entries are registered by the SSH
// connect service on both success paths and dropped on terminal exit.

export interface SshTerminalMeta {
  hostId: string;
  hostLabel: string;
  via: "ssh2" | "fallback";
  connectedAt: number;
}

export interface SshTerminalRegistry {
  register(terminalId: string, meta: SshTerminalMeta): void;
  unregister(terminalId: string): void;
  get(terminalId: string): SshTerminalMeta | undefined;
  listTerminalIdsByHost(hostId: string): string[];
}

export function createSshTerminalRegistry(): SshTerminalRegistry {
  const entries = new Map<string, SshTerminalMeta>();

  return {
    register(terminalId, meta): void {
      entries.set(terminalId, meta);
    },
    unregister(terminalId): void {
      entries.delete(terminalId);
    },
    get(terminalId): SshTerminalMeta | undefined {
      return entries.get(terminalId);
    },
    listTerminalIdsByHost(hostId): string[] {
      const ids: string[] = [];
      for (const [terminalId, meta] of entries) {
        if (meta.hostId === hostId) {
          ids.push(terminalId);
        }
      }
      return ids;
    },
  };
}
