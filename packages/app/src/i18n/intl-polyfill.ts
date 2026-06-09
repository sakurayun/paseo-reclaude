// Intl polyfills for runtimes with incomplete ICU (notably Android Hermes), so that
// number / relative-time formatting and i18next's plural resolver behave identically on
// iOS, Android, web, and Electron. Must be imported BEFORE ./index (i18next init).
//
// Each `/polyfill` entry is CONDITIONAL — it only installs when the native impl is missing
// (so we never clobber a working native Intl on iOS/web). Each locale-data file is GUARDED
// (no-op unless the matching polyfill is active), so importing them unconditionally is safe.
// Order matters: Intl.Locale first (the others depend on it).
import "@formatjs/intl-locale/polyfill";

import "@formatjs/intl-pluralrules/polyfill";
import "@formatjs/intl-pluralrules/locale-data/en";
import "@formatjs/intl-pluralrules/locale-data/zh";
import "@formatjs/intl-pluralrules/locale-data/ja";
import "@formatjs/intl-pluralrules/locale-data/es";

import "@formatjs/intl-numberformat/polyfill";
import "@formatjs/intl-numberformat/locale-data/en";
import "@formatjs/intl-numberformat/locale-data/zh";
import "@formatjs/intl-numberformat/locale-data/ja";
import "@formatjs/intl-numberformat/locale-data/es";

import "@formatjs/intl-relativetimeformat/polyfill";
import "@formatjs/intl-relativetimeformat/locale-data/en";
import "@formatjs/intl-relativetimeformat/locale-data/zh";
import "@formatjs/intl-relativetimeformat/locale-data/ja";
import "@formatjs/intl-relativetimeformat/locale-data/es";
