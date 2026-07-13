// Remote-path helpers for SFTP uploads. Destination directories are kept in
// their user-entered form ("~", "~/x", or absolute) — the daemon resolves "~"
// at write time, and cd commands rely on the remote shell expanding it.

export function joinRemotePath(destDir: string, relativePath: string): string {
  const base = destDir.trim() || "~";
  if (!relativePath) {
    return base;
  }
  const trimmedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${trimmedBase}/${relativePath}`;
}

export function remoteParentDir(remotePath: string): string {
  const index = remotePath.lastIndexOf("/");
  if (index < 0) {
    return remotePath === "~" ? "~" : ".";
  }
  if (index === 0) {
    return "/";
  }
  return remotePath.slice(0, index);
}

// Single-quotes a POSIX path segment ('' -> '\'' escaping).
function posixQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

// Builds the cd command for the jump-to-directory action. The tilde must stay
// outside the quotes so the remote shell expands it.
export function buildRemoteCdCommand(dir: string, os: string | null | undefined): string {
  const trimmed = dir.trim() || "~";
  if (os === "windows") {
    return trimmed.includes(" ") ? `cd "${trimmed}"\r` : `cd ${trimmed}\r`;
  }
  if (trimmed === "~") {
    return "cd ~\r";
  }
  if (trimmed.startsWith("~/")) {
    return `cd ~/${posixQuote(trimmed.slice(2))}\r`;
  }
  return `cd ${posixQuote(trimmed)}\r`;
}
