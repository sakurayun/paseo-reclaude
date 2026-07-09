import type { Href } from "expo-router";

// The five SSH manager sections, mirroring the sidebar's function entries.
export type SshSection = "hosts" | "keychain" | "forwards" | "knownhosts" | "logs";

export const SSH_SECTIONS: readonly SshSection[] = [
  "hosts",
  "keychain",
  "forwards",
  "knownhosts",
  "logs",
];

export function isSshSection(value: unknown): value is SshSection {
  return (
    value === "hosts" ||
    value === "keychain" ||
    value === "forwards" ||
    value === "knownhosts" ||
    value === "logs"
  );
}

// Builds the /ssh route for a management section. Connecting to a host no
// longer routes through here — it opens a workspace terminal tab directly.
export function buildSshRoute(section: SshSection): Href {
  return `/ssh?section=${section}` as Href;
}
