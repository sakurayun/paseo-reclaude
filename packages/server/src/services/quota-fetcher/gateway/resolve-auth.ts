import { existsSync, promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

export interface GatewayAuthCredentials {
  baseUrl: string;
  apiKey: string;
  /** Where the credentials were found (for logging / plan labels). */
  source: string;
}

const StringRecordSchema = z.record(z.string(), z.string());

const ClaudeSettingsSchema = z.object({
  env: StringRecordSchema.optional(),
});

const CodexAuthSchema = z.object({
  OPENAI_API_KEY: z.string().optional(),
  // Some installs store nested tokens; ignore for gateway mode.
});

function firstNonEmpty(...values: Array<string | undefined | null>): string | null {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }
  return null;
}

/**
 * Official / first-party hosts that should not be treated as third-party
 * gateways (CPA / Sub2API / NewAPI).
 */
export function isOfficialAiHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "api.anthropic.com" ||
    host.endsWith(".anthropic.com") ||
    host === "api.openai.com" ||
    host.endsWith(".openai.com") ||
    host === "chatgpt.com" ||
    host.endsWith(".chatgpt.com") ||
    host === "platform.claude.com" ||
    host.endsWith(".claude.com")
  );
}

export function normalizeGatewayBaseUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    // Accept bare hosts without scheme for local CPA-style setups.
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    const url = new URL(withScheme);
    if (isOfficialAiHost(url.hostname)) {
      return null;
    }
    // Drop trailing slash only; keep path prefixes (some installs sit under /api).
    url.hash = "";
    url.search = "";
    let href = url.toString();
    if (href.endsWith("/")) href = href.slice(0, -1);
    return href;
  } catch {
    return null;
  }
}

/**
 * NewAPI / one-api quota is often stored as integer "quota points" where
 * 1 USD ≈ 500_000 points. Convert large values to dollars for display.
 */
export function newApiQuotaToUsd(quotaPoints: number): number {
  return quotaPoints / 500_000;
}

async function readJsonFile(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(path, "utf8"));
  } catch {
    return null;
  }
}

function extractTomlString(content: string, key: string): string | null {
  // Matches: key = "value" | key = 'value'
  const re = new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']\\s*$`, "im");
  const match = content.match(re);
  return match?.[1]?.trim() || null;
}

function extractTomlSectionBaseUrl(content: string, sectionName: string): string | null {
  // Match [model_providers.<name>] ... base_url = "..."
  const sectionRe = new RegExp(
    `\\[model_providers\\.${sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]([\\s\\S]*?)(?=\\n\\[|$)`,
    "i",
  );
  const section = content.match(sectionRe)?.[1];
  if (!section) return null;
  return extractTomlString(section, "base_url");
}

async function readCodexConfigBaseUrl(codexHome: string): Promise<string | null> {
  const configPath = join(codexHome, "config.toml");
  if (!existsSync(configPath)) return null;
  try {
    const content = await fs.readFile(configPath, "utf8");
    // Prefer the active model_provider section (e.g. model_provider = "custom"
    // → [model_providers.custom] base_url = "...").
    const activeProvider = extractTomlString(content, "model_provider");
    if (activeProvider) {
      const fromSection = extractTomlSectionBaseUrl(content, activeProvider);
      if (fromSection) return fromSection;
    }
    // Fall back to any base_url in the file (first match).
    return extractTomlString(content, "base_url");
  } catch {
    return null;
  }
}

async function readCodexAuthJson(codexHome: string): Promise<Record<string, unknown> | null> {
  const candidates = [
    join(codexHome, "auth.json"),
    join(homedir(), ".config", "codex", "auth.json"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const raw = await readJsonFile(path);
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      return raw as Record<string, unknown>;
    }
  }
  return null;
}

async function readCodexApiKey(codexHome: string): Promise<string | null> {
  const raw = await readCodexAuthJson(codexHome);
  if (!raw) return null;
  const parsed = CodexAuthSchema.safeParse(raw);
  return parsed.success ? firstNonEmpty(parsed.data.OPENAI_API_KEY) : null;
}

/**
 * True when Codex is authenticated via ChatGPT OAuth (has tokens/session), which is
 * required for `account/rateLimits/read`. API-key-only installs only have
 * `OPENAI_API_KEY` and will error with "ChatGPT authentication required…".
 */
