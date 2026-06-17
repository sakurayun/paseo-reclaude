import { TunnelStreamOpcode, type TunnelStreamFrame } from "@getpaseo/protocol/binary-frames/index";
import { invokeDesktopCommand } from "@/desktop/electron/invoke";
import { listenToDesktopEvent } from "@/desktop/electron/events";

/**
 * Desktop-only runtime that keeps the daemon-global port-forward list live: for
 * each entry it binds `127.0.0.1:<localPort>` on this machine and tunnels new
 * connections to `<remotePort>` on the daemon host over the WebSocket we already
 * hold (reusing the tcpTunnel frame family from PR #1511).
 *
 * Unlike the service-link tunnel (`tunnel-forwarding.ts`), here the local and
 * remote ports differ — the listener binds `localPort`, the stream targets
 * `remotePort`. The forward list is reconciled declaratively: `reconcile()`
 * diffs the desired list against the live listeners and binds/unbinds the delta.
 *
 * Three hops per byte (identical to the service-link tunnel):
 *   browser ⇄ main-process loopback listener (desktop IPC)
 *           ⇄ this controller
 *           ⇄ daemon client tunnel frames (existing WebSocket)
 *           ⇄ daemon `127.0.0.1:<remotePort>`
 *
 * Desktop-only: it needs a main-process TCP listener that plain web and native
 * can't provide. Callers must gate on `getIsElectron()`.
 */

/** The slice of DaemonClient this controller needs — structural to avoid coupling. */
export interface PortForwardTunnelClient {
  openTunnelStream(streamId: string, port: number): void;
  sendTunnelData(streamId: string, payload: Uint8Array): void;
  closeTunnelStream(streamId: string, reason?: number): void;
  onTunnelFrame(handler: (frame: TunnelStreamFrame) => void): () => void;
}

export interface DesiredPortForward {
  localPort: number;
  remotePort: number;
}

interface TunnelEventPayload {
  listenerId: string;
  streamId: string;
  kind: "connection" | "data" | "close";
  binaryBase64?: string;
}

interface ForwardState {
  listenerId: string;
  client: PortForwardTunnelClient;
  localPort: number;
  remotePort: number;
}

const forwardsByLocalPort = new Map<number, ForwardState>();
const forwardsByListener = new Map<string, ForwardState>();
const clientSubscriptions = new Map<PortForwardTunnelClient, () => void>();
let desktopSubscribed = false;
let listenerSeq = 0;
let instanceId: string | null = null;

/**
 * A per-renderer-process id so listenerIds are unique across windows (the
 * desktop broadcasts tunnel events to every window and each filters by the
 * listenerIds it owns). Computed lazily so `crypto` is never touched at import
 * time on native.
 */
