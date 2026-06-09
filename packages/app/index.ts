// Polyfill crypto.randomUUID for React Native before any other imports
import { polyfillCrypto } from "./src/polyfills/crypto";
polyfillCrypto();

// Polyfill screen.orientation for WebKitGTK desktop runtimes that lack the API.
import { polyfillScreenOrientation } from "./src/polyfills/screen-orientation";
polyfillScreenOrientation();

// Configure Unistyles before Expo Router pulls in any components using StyleSheet.
import "./src/styles/unistyles";

// Initialize i18n before the router mounts so the first render has translations.
// intl-polyfill must come first (i18next's plural resolver relies on Intl.PluralRules).
import "./src/i18n/intl-polyfill";
import "./src/i18n";

import "expo-router/entry";
