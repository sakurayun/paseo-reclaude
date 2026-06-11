import { usePanelStore } from "@/stores/panel-store";
import { useSessionStore, type Agent } from "@/stores/session-store";
import type { AgentDirectoryEntry } from "@/types/agent-directory";
import { navigateToAgent } from "@/utils/navigate-to-agent";

// History sessions may not be hydrated in the session store yet. Seed a
// minimal Agent detail from the directory entry so navigation can resolve the
// agent's workspace from its cwd (and the agent screen has something to show
// while the daemon hydrates the real state).
function buildDirectoryAgentDetail(entry: AgentDirectoryEntry): Agent {
  return {
    serverId: entry.serverId,
    id: entry.id,
    provider: entry.provider,
    status: entry.status,
    createdAt: entry.createdAt,
    updatedAt: entry.lastActivityAt,
    lastUserMessageAt: null,
    lastActivityAt: entry.lastActivityAt,
    capabilities: {
      supportsStreaming: false,
      supportsSessionPersistence: false,
      supportsDynamicModes: false,
      supportsMcpServers: false,
      supportsReasoningStream: false,
      supportsToolInvocations: false,
    },
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    runtimeInfo: {
      provider: entry.provider,
      sessionId: null,
    },
    title: entry.title,
    cwd: entry.cwd,
    model: null,
    thinkingOptionId: null,
    requiresAttention: entry.requiresAttention,
    attentionReason: entry.attentionReason,
    attentionTimestamp: entry.attentionTimestamp,
    archivedAt: entry.archivedAt,
    labels: entry.labels,
    parentAgentId: null,
  };
}

/**
 * Open a session from the agent directory. Routes through navigateToAgent so
 * the session lands in its own workspace tab when its cwd maps to a known
 * workspace, and falls back to the full-screen agent route otherwise — the
 * same behavior on desktop and mobile.
 */
export function navigateToAgentDirectoryEntry(entry: AgentDirectoryEntry): string {
  const store = useSessionStore.getState();
  const session = store.sessions[entry.serverId];
  const liveAgent = session?.agents.get(entry.id) ?? null;
  const isKnown = Boolean(liveAgent ?? session?.agentDetails.get(entry.id));
  if (!isKnown) {
    store.setAgentDetails(entry.serverId, (previous) => {
      const next = new Map(previous);
      next.set(entry.id, buildDirectoryAgentDetail(entry));
      return next;
    });
  }
  // Agents that are not in the live agents map (history-only or archived
  // sessions) are not part of the workspace's active set, so their tab would
  // be pruned by tab reconciliation immediately after opening. Pinning keeps
  // the tab alive — pinned agents survive reconcile as long as they are known.
  const needsPin = Boolean(entry.archivedAt) || !liveAgent || Boolean(liveAgent.archivedAt);
  const route = navigateToAgent({
    serverId: entry.serverId,
    agentId: entry.id,
    pin: needsPin,
  });
  // On compact layouts the workspace list renders as an overlay above the
  // content; close it so the opened session is actually visible. No-op on
  // desktop where mobileView is unused.
  usePanelStore.getState().showMobileAgent();
  return route;
}