function getInstanceId(): string {
  if (!instanceId) {
    instanceId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `inst-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }
  return instanceId;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function ensureDesktopSubscription(): void {
  if (desktopSubscribed) {
    return;
  }
  desktopSubscribed = true;
  void listenToDesktopEvent<TunnelEventPayload>("tunnel", handleDesktopTunnelEvent);
  // Best-effort reclaim of this window's loopback listeners on close/reload. The
  // main process's closeAllTunnelListeners() on app quit is the backstop.
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("beforeunload", teardownAllPortForwards);
  }
}

function handleDesktopTunnelEvent(payload: TunnelEventPayload): void {
  const forward = forwardsByListener.get(payload.listenerId);
  if (!forward) {
    // Belongs to another window's listener, or to the service-link tunnel.
    return;
  }
  if (payload.kind === "connection") {
    // A new browser connection on the local port — open a stream to the REMOTE port.
    forward.client.openTunnelStream(payload.streamId, forward.remotePort);
    return;
  }
  if (payload.kind === "data") {
    if (payload.binaryBase64) {
      forward.client.sendTunnelData(payload.streamId, base64ToBytes(payload.binaryBase64));
    }
    return;
  }
  forward.client.closeTunnelStream(payload.streamId);
}

function ensureClientSubscription(client: PortForwardTunnelClient): void {
  if (clientSubscriptions.has(client)) {
    return;
  }
  const unsubscribe = client.onTunnelFrame((frame) => {
    if (frame.opcode === TunnelStreamOpcode.Data) {
      void invokeDesktopCommand("send_tunnel_data", {
        streamId: frame.streamId,
        binaryBase64: bytesToBase64(frame.payload),
      });
      return;
    }
    if (frame.opcode === TunnelStreamOpcode.Close) {
      void invokeDesktopCommand("close_tunnel_stream", { streamId: frame.streamId });
    }
  });
  clientSubscriptions.set(client, unsubscribe);
}

/** Drop a client's tunnel-frame subscription once no forward references it. */
function releaseClientIfUnused(client: PortForwardTunnelClient): void {
  for (const forward of forwardsByLocalPort.values()) {
    if (forward.client === client) {
      return;
    }
  }
  const unsubscribe = clientSubscriptions.get(client);
  if (unsubscribe) {
    unsubscribe();
    clientSubscriptions.delete(client);
  }
}

function removeForward(localPort: number): void {
  const forward = forwardsByLocalPort.get(localPort);
  if (!forward) {
    return;
  }
  void invokeDesktopCommand("close_tunnel_listener", { listenerId: forward.listenerId });
  forwardsByLocalPort.delete(localPort);
  forwardsByListener.delete(forward.listenerId);
  releaseClientIfUnused(forward.client);
}

async function ensureForward(input: {
  client: PortForwardTunnelClient;
  localPort: number;
  remotePort: number;
}): Promise<void> {
  ensureDesktopSubscription();
  ensureClientSubscription(input.client);

  const listenerId = `pf-${getInstanceId()}-${input.localPort}-${input.remotePort}-${(listenerSeq += 1)}`;
  await invokeDesktopCommand<{ port: number }>("open_tunnel_listener", {
    listenerId,
    port: input.localPort,
  });

  const forward: ForwardState = {
    listenerId,
    client: input.client,
    localPort: input.localPort,
    remotePort: input.remotePort,
  };
  forwardsByLocalPort.set(input.localPort, forward);
  forwardsByListener.set(listenerId, forward);
}

/**
 * Diff the desired forward list against the live listeners and apply the delta:
 * unbind listeners no longer wanted (or whose remote port changed), bind the
 * ones that are new. Binding a local port already in use is swallowed (the entry
 * simply stays inactive) so one bad row never breaks the rest. Idempotent.
 */
export async function reconcilePortForwards(input: {
  client: PortForwardTunnelClient;
  forwards: DesiredPortForward[];
}): Promise<void> {
  const desiredByLocalPort = new Map<number, number>();
  for (const forward of input.forwards) {
    desiredByLocalPort.set(forward.localPort, forward.remotePort);
  }

  // Collect stale local ports first so we don't mutate the map while iterating.
  const staleLocalPorts: number[] = [];
  for (const [localPort, state] of forwardsByLocalPort) {
    const desiredRemote = desiredByLocalPort.get(localPort);
    if (desiredRemote !== state.remotePort || state.client !== input.client) {
      staleLocalPorts.push(localPort);
    }
  }
  for (const localPort of staleLocalPorts) {
    removeForward(localPort);
  }

  // Add forwards that aren't live yet.
  for (const forward of input.forwards) {
    if (forwardsByLocalPort.has(forward.localPort)) {
      continue;
    }
    try {
      await ensureForward({
        client: input.client,
        localPort: forward.localPort,
        remotePort: forward.remotePort,
      });
    } catch {
      // Local port couldn't be bound (e.g. already in use) — leave it inactive.
    }
  }
}

/** Tear down every live forward. Call when leaving the desktop forward surface. */
export function teardownAllPortForwards(): void {
  for (const forward of forwardsByListener.values()) {
    void invokeDesktopCommand("close_tunnel_listener", { listenerId: forward.listenerId });
  }
  forwardsByLocalPort.clear();
  forwardsByListener.clear();
  for (const unsubscribe of clientSubscriptions.values()) {
    unsubscribe();
  }
  clientSubscriptions.clear();
}
