// Augments i18next with our resource shape so that `t("ns:key")` keys are validated at
// compile time. This is the primary missing-key guard: a typo in a translation key fails
// `npm run typecheck`. Augmenting the external "i18next" module is collected program-wide,
// so this applies to every useTranslation()/t() call without needing a runtime import.
import type { AppResources } from "./resources";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: AppResources;
  }
}
