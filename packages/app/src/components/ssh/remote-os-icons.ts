import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  adjustBrandColorForBadge,
  type OsIconGlyph,
  toSimpleIconsSlug,
} from "@/components/ssh/os-icons";

// On-demand Simple Icons (https://simpleicons.org) for OS IDs that are not in
// the offline catalog. CDN returns a single-path SVG with brand fill:
//   https://cdn.simpleicons.org/{slug}
// 404 means the brand is not in Simple Icons — we cache the miss and fall back.

const CDN_BASE = "https://cdn.simpleicons.org";
const STORAGE_KEY = "paseo.os-icons.v1";
const CACHE_VERSION = 1;

type CacheEntry =
  | { kind: "glyph"; path: string; color: string; label: string }
  | { kind: "missing" };

interface PersistedCache {
  version: number;
  entries: Record<string, CacheEntry>;
}

// In-memory: undefined = not loaded; null entry object with kind missing = 404.
const memory = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<OsIconGlyph | null>>();
let storageHydrated: Promise<void> | null = null;

function hydrateFromStorage(): Promise<void> {
  if (storageHydrated) {
    return storageHydrated;
  }
  storageHydrated = (async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as PersistedCache;
      if (parsed.version !== CACHE_VERSION || !parsed.entries) {
        return;
      }
      for (const [slug, entry] of Object.entries(parsed.entries)) {
        if (!memory.has(slug)) {
          memory.set(slug, entry);
        }
      }
    } catch {
      // Corrupted or unavailable storage — ignore and fetch fresh.
    }
  })();
  return storageHydrated;
}

async function persistEntry(slug: string, entry: CacheEntry): Promise<void> {
  memory.set(slug, entry);
  try {
    await hydrateFromStorage();
    const entries: Record<string, CacheEntry> = {};
    for (const [key, value] of memory.entries()) {
      entries[key] = value;
    }
    // Cap growth — keep most-recent ~80 slugs by overwriting full map from memory.
    const keys = Object.keys(entries);
    if (keys.length > 80) {
      for (const key of keys.slice(0, keys.length - 80)) {
        delete entries[key];
        memory.delete(key);
      }
    }
    const payload: PersistedCache = { version: CACHE_VERSION, entries };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Persistence is best-effort; memory cache still works for the session.
  }
}

export function parseSimpleIconsSvg(svg: string, slug: string): OsIconGlyph | null {
  // CDN shape: <svg fill="#HEX" ...><title>Name</title><path d="..."/></svg>
  const fillMatch = /fill="(#[0-9A-Fa-f]{3,8})"/i.exec(svg);
  const pathMatch = /<path\s+d="([^"]+)"/i.exec(svg);
  const titleMatch = /<title>([^<]+)<\/title>/i.exec(svg);
  if (!pathMatch?.[1]) {
    return null;
  }
  const brand = fillMatch?.[1] ?? "#6B7280";
  return {
    path: pathMatch[1],
    color: adjustBrandColorForBadge(brand),
    label: titleMatch?.[1]?.trim() || slug,
  };
}

function entryToGlyph(entry: CacheEntry): OsIconGlyph | null {
  if (entry.kind === "missing") {
    return null;
  }
  return { path: entry.path, color: entry.color, label: entry.label };
}

// Sync peek: undefined = unknown, null = confirmed missing, glyph = hit.
export function peekRemoteOsIcon(slug: string): OsIconGlyph | null | undefined {
  const entry = memory.get(slug);
  if (entry === undefined) {
    return undefined;
  }
  return entryToGlyph(entry);
}

export async function loadRemoteOsIcon(osOrSlug: string): Promise<OsIconGlyph | null> {
  const slug = toSimpleIconsSlug(osOrSlug);
  if (!slug) {
    return null;
  }

  await hydrateFromStorage();

  const cached = memory.get(slug);
  if (cached !== undefined) {
    return entryToGlyph(cached);
  }

  const existing = inflight.get(slug);
  if (existing) {
    return existing;
  }

  const promise = (async (): Promise<OsIconGlyph | null> => {
    try {
      const response = await fetch(`${CDN_BASE}/${encodeURIComponent(slug)}`, {
        method: "GET",
        headers: { Accept: "image/svg+xml,text/plain,*/*" },
      });
      if (response.status === 404) {
        await persistEntry(slug, { kind: "missing" });
        return null;
      }
      if (!response.ok) {
        // Transient failure — do not cache as missing so a later retry can succeed.
        return null;
      }
      const svg = await response.text();
      const glyph = parseSimpleIconsSvg(svg, slug);
      if (!glyph) {
        await persistEntry(slug, { kind: "missing" });
        return null;
      }
      await persistEntry(slug, {
        kind: "glyph",
        path: glyph.path,
        color: glyph.color,
        label: glyph.label,
      });
      return glyph;
    } catch {
      return null;
    } finally {
      inflight.delete(slug);
    }
  })();

  inflight.set(slug, promise);
  return promise;
}

// Test helpers
export function __resetRemoteOsIconCacheForTests(): void {
  memory.clear();
  inflight.clear();
  storageHydrated = null;
}

export function __seedRemoteOsIconCacheForTests(slug: string, entry: CacheEntry): void {
  memory.set(slug, entry);
}
