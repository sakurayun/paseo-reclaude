import { z } from "zod";

import { ensureValidJson } from "../../json-utils.js";
import type { SshManager } from "../../../ssh/ssh-manager.js";
import type { SshTerminalRegistry } from "../../../ssh/ssh-terminal-registry.js";
import type { TerminalManager } from "../../../terminal/terminal-manager.js";
import type { SshHostInfo } from "@getpaseo/protocol/messages";
import type { PaseoToolConfig, PaseoToolExecutionContext, PaseoToolResult } from "./types.js";
import { TerminalSummarySchema, type TerminalSummary } from "./terminal-summary.js";

// Fork-owned MCP surface over the SSH host manager. Security posture:
// - Hosts are projected through an explicit allowlist — startup snippets, env,
//   proxy details, and anything secret-adjacent never leave the daemon.
// - connect_ssh_host takes no password: credentials are saved via the Paseo
//   client UI only, so secrets never transit agent context or MCP logs.
// - There is no MCP trust primitive: a host-key mismatch is reported with the
//   observed fingerprint, and trusting it stays a human decision in the client.

export interface RegisterSshToolsOptions {
  registerTool: (
    name: string,
    config: PaseoToolConfig,
    handler: (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Tool inputs are validated by the catalog before execution.
      input: any,
      context: PaseoToolExecutionContext,
    ) => Promise<PaseoToolResult>,
  ) => void;
  sshManager: SshManager;
  sshTerminalRegistry?: SshTerminalRegistry | null;
  terminalManager?: TerminalManager | null;
  // Caller agent's workspace, when there is one. Never mints a workspace: an
  // SSH terminal without a real workspace placement falls back to the
  // synthetic ssh:<hostId> bucket inside the connect service.
  resolveDefaultWorkspaceId: () => string | undefined;
  summarizeTerminal: (terminalId: string) => TerminalSummary | undefined;
  // Broadcasts terminal.reveal so clients open the new terminal's tab.
  revealTerminal: (terminalId: string) => boolean;
}

const SshHostSummarySchema = z.object({
  id: z.string(),
  label: z.string(),
  address: z.string(),
  port: z.number().optional(),
  username: z.string().optional(),
  groupId: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  auth: z.object({
    password: z.boolean(),
    key: z.boolean(),
    agent: z.boolean(),
    fido2: z.boolean(),
  }),
  mosh: z.boolean(),
  platformOs: z.string().optional(),
  // Terminals currently connected to this host (join over the SSH terminal
  // registry, filtered to sessions that still exist).
  activeTerminalIds: z.array(z.string()),
});

const SshHostGroupSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable().optional(),
});

const SSH_CONNECT_PROGRESS_TAIL = 20;

