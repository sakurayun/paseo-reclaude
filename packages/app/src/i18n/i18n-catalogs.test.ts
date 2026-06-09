import { describe, expect, it } from "vitest";

import { SUPPORTED_LANGUAGES } from "./languages";
import { NAMESPACES, resources } from "./resources";
import { CANONICAL_TERMS } from "./terminology";

// Locales we commit to keeping fully translated. ja/es are scaffolded stubs that fall back
// to English, so they are exempt from key-parity (only required to be registered).
const FULL_LOCALES = ["en", "zh"] as const;

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function flattenKeys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return prefix ? [prefix.replace(PLURAL_SUFFIX, "")] : [];
  }
  const keys: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    keys.push(...flattenKeys(child, path));
  }
  return keys;
}

function namespaceKeySet(lng: string, ns: string): Set<string> {
  const locale = resources[lng as keyof typeof resources];
  const catalog = locale ? (locale as Record<string, unknown>)[ns] : undefined;
  return new Set(flattenKeys(catalog ?? {}));
}

describe("i18n catalogs", () => {
  it("registers every namespace for every supported language", () => {
    for (const lng of SUPPORTED_LANGUAGES) {
      for (const ns of NAMESPACES) {
        expect(resources[lng], `locale ${lng}`).toHaveProperty(ns);
      }
    }
  });

  it("fully-translated locales mirror every English key (no missing translations)", () => {
    for (const ns of NAMESPACES) {
      const enKeys = namespaceKeySet("en", ns);
      for (const lng of FULL_LOCALES) {
        const missing = [...enKeys].filter((key) => !namespaceKeySet(lng, ns).has(key));
        expect(missing, `${lng}:${ns} missing keys`).toEqual([]);
      }
    }
  });

  it("has no orphan keys (every translated key exists in English)", () => {
    for (const ns of NAMESPACES) {
      const enKeys = namespaceKeySet("en", ns);
      for (const lng of FULL_LOCALES) {
        const orphans = [...namespaceKeySet(lng, ns)].filter((key) => !enKeys.has(key));
        expect(orphans, `${lng}:${ns} orphan keys`).toEqual([]);
      }
    }
  });

  it("defines every canonical glossary term in fully-translated locales", () => {
    for (const lng of FULL_LOCALES) {
      const commonKeys = namespaceKeySet(lng, "common");
      for (const term of CANONICAL_TERMS) {
        expect(commonKeys, `${lng} term`).toContain(`term.${term}`);
      }
    }
  });
});
