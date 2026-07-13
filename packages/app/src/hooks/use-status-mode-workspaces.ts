import { useMemo } from "react";
import { useSessionStore } from "@/stores/session-store";

/**
 * Project display names keyed by projectKey/projectId for a host.
 * Used by the flat sessions list (new theme) to label rows without a full
 * sidebar workspaces list fetch.
 */
export function useProjectNamesMap(serverId: string | null): Map<string, string> {
  const workspaces = useSessionStore((state) =>
    serverId ? state.sessions[serverId]?.workspaces : undefined,
  );

  return useMemo(() => {
    const map = new Map<string, string>();
    if (!serverId || !workspaces) return map;
    for (const workspace of workspaces.values()) {
      const key = workspace.project?.projectKey ?? workspace.projectId;
      if (!map.has(key)) {
        map.set(key, workspace.projectCustomName ?? workspace.projectDisplayName);
      }
    }
    return map;
  }, [serverId, workspaces]);
}
