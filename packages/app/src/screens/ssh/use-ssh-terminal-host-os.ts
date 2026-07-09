import { useSshTerminalMeta } from "@/stores/ssh-terminal-meta-store";
import { useSshHosts } from "@/screens/ssh/use-ssh-hosts";

export interface SshTerminalHostInfo {
  isSsh: boolean;
  // Detected /etc/os-release ID of the remote host (null while undetected or
  // for local terminals).
  os: string | null;
}

// Resolves whether a terminal is an SSH session and which OS its remote host
// runs, so terminal rows/tabs can show the host's brand icon. The hosts query
// only runs while the terminal actually is an SSH one.
export function useSshTerminalHostOs(
  serverId: string | null,
  terminalId: string,
): SshTerminalHostInfo {
  const meta = useSshTerminalMeta(terminalId);
  const { hosts } = useSshHosts(meta ? serverId : null);
  if (!meta) {
    return { isSsh: false, os: null };
  }
  const host = hosts.find((entry) => entry.id === meta.hostId);
  return { isSsh: true, os: host?.platform?.os ?? null };
}
