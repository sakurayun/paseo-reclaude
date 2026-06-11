import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import { isPaseoToolName, parseMcpToolName } from "@getpaseo/protocol/tool-name-normalization";
import { resolveToolCallIconName, type ToolCallIcon } from "./tool-call-icon-name";

// A color pair resolved against the active color scheme — light themes need
// darker tones than dark themes for the same hue to stay readable.
export interface ToolCallSchemeColor {
  light: string;
  dark: string;
}

export function pickToolCallSchemeColor(
  color: ToolCallSchemeColor,
  colorScheme: "light" | "dark",
): string {
  return color[colorScheme];
}

// Built-in tools are colored per category, keyed off the same icon resolution
// used for the badge glyph so name and glyph always agree.
const TOOL_ICON_COLORS: Partial<Record<ToolCallIcon, ToolCallSchemeColor>> = {
  square_terminal: { light: "#b45309", dark: "#fbbf24" },
  eye: { light: "#2563eb", dark: "#60a5fa" },
  pencil: { light: "#ea580c", dark: "#fb923c" },
  search: { light: "#0d9488", dark: "#2dd4bf" },
  bot: { light: "#7c3aed", dark: "#a78bfa" },
  brain: { light: "#9333ea", dark: "#c084fc" },
  mic_vocal: { light: "#0891b2", dark: "#22d3ee" },
  sparkles: { light: "#ca8a04", dark: "#facc15" },
  paseo: { light: "#16a34a", dark: "#4ade80" },
  // wrench (unknown tools) keeps the default muted foreground.
};

// Brand colors for well-known MCP servers, keyed by normalized server name
// (lowercase, non-alphanumerics stripped).
const KNOWN_MCP_SERVER_COLORS: Record<string, ToolCallSchemeColor> = {
  playwright: { light: "#2c8a2f", dark: "#45ba4b" },
  puppeteer: { light: "#02a566", dark: "#00d8a2" },
  github: { light: "#1f2328", dark: "#adbac7" },
  chrome: { light: "#1a73e8", dark: "#8ab4f8" },
  chromedevtools: { light: "#1a73e8", dark: "#8ab4f8" },
  context7: { light: "#6e56cf", dark: "#9b8afb" },
  exa: { light: "#1f40ed", dark: "#7b96ff" },
  serena: { light: "#0d9488", dark: "#2dd4bf" },
  codex: { light: "#10a37f", dark: "#34d399" },
  openai: { light: "#10a37f", dark: "#34d399" },
  figma: { light: "#a259ff", dark: "#c39bff" },
  notion: { light: "#37352f", dark: "#d4d4d0" },
  slack: { light: "#611f69", dark: "#d29ee0" },
  linear: { light: "#5e6ad2", dark: "#9aa3f0" },
  sentry: { light: "#362d59", dark: "#a799d6" },
  supabase: { light: "#15803d", dark: "#3ecf8e" },
  stripe: { light: "#635bff", dark: "#9d97ff" },
  postgres: { light: "#336791", dark: "#7fb0d6" },
  postgresql: { light: "#336791", dark: "#7fb0d6" },
  redis: { light: "#d82c20", dark: "#f37368" },
  docker: { light: "#2496ed", dark: "#6cbcf5" },
  kubernetes: { light: "#326ce5", dark: "#7da6f0" },
  aws: { light: "#b35900", dark: "#ff9900" },
  vercel: { light: "#171717", dark: "#ededed" },
  firecrawl: { light: "#d97706", dark: "#fbbf24" },
  brave: { light: "#fb542b", dark: "#fc7d5e" },
  bravesearch: { light: "#fb542b", dark: "#fc7d5e" },
  jira: { light: "#0052cc", dark: "#579dff" },
  atlassian: { light: "#0052cc", dark: "#579dff" },
  cloudflare: { light: "#c2410c", dark: "#f6821f" },
  perplexity: { light: "#176d81", dark: "#20b8cd" },
  huggingface: { light: "#b45309", dark: "#ffd21e" },
  deepwiki: { light: "#0e7490", dark: "#38bdf8" },
  mcpdeepwiki: { light: "#0e7490", dark: "#38bdf8" },
};

// Unknown servers hash onto a stable palette so each server keeps a
// consistent color across sessions without any registry entry.
const MCP_FALLBACK_COLORS: ToolCallSchemeColor[] = [
  { light: "#2563eb", dark: "#60a5fa" },
  { light: "#0d9488", dark: "#2dd4bf" },
  { light: "#7c3aed", dark: "#a78bfa" },
  { light: "#ea580c", dark: "#fb923c" },
  { light: "#16a34a", dark: "#4ade80" },
  { light: "#db2777", dark: "#f472b6" },
  { light: "#0891b2", dark: "#22d3ee" },
  { light: "#ca8a04", dark: "#facc15" },
  { light: "#dc2626", dark: "#f87171" },
  { light: "#4f46e5", dark: "#818cf8" },
];

function normalizeMcpServerKey(serverName: string): string {
  return serverName.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function resolveMcpServerColor(serverName: string): ToolCallSchemeColor {
  const key = normalizeMcpServerKey(serverName);
  const known = KNOWN_MCP_SERVER_COLORS[key];
  if (known) {
    return known;
  }
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }
  return MCP_FALLBACK_COLORS[hash % MCP_FALLBACK_COLORS.length];
}

export function resolveToolCallColor(
  toolName: string,
  detail?: ToolCallDetail,
): ToolCallSchemeColor | undefined {
  if (!isPaseoToolName(toolName)) {
    const mcp = parseMcpToolName(toolName);
    if (mcp) {
      return resolveMcpServerColor(mcp.serverName);
    }
  }
  return TOOL_ICON_COLORS[resolveToolCallIconName(toolName, detail)];
}
