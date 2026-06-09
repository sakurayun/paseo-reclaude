import { getLocales } from "expo-localization";

import {
  DEFAULT_LANGUAGE,
  isSupportedLanguage,
  type LanguageSetting,
  type SupportedLanguage,
} from "./languages";

/**
 * Resolve the device's preferred language to one of our supported languages.
 * Walks the ordered device locale list and returns the first supported match,
 * falling back to English. Works across iOS/Android/web/Electron via expo-localization.
 */
export function resolveDeviceLanguage(): SupportedLanguage {
  try {
    for (const locale of getLocales()) {
      const code = locale.languageCode?.toLowerCase();
      if (isSupportedLanguage(code)) {
        return code;
      }
    }
  } catch {
    // expo-localization can be unavailable in non-app runtimes (tests); fall back.
  }
  return DEFAULT_LANGUAGE;
}

/** Map a persisted setting ("auto" or a concrete language) to a concrete language. */
export function resolveLanguageFromSetting(setting: LanguageSetting): SupportedLanguage {
  return setting === "auto" ? resolveDeviceLanguage() : setting;
}
