import { parseHostPort } from "@getpaseo/protocol/daemon-endpoints";
import type { WorkspaceScriptPayload } from "@getpaseo/protocol/messages";
import type { ActiveConnection } from "@/runtime/host-runtime";

export type WorkspaceScriptLinkKind = "public" | "paseo" | "direct";

export interface WorkspaceScriptLinkTarget {
  kind: WorkspaceScriptLinkKind;
  label: string;
  url: string;
}

export interface ResolvedWorkspaceScriptLink {
  primary: WorkspaceScriptLinkTarget | null;
  targets: WorkspaceScriptLinkTarget[];
}

function isLoopbackHost(host: string): boolean {
  const normalizedHost = host.trim().toLowerCase();
  return (
    normalizedHost === "localhost" || normalizedHost === "127.0.0.1" || normalizedHost === "::1"
  );
}

function isLocalOnlyUrl(url: string | null | undefined): boolean {
  if (!url) return true;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return isLoopbackHost(hostname) || hostname.endsWith(".localhost");
  } catch {
    return true;
  }
}

/**
 * Whether the active connection reaches a remote daemon, so a service running on
 * the daemon host isn't directly reachable at `localhost` from this client and a
 * tunnel is worthwhile. Local transports (loopback TCP, unix socket, pipe) are
 * already on the same machine, so they don't need one.
 */
export function isRemoteTunnelConnection(activeConnection: ActiveConnection | null): boolean {
  if (!activeConnection) {
    return false;
  }
  if (activeConnection.type === "relay") {
    return true;
  }
  if (activeConnection.type === "directSocket" || activeConnection.type === "directPipe") {
    return false;
  }
  try {
    const { host } = parseHostPort(activeConnection.endpoint);
    return !isLoopbackHost(host);
  } catch {
    return false;
  }
}

function stripUrlProtocol(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

function buildDirectServiceUrl(
  activeConnection: ActiveConnection | null,
  port: number | null,
): string | null {
  if (port === null) return null;
  if (activeConnection?.type !== "directTcp") {
    return `http://localhost:${port}`;
  }
  try {
    const { host, isIpv6 } = parseHostPort(activeConnection.endpoint);
    let base = host;
    if (isLoopbackHost(host)) {
      base = "localhost";
    } else if (isIpv6) {
      base = `[${host}]`;
    }
    return `http://${base}:${port}`;
  } catch {
    return `http://localhost:${port}`;
  }
}

function addTarget(
  targets: WorkspaceScriptLinkTarget[],
  kind: WorkspaceScriptLinkKind,
  url: string | null | undefined,
): void {
  if (!url || targets.some((target) => target.url === url)) return;
  targets.push({ kind, label: stripUrlProtocol(url), url });
}

export function resolveWorkspaceScriptLink(input: {
  script: WorkspaceScriptPayload;
  activeConnection: ActiveConnection | null;
}): ResolvedWorkspaceScriptLink {
  const { script, activeConnection } = input;
  if (script.type !== "service" || script.lifecycle !== "running") {
    return { primary: null, targets: [] };
  }

  // COMPAT(workspaceScriptSplitUrls): added in v0.2.0, remove after 2027-01-21.
  // Old daemons only send proxyUrl, so classify it by reachability.
  const localProxyUrl =
    script.localProxyUrl ?? (isLocalOnlyUrl(script.proxyUrl) ? script.proxyUrl : null);
  const publicProxyUrl =
    script.publicProxyUrl ?? (!isLocalOnlyUrl(script.proxyUrl) ? script.proxyUrl : null);

  const targets: WorkspaceScriptLinkTarget[] = [];
  addTarget(targets, "public", publicProxyUrl);
  addTarget(targets, "paseo", localProxyUrl);
  addTarget(targets, "direct", buildDirectServiceUrl(activeConnection, script.port));

  return { primary: targets[0] ?? null, targets };
}
