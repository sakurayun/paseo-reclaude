// Daemon-side synthetic terminal workspace ids that don't correspond to a real
// workspace: standalone:<cwd> grouping buckets, and ssh:<hostId> from SSH
// terminals created before SSH workspace placement existed. Navigation and
// grouping must treat these as "no workspace" and fall back.
export function isSyntheticTerminalWorkspaceId(workspaceId: string): boolean {
  return workspaceId.startsWith("standalone:") || workspaceId.startsWith("ssh:");
}
