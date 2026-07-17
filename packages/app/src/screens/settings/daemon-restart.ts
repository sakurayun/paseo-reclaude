import type { DesktopDaemonStatus } from "@/desktop/daemon/desktop-daemon";
import type { HostConnection, HostProfile } from "@/types/host-connection";

interface DesktopDaemonRestartStatus {
  desktopManaged: boolean;
  serverId: string;
  status?: string;
  listen?: string | null;
}

interface DesktopDaemonRestartSettings {
  daemon: {
    manageBuiltInDaemon: boolean;
  };
}

export interface SettingsDaemonRestartDeps {
  getIsElectron: () => boolean;
  getDesktopDaemonStatus: () => Promise<DesktopDaemonRestartStatus>;
  getDesktopSettings: () => Promise<DesktopDaemonRestartSettings>;
  restartDesktopDaemon: () => Promise<DesktopDaemonStatus>;
  restartServer: (reason: string) => Promise<unknown>;
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

/**
 * True when this host profile is almost certainly the machine-local daemon
 * (loopback TCP / unix socket / named pipe), not a remote relay peer.
 */
export function hostProfileLooksLocal(host: Pick<HostProfile, "connections">): boolean {
  return host.connections.some((connection) => connectionLooksLocal(connection));
}

function connectionLooksLocal(connection: HostConnection): boolean {
  if (connection.type === "directSocket" || connection.type === "directPipe") {
    return true;
  }
  if (connection.type !== "directTcp") {
    return false;
  }
  const endpoint = connection.endpoint.trim();
  // endpoint forms: "localhost:6767", "127.0.0.1:6767", "[::1]:6767"
  const hostPart = endpoint.startsWith("[")
    ? endpoint.slice(1, endpoint.indexOf("]"))
    : (endpoint.split(":")[0] ?? "");
  return isLoopbackHost(hostPart);
}

/**
 * Decide whether to restart via the Electron desktop bridge (stop+start) rather
 * than the websocket RPC. Desktop-managed daemons are spawned detached without a
 * supervisor IPC channel, so an RPC restart only exits the process and never
 * brings it back — which feels like the Restart button "does nothing" after a
 * brief disconnect / reconnect failure.
 */
export async function shouldRestartViaDesktopBridge(
  hostServerId: string,
  deps: SettingsDaemonRestartDeps,
  options?: { hostLooksLocal?: boolean },
): Promise<boolean> {
  if (!deps.getIsElectron()) {
    return false;
  }

  const desktopDaemonStatus = await deps.getDesktopDaemonStatus();
  if (!desktopDaemonStatus.desktopManaged) {
    return false;
  }

  const normalizedHostServerId = hostServerId.trim();
  const normalizedDesktopServerId = desktopDaemonStatus.serverId.trim();

  // Different non-empty serverIds and not a loopback host → remote peer; use RPC.
  if (
    normalizedHostServerId.length > 0 &&
    normalizedDesktopServerId.length > 0 &&
    normalizedHostServerId !== normalizedDesktopServerId &&
    options?.hostLooksLocal !== true
  ) {
    return false;
  }

  const desktopSettings = await deps.getDesktopSettings();
  if (!desktopSettings.daemon.manageBuiltInDaemon) {
    return false;
  }

  // Primary: exact serverId match between the settings host and the managed daemon.
  if (
    normalizedHostServerId.length > 0 &&
    normalizedDesktopServerId.length > 0 &&
    normalizedHostServerId === normalizedDesktopServerId
  ) {
    return true;
  }

  // Fallback: desktop is managing a local daemon but serverId is temporarily
  // empty / mismatched while the host profile is clearly loopback. Prefer the
  // desktop bridge so we don't kill a detached daemon via RPC with no respawn.
  if (options?.hostLooksLocal === true) {
    return true;
  }

  return false;
}

export async function restartDaemonFromSettings(
  hostServerId: string,
  reason: string,
  deps: SettingsDaemonRestartDeps,
  options?: { hostLooksLocal?: boolean },
): Promise<void> {
  if (await shouldRestartViaDesktopBridge(hostServerId, deps, options)) {
    await deps.restartDesktopDaemon();
    return;
  }

  await deps.restartServer(reason);
}
