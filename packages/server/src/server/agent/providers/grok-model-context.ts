import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Grok advertises context windows under several shapes:
 * - ACP model `_meta.totalContextTokens` (camelCase, primary for agent mode)
 * - `~/.grok/models_cache.json` → `models[id].info.context_window`
 * - `~/.grok/config.toml` → `[model."id"].context_window`
 *
 * Paseo previously only accepted `totalContextTokens` as a finite number on
 * `_meta`. Custom models / older Grok builds often omit that field or put the
 * value under a snake_case alias, so the context meter fell back to the wrong
 * window (or no window at all).
 */

/** Built-in defaults for well-known Grok model ids when local files are absent. */
export const GROK_KNOWN_CONTEXT_WINDOWS: Readonly<Record<string, number>> = {
  "grok-4.5": 500_000,
  "grok-4": 256_000,
  "grok-3": 131_072,
  "grok-3-mini": 131_072,
  "grok-code-fast-1": 256_000,
  "grok-build": 256_000,
};

const META_CONTEXT_KEYS = [
  "totalContextTokens",
  "contextWindowTokens",
  "context_window_tokens",
  "contextWindow",
  "context_window",
  "contextWindowMaxTokens",
] as const;

export function asPositiveFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }
  return undefined;
}

export function extractContextWindowFromMeta(
  meta: Record<string, unknown> | null | undefined,
): number | undefined {
  if (!meta) {
    return undefined;
  }
  for (const key of META_CONTEXT_KEYS) {
    const value = asPositiveFiniteNumber(meta[key]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function normalizeModelId(modelId: string | null | undefined): string | null {
  if (typeof modelId !== "string") {
    return null;
  }
  const trimmed = modelId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Minimal TOML reader for `[model."id"]` / `[model.id]` blocks that only
 * extracts `context_window = <number>`. Avoids pulling a full TOML dependency
 * into the daemon for this single field.
 */
export function parseGrokConfigContextWindows(toml: string): Map<string, number> {
  const result = new Map<string, number>();
  let currentModelId: string | null = null;

  for (const rawLine of toml.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) {
      continue;
    }

    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      const section = sectionMatch[1]!.trim();
      // [model."grok-4.5"] or [model.grok-4.5] or [model.'grok-4.5']
      const modelSection = section.match(/^model\.(.+)$/i);
      if (!modelSection) {
        currentModelId = null;
        continue;
      }
      const rawId = modelSection[1]!.trim();
      const unquoted =
        (rawId.startsWith('"') && rawId.endsWith('"')) ||
        (rawId.startsWith("'") && rawId.endsWith("'"))
          ? rawId.slice(1, -1)
          : rawId;
      currentModelId = normalizeModelId(unquoted);
      continue;
    }

    if (!currentModelId) {
      continue;
    }

    const contextMatch = line.match(/^context_window\s*=\s*(.+)$/i);
    if (!contextMatch) {
      continue;
    }
    const value = asPositiveFiniteNumber(contextMatch[1]!.trim().replace(/,$/, ""));
    if (value !== undefined) {
      result.set(currentModelId, value);
    }
  }

  return result;
}

export function parseGrokModelsCacheContextWindows(raw: string): Map<string, number> {
  const result = new Map<string, number>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return result;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return result;
  }
  const models = (parsed as { models?: unknown }).models;
  if (!models || typeof models !== "object" || Array.isArray(models)) {
    return result;
  }
  for (const [modelId, entry] of Object.entries(models as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const info = (entry as { info?: unknown }).info;
    if (!info || typeof info !== "object" || Array.isArray(info)) {
      continue;
    }
    const value = asPositiveFiniteNumber((info as { context_window?: unknown }).context_window);
    if (value !== undefined) {
      const id = normalizeModelId(modelId);
      if (id) {
        result.set(id, value);
      }
    }
  }
  return result;
}

export function resolveGrokHomeDir(homeDir?: string): string {
  return homeDir?.trim() || process.env.GROK_HOME?.trim() || join(homedir(), ".grok");
}

export interface GrokLocalContextWindows {
  /** `~/.grok/config.toml` [model."id"].context_window — user overrides. */
  config: Map<string, number>;
  /** `~/.grok/models_cache.json` official/prefetched catalog. */
  cache: Map<string, number>;
}

export function loadGrokLocalContextWindows(homeDir?: string): GrokLocalContextWindows {
  const root = resolveGrokHomeDir(homeDir);
  const config = new Map<string, number>();
  const cache = new Map<string, number>();

  const cachePath = join(root, "models_cache.json");
  if (existsSync(cachePath)) {
    try {
      for (const [id, value] of parseGrokModelsCacheContextWindows(
        readFileSync(cachePath, "utf8"),
      )) {
        cache.set(id, value);
      }
    } catch {
      // Ignore unreadable cache.
    }
  }

  const configPath = join(root, "config.toml");
  if (existsSync(configPath)) {
    try {
      for (const [id, value] of parseGrokConfigContextWindows(readFileSync(configPath, "utf8"))) {
        config.set(id, value);
      }
    } catch {
      // Ignore unreadable config.
    }
  }

  return { config, cache };
}

let cachedLocalWindows: {
  root: string;
  mtimeKey: string;
  windows: GrokLocalContextWindows;
} | null = null;

function fileMtimeKey(path: string): string {
  try {
    return String(statSync(path).mtimeMs);
  } catch {
    return "missing";
  }
}

/**
 * Cached local catalog. Invalidates when models_cache.json or config.toml change.
 */
export function getGrokLocalContextWindows(homeDir?: string): GrokLocalContextWindows {
  const root = resolveGrokHomeDir(homeDir);
  const mtimeKey = `${fileMtimeKey(join(root, "models_cache.json"))}:${fileMtimeKey(join(root, "config.toml"))}`;
  if (
    cachedLocalWindows &&
    cachedLocalWindows.root === root &&
    cachedLocalWindows.mtimeKey === mtimeKey
  ) {
    return cachedLocalWindows.windows;
  }
  const windows = loadGrokLocalContextWindows(root);
  cachedLocalWindows = { root, mtimeKey, windows };
  return windows;
}

/** Test helper — drop the in-process cache between cases. */
export function clearGrokLocalContextWindowCache(): void {
  cachedLocalWindows = null;
}

export function resolveGrokKnownContextWindow(
  modelId: string | null | undefined,
): number | undefined {
  const id = normalizeModelId(modelId);
  if (!id) {
    return undefined;
  }
  if (GROK_KNOWN_CONTEXT_WINDOWS[id] !== undefined) {
    return GROK_KNOWN_CONTEXT_WINDOWS[id];
  }
  // Prefix match for versioned ids like grok-4.5-something.
  for (const [knownId, value] of Object.entries(GROK_KNOWN_CONTEXT_WINDOWS)) {
    if (id === knownId || id.startsWith(`${knownId}-`) || id.startsWith(`${knownId}_`)) {
      return value;
    }
  }
  return undefined;
}

/**
 * Resolve the context window for a Grok model.
 *
 * Priority:
 * 1. `~/.grok/config.toml` (user override — what Grok itself uses for compact)
 * 2. ACP `_meta` (`totalContextTokens` and aliases)
 * 3. Existing value already on the model definition
 * 4. `~/.grok/models_cache.json` official catalog
 * 5. Built-in known-model defaults
 */
export function resolveGrokContextWindowMaxTokens(input: {
  modelId: string | null | undefined;
  meta?: Record<string, unknown> | null;
  existing?: number | null | undefined;
  localWindows?: GrokLocalContextWindows | null;
  homeDir?: string;
}): number | undefined {
  const id = normalizeModelId(input.modelId);
  const local = input.localWindows ?? getGrokLocalContextWindows(input.homeDir);

  // 1) User config.toml wins — Grok itself uses this for auto-compact / sampling.
  if (id && local.config.has(id)) {
    return local.config.get(id);
  }

  // 2) ACP model `_meta` (totalContextTokens and snake/camel aliases).
  const fromMeta = extractContextWindowFromMeta(input.meta);
  if (fromMeta !== undefined) {
    return fromMeta;
  }

  // 3) Explicit existing value already on the model definition.
  const existing = asPositiveFiniteNumber(input.existing);
  if (existing !== undefined) {
    return existing;
  }

  // 4) Official / prefetched models_cache.json catalog.
  if (id && local.cache.has(id)) {
    return local.cache.get(id);
  }

  // 5) Built-in defaults for known model ids.
  return resolveGrokKnownContextWindow(input.modelId);
}