export function registerSshTools(options: RegisterSshToolsOptions): void {
  const {
    registerTool,
    sshManager,
    sshTerminalRegistry,
    terminalManager,
    resolveDefaultWorkspaceId,
    summarizeTerminal,
    revealTerminal,
  } = options;

  function listActiveTerminalIds(hostId: string): string[] {
    if (!sshTerminalRegistry) {
      return [];
    }
    return sshTerminalRegistry
      .listTerminalIdsByHost(hostId)
      .filter((terminalId) => terminalManager?.getTerminal(terminalId) !== undefined);
  }

  function toHostSummary(host: SshHostInfo): z.infer<typeof SshHostSummarySchema> {
    return {
      id: host.id,
      label: host.label,
      address: host.address,
      ...(host.port !== undefined ? { port: host.port } : {}),
      ...(host.username !== undefined ? { username: host.username } : {}),
      ...(host.groupId !== undefined ? { groupId: host.groupId } : {}),
      ...(host.tags !== undefined ? { tags: host.tags } : {}),
      auth: {
        password: host.hasPassword === true,
        key: host.keyId != null,
        agent: host.useAgent === true,
        fido2: host.useFido2 === true,
      },
      mosh: host.mosh?.enabled === true,
      ...(host.platform?.os !== undefined ? { platformOs: host.platform.os } : {}),
      activeTerminalIds: listActiveTerminalIds(host.id),
    };
  }

  registerTool(
    "list_ssh_hosts",
    {
      title: "List SSH hosts",
      description:
        "List the SSH hosts and host groups saved in this daemon's SSH host manager, including auth method summary and terminals currently connected to each host. Use connect_ssh_host to open a shell on one of them.",
      inputSchema: {},
      outputSchema: {
        hosts: z.array(SshHostSummarySchema),
        groups: z.array(SshHostGroupSummarySchema),
      },
    },
    async () => {
      const snapshot = sshManager.hostStore.list();
      return {
        content: [],
        structuredContent: ensureValidJson({
          hosts: snapshot.hosts.map(toHostSummary),
          groups: snapshot.groups.map((group) => {
            const summary: z.infer<typeof SshHostGroupSummarySchema> = {
              id: group.id,
              name: group.name,
            };
            if (group.parentId !== undefined) {
              summary.parentId = group.parentId;
            }
            return summary;
          }),
        }),
      };
    },
  );

  registerTool(
    "connect_ssh_host",
    {
      title: "Connect SSH host",
      description:
        "Open an interactive shell on a saved SSH host and expose it as a terminal (usable with capture_terminal, send_terminal_keys, run_terminal_command, kill_terminal). Identify the host by hostId or by its unique label. Credentials must already be saved in the Paseo client; this tool never accepts passwords. On host_key_mismatch, the key must be trusted by a human in the Paseo client.",
      inputSchema: {
        hostId: z.string().optional().describe("SSH host id from list_ssh_hosts."),
        hostLabel: z
          .string()
          .optional()
          .describe("Host label (case-insensitive) as an alternative to hostId."),
        cwd: z
          .string()
          .optional()
          .describe(
            "Optional absolute path used only to place the terminal record locally; the remote shell is unaffected.",
          ),
        workspaceId: z
          .string()
          .optional()
          .describe("Optional workspace to place the terminal in. Defaults to your workspace."),
        cols: z.number().int().min(20).max(500).optional(),
        rows: z.number().int().min(5).max(200).optional(),
        focus: z
          .boolean()
          .optional()
          .describe("Ask connected Paseo clients to open the new terminal's tab."),
      },
      outputSchema: {
        outcome: z.enum(["connected", "auth_failed", "host_key_mismatch", "error"]),
        terminal: TerminalSummarySchema.optional(),
        error: z.string().optional(),
        observedKey: z
          .object({
            host: z.string(),
            port: z.number().optional(),
            keyType: z.string(),
            fingerprintSha256: z.string(),
          })
          .optional(),
        progress: z.array(z.string()).optional(),
      },
    },
    async ({ hostId, hostLabel, cwd, workspaceId, cols, rows, focus = false }) => {
      const connectHandler = sshManager.connectHandler;
      if (!connectHandler) {
        throw new Error("SSH connect service is not configured");
      }

      const host = resolveHost(sshManager, { hostId, hostLabel });

      // Keep only the tail of the live progress stream: on failure the last
      // lines carry the diagnosis (auth step, handshake error, fallback note).
      const progressTail: string[] = [];
      const result = await connectHandler({
        hostId: host.id,
        ...(cols !== undefined ? { cols } : {}),
        ...(rows !== undefined ? { rows } : {}),
        ...(cwd !== undefined ? { cwd } : {}),
        ...(workspaceId !== undefined
          ? { workspaceId }
          : (() => {
              const defaultWorkspaceId = resolveDefaultWorkspaceId();
              return defaultWorkspaceId !== undefined ? { workspaceId: defaultWorkspaceId } : {};
            })()),
        onProgress: (line) => {
          progressTail.push(line);
          if (progressTail.length > SSH_CONNECT_PROGRESS_TAIL) {
            progressTail.shift();
          }
        },
      });

      if (result.outcome === "connected") {
        if (focus) {
          // Best-effort: the connection already succeeded.
          revealTerminal(result.terminal.id);
        }
        const summary = summarizeTerminal(result.terminal.id) ?? {
          id: result.terminal.id,
          name: result.terminal.name,
          cwd: result.terminal.cwd,
          ...(result.terminal.workspaceId !== undefined
            ? { workspaceId: result.terminal.workspaceId }
            : {}),
          kind: "ssh" as const,
          sshHostId: host.id,
          sshHostLabel: host.label,
        };
        return {
          content: [],
          structuredContent: ensureValidJson({
            outcome: "connected",
            terminal: summary,
          }),
        };
      }

      const guidance = failureGuidance(result.outcome);

      return {
        content: [],
        structuredContent: ensureValidJson({
          outcome: result.outcome,
          error: guidance ? `${result.error} ${guidance}` : result.error,
          ...(result.outcome === "host_key_mismatch"
            ? {
                observedKey: {
                  host: result.observedKey.host,
                  ...(result.observedKey.port !== undefined
                    ? { port: result.observedKey.port }
                    : {}),
                  keyType: result.observedKey.keyType,
                  fingerprintSha256: result.observedKey.fingerprintSha256,
                },
              }
            : {}),
          ...(progressTail.length > 0 ? { progress: [...progressTail] } : {}),
        }),
        isError: true,
      };
    },
  );
}

function failureGuidance(
  outcome: "auth_failed" | "host_key_mismatch" | "error",
): string | undefined {
  if (outcome === "auth_failed") {
    return "Authentication failed. Save working credentials for this host in the Paseo client (SSH host manager), then retry.";
  }
  if (outcome === "host_key_mismatch") {
    return "Host key mismatch. Verify the fingerprint out-of-band and trust it in the Paseo client (SSH → Known Hosts); this cannot be trusted via MCP.";
  }
  return undefined;
}

function resolveHost(
  sshManager: SshManager,
  input: { hostId?: string; hostLabel?: string },
): SshHostInfo {
  const hostId = input.hostId?.trim();
  const hostLabel = input.hostLabel?.trim();
  if (hostId && hostLabel) {
    throw new Error("Provide either hostId or hostLabel, not both");
  }
  if (hostId) {
    const host = sshManager.hostStore.getHost(hostId);
    if (!host) {
      throw new Error(`SSH host ${hostId} not found`);
    }
    return host;
  }
  if (!hostLabel) {
    throw new Error("Provide hostId or hostLabel");
  }
  const needle = hostLabel.toLowerCase();
  const matches = sshManager.hostStore
    .list()
    .hosts.filter((host) => host.label.toLowerCase() === needle);
  if (matches.length === 0) {
    throw new Error(`No SSH host labeled "${hostLabel}". Call list_ssh_hosts to see saved hosts.`);
  }
  if (matches.length > 1) {
    throw new Error(
      `Multiple SSH hosts labeled "${hostLabel}"; use hostId instead: ${matches
        .map((host) => host.id)
        .join(", ")}`,
    );
  }
  return matches[0];
}
