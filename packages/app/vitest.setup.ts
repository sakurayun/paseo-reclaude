// @ts-nocheck
import { vi } from "vitest";

const globalWithTestShims = globalThis as typeof globalThis & Record<string, unknown>;

globalWithTestShims.__DEV__ = false;

if (typeof globalThis.self === "undefined") {
  globalWithTestShims.self = globalThis;
}

if (typeof globalThis.expo === "undefined") {
  class ExpoEventEmitter {
    addListener() {
      return {
        remove() {},
      };
    }
    removeListener() {}
    removeAllListeners() {}
    emit() {}
    listenerCount() {
      return 0;
    }
  }

  class ExpoSharedObject extends ExpoEventEmitter {}
  class ExpoSharedRef extends ExpoSharedObject {}
  class ExpoNativeModule extends ExpoEventEmitter {}

  globalWithTestShims.expo = {
    EventEmitter: ExpoEventEmitter,
    SharedObject: ExpoSharedObject,
    SharedRef: ExpoSharedRef,
    NativeModule: ExpoNativeModule,
    modules: {},
  };
}

if (typeof globalThis.requestAnimationFrame !== "function") {
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback) =>
    setTimeout(() => callback(Date.now()), 0) as unknown as number;
}

if (typeof globalThis.cancelAnimationFrame !== "function") {
  globalThis.cancelAnimationFrame = (handle: number) => {
    clearTimeout(handle);
  };
}

// The unistyles test double lives in test-stubs/react-native-unistyles.ts and
// reaches every vitest project through the resolve.alias in vitest.config.ts —
// no vi.mock here, so there is a single copy of the fixture theme.

vi.mock("@xterm/addon-ligatures", () => ({
  LigaturesAddon: class LigaturesAddon {
    dispose(): void {}
  },
}));

// react-native-svg and expo-linking test doubles live in test-stubs/ and reach
// every vitest project through the resolve.alias in vitest.config.ts, same as
// react-native-unistyles and lucide-react-native.

vi.mock("expo-localization", () => ({
  getLocales: () => [{ languageCode: "en", languageTag: "en-US" }],
}));

// Initialize i18n so components using useTranslation() resolve real (English) copy in tests.
await import("./src/i18n/i18next");
