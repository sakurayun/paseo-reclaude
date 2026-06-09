// Lightweight language metadata. Kept free of any catalog/i18next imports so that
// settings storage and other low-level modules can validate the `language` setting
// without pulling in the full translation resource graph.

export const SUPPORTED_LANGUAGES = ["en", "zh", "ja", "es"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** A persisted user choice: a concrete language, or "auto" = follow device locale. */
export type LanguageSetting = "auto" | SupportedLanguage;

export const DEFAULT_LANGUAGE: SupportedLanguage = "en";

/**
 * Each language's name written in its own script (endonym). Shown in the language
 * picker so an option is recognizable regardless of the currently active UI language.
 * Intentionally NOT translated.
 */
export const LANGUAGE_ENDONYMS: Record<SupportedLanguage, string> = {
  en: "English",
  zh: "中文",
  ja: "日本語",
  es: "Español",
};

export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return typeof value === "string" && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

export function isLanguageSetting(value: unknown): value is LanguageSetting {
  return value === "auto" || isSupportedLanguage(value);
}
