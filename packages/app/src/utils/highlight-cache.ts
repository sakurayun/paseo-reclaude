import { highlightCode, type HighlightToken } from "@getpaseo/highlight";

interface HighlightProfileSample {
  codeChars: number;
  durationMs: number;
  cacheHit: boolean;
  lines: number;
  tokens: number;
}

declare global {
  var __PASEO_HIGHLIGHT_PROFILE__: HighlightProfileSample[] | undefined;
}

function recordHighlightProfile(input: {
  codeChars: number;
  startedAt: number;
  cacheHit: boolean;
  lines: HighlightToken[][];
}): void {
  const profile = globalThis.__PASEO_HIGHLIGHT_PROFILE__;
  if (!profile) {
    return;
  }
  profile.push({
    codeChars: input.codeChars,
    durationMs: performance.now() - input.startedAt,
    cacheHit: input.cacheHit,
    lines: input.lines.length,
    tokens: input.lines.reduce((sum, line) => sum + line.length, 0),
  });
}

// Shared, theme-independent tokenization + cache for syntax highlighting.
// Used by markdown code blocks, file preview, and tool-call detail blocks
// (Edit diff / Write / Read). Colors are applied at render time, so the cache
// key is just (extension, code) and one entry serves both light and dark.

export interface KeyedToken {
  key: string;
  token: HighlightToken;
}

export interface KeyedLine {
  key: string;
  tokens: KeyedToken[];
}

// Syntax tokens become one React/RN Web span each. Beyond this point the token
// tree, layout, and accessibility tree cost much more than tokenization itself.
// Keep the complete selectable/copyable code, but render it as one plain
// monospace text node instead of mounting an unbounded token-span tree.
export const MAX_HIGHLIGHT_CHARS = 16 * 1024;

interface WeightedCacheEntry<V> {
  value: V;
  weight: number;
}

class LRUCache<K, V> {
  private readonly map = new Map<K, WeightedCacheEntry<V>>();
  private totalWeight = 0;
  private evictionCount = 0;

  constructor(
    private readonly maxEntries: number,
    private readonly maxWeight: number,
    private readonly getWeight: (key: K, value: V) => number,
  ) {}

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (entry === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    const previous = this.map.get(key);
    if (previous) {
      this.totalWeight -= previous.weight;
      this.map.delete(key);
    }
    const weight = this.getWeight(key, value);
    this.map.set(key, { value, weight });
    this.totalWeight += weight;

    while (this.map.size > this.maxEntries || this.totalWeight > this.maxWeight) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      const evicted = this.map.get(oldest);
      this.map.delete(oldest);
      this.totalWeight -= evicted?.weight ?? 0;
      this.evictionCount += 1;
    }
  }

  clear(): void {
    this.map.clear();
    this.totalWeight = 0;
    this.evictionCount = 0;
  }

  stats(): HighlightCacheStats {
    return {
      entries: this.map.size,
      estimatedRetainedBytes: this.totalWeight,
      evictions: this.evictionCount,
    };
  }
}

export interface HighlightCacheStats {
  entries: number;
  estimatedRetainedBytes: number;
  evictions: number;
}

const HIGHLIGHT_CACHE_MAX_ENTRIES = 200;
export const HIGHLIGHT_CACHE_MAX_RETAINED_BYTES = 8 * 1024 * 1024;
const CACHE_KEY_CHARACTER_BYTES = 2;
const TOKEN_TEXT_CHARACTER_BYTES = 2;
const ESTIMATED_LINE_OVERHEAD_BYTES = 32;
const ESTIMATED_TOKEN_OVERHEAD_BYTES = 64;

function estimateTokenizationCacheEntryBytes(cacheKey: string, lines: HighlightToken[][]): number {
  let bytes = cacheKey.length * CACHE_KEY_CHARACTER_BYTES;
  for (const line of lines) {
    bytes += ESTIMATED_LINE_OVERHEAD_BYTES;
    for (const token of line) {
      bytes += ESTIMATED_TOKEN_OVERHEAD_BYTES + token.text.length * TOKEN_TEXT_CHARACTER_BYTES;
    }
  }
  return bytes;
}

const tokenizationCache = new LRUCache<string, HighlightToken[][]>(
  HIGHLIGHT_CACHE_MAX_ENTRIES,
  HIGHLIGHT_CACHE_MAX_RETAINED_BYTES,
  estimateTokenizationCacheEntryBytes,
);

export function getHighlightCacheStats(): HighlightCacheStats {
  return tokenizationCache.stats();
}

export function clearHighlightCacheForTests(): void {
  tokenizationCache.clear();
}

// Tokenize `code` to per-line tokens, cached. Returns null when the language is
// unsupported, the input is over the size cap, or parsing throws — callers then
// render plain text.
export function tokenizeToLines(code: string, ext: string | null): HighlightToken[][] | null {
  if (!ext) return null;
  if (code.length > MAX_HIGHLIGHT_CHARS) return null;
  const profile = globalThis.__PASEO_HIGHLIGHT_PROFILE__;
  const startedAt = profile ? performance.now() : 0;
  const cacheKey = `${ext}:${code}`;
  const cached = tokenizationCache.get(cacheKey);
  if (cached) {
    recordHighlightProfile({ codeChars: code.length, startedAt, cacheHit: true, lines: cached });
    return cached;
  }
  let lines: HighlightToken[][];
  try {
    lines = highlightCode(code, `x.${ext}`);
  } catch {
    return null;
  }
  tokenizationCache.set(cacheKey, lines);
  recordHighlightProfile({ codeChars: code.length, startedAt, cacheHit: false, lines });
  return lines;
}

function toKeyedLine(tokens: HighlightToken[], lineIndex: number): KeyedLine {
  return {
    key: `line-${lineIndex}`,
    tokens: tokens.map((token, tokenIndex) => ({
      key: `${lineIndex}-${tokenIndex}`,
      token,
    })),
  };
}

export function highlightToKeyedLines(code: string, ext: string | null): KeyedLine[] | null {
  const lines = tokenizeToLines(code, ext);
  return lines ? lines.map(toKeyedLine) : null;
}

// Extension for grammar selection from a file path. We only need the suffix —
// absolute vs relative paths are equivalent here.
export function extensionFromPath(filePath: string | null | undefined): string | null {
  if (!filePath) return null;
  const name = filePath.split(/[\\/]/).pop() ?? filePath;
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}