export async function isCodexChatgptAuth(codexHome?: string): Promise<boolean> {
  const home = codexHome || process.env.CODEX_HOME || join(homedir(), ".codex");
  const raw = await readCodexAuthJson(home);
  if (!raw) return false;

  // Common ChatGPT-session shapes observed in auth.json across Codex versions.
  if (typeof raw.tokens === "object" && raw.tokens !== null) return true;
  if (typeof raw.access_token === "string" && raw.access_token.trim()) return true;
  if (typeof raw.refresh_token === "string" && raw.refresh_token.trim()) return true;
  if (typeof raw.id_token === "string" && raw.id_token.trim()) return true;
  if (raw.auth_mode === "chatgpt" || raw.auth_mode === "ChatGPT") return true;
  if (typeof raw.OPENAI_API_KEY === "string" && Object.keys(raw).length === 1) {
    return false;
  }
  // If OPENAI_API_KEY is the only meaningful credential field, treat as api-key mode.
  const keys = Object.keys(raw).filter((k) => raw[k] != null && raw[k] !== "");
  if (keys.length === 1 && keys[0] === "OPENAI_API_KEY") return false;
  // Presence of non-api-key auth fields implies ChatGPT session material.
  return keys.some((k) => k !== "OPENAI_API_KEY");
}

async function readClaudeSettingsEnv(claudeHome: string): Promise<Record<string, string>> {
  const settingsPath = join(claudeHome, "settings.json");
  if (!existsSync(settingsPath)) return {};
  const raw = await readJsonFile(settingsPath);
  const parsed = ClaudeSettingsSchema.safeParse(raw);
  if (!parsed.success || !parsed.data.env) return {};
  return parsed.data.env;
}

/**
 * Resolve Claude Code gateway credentials (custom ANTHROPIC_BASE_URL + API key).
 * Used when native OAuth credentials are absent and reclaude is not active.
 */
export async function resolveClaudeGatewayAuth(options?: {
  claudeHome?: string;
  env?: NodeJS.ProcessEnv;
  providerEnv?: Record<string, string> | null;
}): Promise<GatewayAuthCredentials | null> {
  const env = options?.env ?? process.env;
  const claudeHome =
    options?.claudeHome || env.CLAUDE_HOME || env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  const settingsEnv = await readClaudeSettingsEnv(claudeHome);
  const providerEnv = options?.providerEnv ?? {};

  const baseUrl = firstNonEmpty(
    providerEnv.ANTHROPIC_BASE_URL,
    settingsEnv.ANTHROPIC_BASE_URL,
    env.ANTHROPIC_BASE_URL,
  );
  const apiKey = firstNonEmpty(
    providerEnv.ANTHROPIC_API_KEY,
    providerEnv.ANTHROPIC_AUTH_TOKEN,
    settingsEnv.ANTHROPIC_API_KEY,
    settingsEnv.ANTHROPIC_AUTH_TOKEN,
    env.ANTHROPIC_API_KEY,
    env.ANTHROPIC_AUTH_TOKEN,
  );

  if (!baseUrl || !apiKey) return null;
  const normalized = normalizeGatewayBaseUrl(baseUrl);
  if (!normalized) return null;

  let source = "process-env";
  if (providerEnv.ANTHROPIC_BASE_URL) {
    source = "paseo-provider-env";
  } else if (settingsEnv.ANTHROPIC_BASE_URL) {
    source = "claude-settings";
  }

  return {
    baseUrl: normalized,
    apiKey,
    source,
  };
}

/**
 * Resolve Codex gateway credentials (custom OPENAI_BASE_URL / config base_url + API key).
 * Used when ChatGPT OAuth rate-limits are unavailable (api-key mode).
 */
export async function resolveCodexGatewayAuth(options?: {
  codexHome?: string;
  env?: NodeJS.ProcessEnv;
  providerEnv?: Record<string, string> | null;
}): Promise<GatewayAuthCredentials | null> {
  const env = options?.env ?? process.env;
  const codexHome = options?.codexHome || env.CODEX_HOME || join(homedir(), ".codex");
  const providerEnv = options?.providerEnv ?? {};

  const configBaseUrl = await readCodexConfigBaseUrl(codexHome);
  const authKey = await readCodexApiKey(codexHome);

  const baseUrl = firstNonEmpty(
    providerEnv.OPENAI_BASE_URL,
    env.OPENAI_BASE_URL,
    configBaseUrl ?? undefined,
  );
  const apiKey = firstNonEmpty(
    providerEnv.OPENAI_API_KEY,
    env.OPENAI_API_KEY,
    authKey ?? undefined,
  );

  if (!baseUrl || !apiKey) return null;
  const normalized = normalizeGatewayBaseUrl(baseUrl);
  if (!normalized) return null;

  let source = "codex-auth";
  if (providerEnv.OPENAI_BASE_URL) {
    source = "paseo-provider-env";
  } else if (env.OPENAI_BASE_URL) {
    source = "process-env";
  } else if (configBaseUrl) {
    source = "codex-config";
  }

  return {
    baseUrl: normalized,
    apiKey,
    source,
  };
}
