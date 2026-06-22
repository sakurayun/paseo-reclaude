import { useMemo } from "react";
import { useSessionStore } from "@/stores/session-store";
import type { AgentDirectoryEntry } from "@/types/agent-directory";
import { useAgentHistory } from "@/hooks/use-agent-history";

/**
 * One row in the new-theme flat sessions sidebar: a single agent session
 * (conversation), enriched with the recency key we sort by and the project
 * name shown as the row subtitle.
 */
export interface SidebarSessionEntry extends AgentDirectoryEntry {
  /**
   * Sort key. The user wants ordering by "the most recent user message", which
   * lives on the live Agent as `lastUserMessageAt`; we fall back to
   * `lastActivityAt` for history-only sessions that aren't hydrated yet.
   */
  recencyAt: Date;
  /** Project (or workspace) name for the row subtitle, when known. */
  projectName: string | null;
}

export interface SidebarSessionsListResult {
  sessions: SidebarSessionEntry[];
  isInitialLoad: boolean;
  isRevalidating: boolean;
  refreshAll: () => void;
}

const EMPTY_SESSIONS: SidebarSessionEntry[] = [];

/**
 * Flat, recency-sorted list of every non-archived session on the active host.
 *
 * Merges the per-server agent-history cache (the full set, incl. sessions not
 * loaded this run) with the live session-store agents (so new sessions,
 * renames, status changes, and fresh user messages show up without a refetch).
 * Live agents win on id and contribute `lastUserMessageAt` for the recency key.
 */
export function useSidebarSessionsList(serverId: string | null): SidebarSessionsListResult {
  const { agents, isInitialLoad, isRevalidating, refreshAll } = useAgentHistory({ serverId });
  const liveAgentsMap = useSessionStore((state) =>
    serverId ? state.sessions[serverId]?.agents : undefined,
  );

  const sessions = useMemo(() => {
    const byId = new Map<string, SidebarSessionEntry>();

    for (const agent of agents) {
      if (agent.archivedAt) {
        continue;
      }
      byId.set(agent.id, {
        ...agent,
        recencyAt: agent.lastActivityAt,
        projectName: agent.projectPlacement?.projectName ?? null,
      });
    }

    if (liveAgentsMap) {
      for (const agent of liveAgentsMap.values()) {
        if (agent.archivedAt) {
          continue;
        }
        byId.set(agent.id, {
          id: agent.id,
          serverId: agent.serverId,
          title: agent.title ?? null,
          status: agent.status,
          lastActivityAt: agent.lastActivityAt,
          cwd: agent.cwd,
          workspaceId: agent.workspaceId,
          provider: agent.provider,
          pendingPermissionCount: agent.pendingPermissions.length,
          requiresAttention: agent.requiresAttention,
          attentionReason: agent.attentionReason,
          attentionTimestamp: agent.attentionTimestamp ?? null,
          archivedAt: agent.archivedAt ?? null,
          createdAt: agent.createdAt,
          labels: agent.labels,
          projectPlacement: agent.projectPlacement,
          recencyAt: agent.lastUserMessageAt ?? agent.lastActivityAt,
          projectName: agent.projectPlacement?.projectName ?? null,
        });
      }
    }

    if (byId.size === 0) {
      return EMPTY_SESSIONS;
    }

    return Array.from(byId.values()).sort(
      (left, right) => right.recencyAt.getTime() - left.recencyAt.getTime(),
    );
  }, [agents, liveAgentsMap]);

  return { sessions, isInitialLoad, isRevalidating, refreshAll };
}
