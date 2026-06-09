import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";

import { resolveDeviceLanguage, resolveLanguageFromSetting } from "./detect-language";
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, type LanguageSetting } from "./languages";
import { defaultNS, NAMESPACES, resources } from "./resources";

// Our own instance (a local var, not the default "i18next" import). initReactI18next still
// registers it as react-i18next's active instance, so useTranslation() resolves it even for
// components rendered outside <I18nextProvider> (e.g. in tests). Typed keys come from the
// module augmentation in ./types, which applies program-wide via tsconfig inclusion.
const i18n = createInstance();

if (!i18n.isInitialized) {
  // initImmediate:false → fully synchronous init (resources are inline, no backend), so
  // `t` works on the very first render and in tests without awaiting.
  void i18n.use(initReactI18next).init({
    resources,
    lng: resolveDeviceLanguage(),
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: [...SUPPORTED_LANGUAGES],
    ns: NAMESPACES as string[],
    defaultNS,
    interpolation: { escapeValue: false },
    returnNull: false,
    initImmediate: false,
  });
}

/**
 * Apply a persisted language setting ("auto" follows the device locale). Called from the
 * settings-apply effect in the provider tree when the user's choice loads or changes.
 */
export async function changeAppLanguage(setting: LanguageSetting): Promise<void> {
  const language = resolveLanguageFromSetting(setting);
  if (i18n.resolvedLanguage !== language) {
    await i18n.changeLanguage(language);
  }
}

export default i18n;
