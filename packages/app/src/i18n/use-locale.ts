import { useTranslation } from "react-i18next";

import i18n from "./index";

/**
 * Active BCP-47 locale for non-React code (formatters in utils). Reads the live i18next
 * instance; callers that must re-render on language change should use useLocale() instead.
 */
export function getActiveLocale(): string {
  return i18n.resolvedLanguage ?? i18n.language ?? "en";
}

/** Active locale for components — re-renders when the language changes. */
export function useLocale(): string {
  const { i18n: instance } = useTranslation();
  return instance.resolvedLanguage ?? instance.language ?? "en";
}
