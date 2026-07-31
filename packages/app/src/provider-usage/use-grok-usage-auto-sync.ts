import { useEffect, useRef } from "react";
import { useAppSettings } from "@/hooks/use-settings";
import { useGrok } from "./use-grok";

/**
 * Periodically pull Grok billing usage while a Grok agent meter is mounted.
 * Interval comes from app settings (default 5 minutes). 0 disables auto-sync.
 * Calls use force=false so the daemon throttle still applies.
 */
export function useGrokUsageAutoSync(params: {
  serverId: string | null | undefined;
  enabled: boolean;
}): void {
  const { serverId, enabled } = params;
  const intervalMinutes = useAppSettings().settings.grokUsageRefreshIntervalMinutes;
  const { supported, syncUsage } = useGrok(serverId);
  const syncUsageRef = useRef(syncUsage);
  syncUsageRef.current = syncUsage;

  useEffect(() => {
    if (!enabled || !serverId || !supported || intervalMinutes <= 0) {
      return;
    }

    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      void syncUsageRef.current().catch(() => undefined);
    };

    run();
    const id = setInterval(run, intervalMinutes * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled, intervalMinutes, serverId, supported]);
}
