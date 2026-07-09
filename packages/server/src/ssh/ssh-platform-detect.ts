import type { SshHostPlatform } from "@getpaseo/protocol/messages";
import type { SshConnection } from "./ssh-connection.js";

// Probes the remote OS over an exec channel. Reads /etc/os-release when
// present (Linux distros), else falls back to `uname -s` (macOS/BSD). Failures
// resolve to a generic "unknown" platform rather than throwing — detection is
// best-effort metadata, never blocks a connection.
export async function detectRemotePlatform(connection: SshConnection): Promise<SshHostPlatform> {
  const detectedAt = Date.now();
  try {
    const result = await connection.exec("cat /etc/os-release 2>/dev/null || uname -s");
    const parsed = parseOsRelease(result.stdout);
    if (parsed) {
      return { ...parsed, detectedAt };
    }
    const uname = result.stdout.trim().toLowerCase();
    if (uname.includes("darwin")) {
      return { os: "darwin", name: "macOS", detectedAt };
    }
    if (uname.length > 0) {
      return { os: "linux", name: result.stdout.trim(), detectedAt };
    }
  } catch {
    // fall through to unknown
  }
  return { os: "unknown", detectedAt };
}

function parseOsRelease(content: string): { os: string; name?: string; version?: string } | null {
  const fields = new Map<string, string>();
  for (const line of content.split("\n")) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match?.[1] && match[2] !== undefined) {
      fields.set(match[1], stripQuotes(match[2]));
    }
  }
  const id = fields.get("ID");
  if (!id) {
    return null;
  }
  const result: { os: string; name?: string; version?: string } = { os: id.toLowerCase() };
  const prettyName = fields.get("PRETTY_NAME") ?? fields.get("NAME");
  if (prettyName) {
    result.name = prettyName;
  }
  const version = fields.get("VERSION_ID") ?? fields.get("VERSION");
  if (version) {
    result.version = version;
  }
  return result;
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
