const TOOL_TOKEN_REGEX = /[a-z0-9]+/g;
const STANDARD_NAMESPACE_SEPARATOR_REGEX = /[.:/]/;

export function normalizeToolName(name: string): string {
  return name.trim().toLowerCase();
}

export function tokenizeToolName(name: string): string[] {
  const normalized = normalizeToolName(name);
  return normalized.match(TOOL_TOKEN_REGEX) ?? [];
}

export function getToolLeafName(name: string): string | null {
  const tokens = tokenizeToolName(name);
  return tokens.length > 0 ? tokens[tokens.length - 1] : null;
}

export function isSpeakToolName(name: string): boolean {
  return getToolLeafName(name) === "speak";
}

export function isLikelyNamespacedToolName(name: string): boolean {
  const normalized = normalizeToolName(name);
  if (STANDARD_NAMESPACE_SEPARATOR_REGEX.test(normalized)) {
    return true;
  }
  if (!normalized.includes("__")) {
    return false;
  }

  // Keep `__` handling strict to avoid false positives on arbitrary custom names.
  const segments = normalized.split("__").filter((segment) => segment.length > 0);
  if (segments.length >= 3) {
    return true;
  }
  if (segments.length === 2 && segments[1].includes("_")) {
    return true;
  }
  return false;
}

export function isPaseoToolName(name: string): boolean {
  const normalized = normalizeToolName(name);
  if (isSpeakToolName(normalized)) {
    return false;
  }
  if (normalized.includes("__")) {
    const segments = normalized.split("__").filter((s) => s.length > 0);
    return (
      segments.length >= 3 &&
      segments[0] === "mcp" &&
      (segments[1] === "paseo" || segments[1].startsWith("paseo_"))
    );
  }
  if (normalized.includes(".")) {
    const firstSegment = normalized.split(".")[0];
    return firstSegment === "paseo" || firstSegment.startsWith("paseo_");
  }
  return false;
}

export function getPaseoToolLeafName(name: string): string | null {
  const normalized = normalizeToolName(name);
  if (normalized.includes("__")) {
    const segments = normalized.split("__").filter((s) => s.length > 0);
    if (
      segments.length >= 3 &&
      segments[0] === "mcp" &&
      (segments[1] === "paseo" || segments[1].startsWith("paseo_"))
    ) {
      return segments.slice(2).join("__");
    }
    return null;
  }
  if (normalized.includes(".")) {
    const firstSegment = normalized.split(".")[0];
    if (firstSegment === "paseo" || firstSegment.startsWith("paseo_")) {
      return normalized.split(".").slice(1).join(".");
    }
    return null;
  }
  return null;
}

export function isLikelyExternalToolName(name: string): boolean {
  const normalized = normalizeToolName(name);
  if (!normalized) {
    return false;
  }
  if (isSpeakToolName(normalized)) {
    return true;
  }
  return isLikelyNamespacedToolName(normalized);
}

export interface McpToolNameParts {
  serverName: string;
  toolName: string;
}

// Parses `mcp__server__tool` style names. Matches the Paseo MCP tools too —
// callers that special-case Paseo must check isPaseoToolName first.
export function parseMcpToolName(name: string): McpToolNameParts | null {
  const segments = name
    .trim()
    .split("__")
    .filter((segment) => segment.length > 0);
  if (segments.length < 3 || segments[0].toLowerCase() !== "mcp") {
    return null;
  }
  return {
    serverName: segments[1],
    toolName: segments.slice(2).join("__"),
  };
}
