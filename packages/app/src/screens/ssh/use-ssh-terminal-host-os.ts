import { useEffect, useMemo } from "react";
import { useSshTerminalMeta, patchSshTerminalMeta } from "@/stores/ssh-terminal-meta-store";
import { useSshHosts } from "@/screens/ssh/use-ssh-hosts";

export interface SshTerminalHostInfo {
  isSsh: boolean;
  // Detected /etc/os-release ID of the remote host (null while undetected or
  // for local terminals).
  os: string | null;
}

function trimOs(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// Resolves whether a terminal is an SSH session and which OS its remote host
// runs, so terminal rows/tabs can show the host's brand icon. Prefer the live
// hosts list when available; fall back to the OS cached on terminal meta so a
// hard refresh still shows the badge before hosts rehydrate.
export function useSshTerminalHostOs(
  serverId: string | null,
  terminalId: string,
): SshTerminalHostInfo {
  const meta = useSshTerminalMeta(terminalId);
  const { hosts } = useSshHosts(meta ? serverId : null);

  const hostOs = useMemo(() => {
    if (!meta) {
      return null;
    }
    const host = hosts.find((entry) => entry.id === meta.hostId);
    return trimOs(host?.platform?.os);
  }, [hosts, meta]);

  const cachedOs = trimOs(meta?.os);
  const os = hostOs ?? cachedOs;

  // Backfill meta when the hosts query has a fresher OS after connect/detect.
  useEffect(() => {
    if (!meta || !hostOs || hostOs === meta.os) {
      return;
    }
    patchSshTerminalMeta(terminalId, { os: hostOs });
  }, [hostOs, meta, terminalId]);

  if (!meta) {
    return { isSsh: false, os: null };
  }
  return { isSsh: true, os };
}
