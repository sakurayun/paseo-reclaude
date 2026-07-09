import { isSyntaxThemeId, type SyntaxThemeId } from "@getpaseo/highlight";
import type { QueryClient } from "@tanstack/react-query";
import {
  VALID_TERMINAL_COLOR_SCHEMES,
  type TerminalColorSchemeId,
} from "@/constants/terminal-color-presets";
import type { DesktopSettings } from "@/desktop/settings/desktop-settings";
import { parseAppLanguage, type AppLanguage } from "@/i18n/locales";
import { THEME_TO_UNISTYLES, type ThemeName } from "@/styles/theme";

export const APP_SETTINGS_KEY = "@paseo:app-settings";
export const APP_SETTINGS_QUERY_KEY = ["app-settings"];
const LEGACY_SETTINGS_KEY = "@paseo:settings";

export type SendBehavior = "interrupt" | "queue";
export type ReleaseChannel = "stable" | "beta";
export type ServiceUrlBehavior = "ask" | "in-app" | "external";
export type WorkspaceTitleSource = "title" | "branch";

const VALID_THEMES = new Set<string>([...Object.keys(THEME_TO_UNISTYLES), "auto"]);
const VALID_SERVICE_URL_BEHAVIORS = new Set<ServiceUrlBehavior>(["ask", "in-app", "external"]);
export const DEFAULT_TERMINAL_SCROLLBACK_LINES = 10_000;
export const MIN_TERMINAL_SCROLLBACK_LINES = 0;
export const MAX_TERMINAL_SCROLLBACK_LINES = 1_000_000;
export const DEFAULT_UI_FONT_SIZE = 16; // == FONT_SIZE.base
export const MIN_UI_FONT_SIZE = 11;
export const MAX_UI_FONT_SIZE = 24;
export const DEFAULT_CODE_FONT_SIZE = 12; // == FONT_SIZE.code
export const MIN_CODE_FONT_SIZE = 9;
export const MAX_CODE_FONT_SIZE = 22; // line-height 1.5×22=33 stays safe
export const MAX_FONT_FAMILY_LENGTH = 200;
// Ligatures were always-on before the setting existed, so the default keeps that behavior.
export const DEFAULT_TERMINAL_LIGATURES_ENABLED = true;
// "auto" follows the app theme's terminal palette — the pre-feature behavior.
export const DEFAULT_TERMINAL_COLOR_SCHEME: TerminalColorSchemeId = "auto";
export const DEFAULT_TERMINAL_PADDING = 5;
export const MIN_TERMINAL_PADDING = 0;
export const MAX_TERMINAL_PADDING = 64;
// Extra inter-character spacing (px) applied to terminal glyphs. 0 keeps the
// font's natural metrics; negative tightens cramped Windows fonts, positive
// loosens. Bounds are small on purpose — large values break grid alignment.
export const DEFAULT_TERMINAL_LETTER_SPACING = 0;
export const MIN_TERMINAL_LETTER_SPACING = -5;
export const MAX_TERMINAL_LETTER_SPACING = 10;
// Windows-only default-shell preferences. Both default on per the product ask:
// prefer PowerShell 7 and launch terminals elevated. They are ignored by the
// daemon on every non-Windows host.
export const DEFAULT_WINDOWS_PREFER_POWERSHELL7 = true;
export const DEFAULT_WINDOWS_LAUNCH_AS_ADMIN = true;
// The standalone "new theme" ships on by default — new and existing installs
// alike start on the redesigned look (the toggle lets a user opt back out).
export const DEFAULT_NEW_THEME_ENABLED = true;

export interface AppSettings {
  theme: ThemeName | "auto";
  language: AppLanguage;
  sendBehavior: SendBehavior;
  serviceUrlBehavior: ServiceUrlBehavior;
  terminalScrollbackLines: number;
  uiFontFamily: string; // "" = platform default UI stack
  monoFontFamily: string; // "" = platform default mono stack
  uiFontSize: number; // clamped px, default 16
  codeFontSize: number; // clamped px, default 12
  syntaxTheme: SyntaxThemeId; // default "one"
  terminalLigaturesEnabled: boolean; // render programming ligatures in the terminal
  terminalColorScheme: TerminalColorSchemeId; // "auto" follows the app theme, else a named preset
  terminalPaddingTop: number; // clamped px, default 0
  terminalPaddingBottom: number;
  terminalPaddingLeft: number;
  terminalPaddingRight: number;
  terminalLetterSpacing: number; // extra inter-character spacing (px), default 0
  windowsPreferPowerShell7: boolean; // Windows: prefer pwsh7 for default terminals
  windowsLaunchAsAdmin: boolean; // Windows: launch default terminals elevated via gsudo
  workspaceTitleSource: WorkspaceTitleSource;
  newThemeEnabled: boolean; // standalone redesigned "new theme", independent of `theme`
  autoExpandReasoning: boolean;
}

export interface Settings extends AppSettings {
  manageBuiltInDaemon: boolean;
  releaseChannel: ReleaseChannel;
}

export const DEFAULT_CLIENT_SETTINGS: AppSettings = {
  theme: "auto",
  language: "system",
  sendBehavior: "interrupt",
  serviceUrlBehavior: "ask",
  terminalScrollbackLines: DEFAULT_TERMINAL_SCROLLBACK_LINES,
  uiFontFamily: "",
  monoFontFamily: "",
  uiFontSize: DEFAULT_UI_FONT_SIZE,
  codeFontSize: DEFAULT_CODE_FONT_SIZE,
  syntaxTheme: "one",
  terminalLigaturesEnabled: DEFAULT_TERMINAL_LIGATURES_ENABLED,
  terminalColorScheme: DEFAULT_TERMINAL_COLOR_SCHEME,
  terminalPaddingTop: DEFAULT_TERMINAL_PADDING,
  terminalPaddingBottom: DEFAULT_TERMINAL_PADDING,
  terminalPaddingLeft: DEFAULT_TERMINAL_PADDING,
  terminalPaddingRight: DEFAULT_TERMINAL_PADDING,
  terminalLetterSpacing: DEFAULT_TERMINAL_LETTER_SPACING,
  windowsPreferPowerShell7: DEFAULT_WINDOWS_PREFER_POWERSHELL7,
  windowsLaunchAsAdmin: DEFAULT_WINDOWS_LAUNCH_AS_ADMIN,
  workspaceTitleSource: "title",
  newThemeEnabled: DEFAULT_NEW_THEME_ENABLED,
  autoExpandReasoning: false,
};

export const DEFAULT_APP_SETTINGS: Settings = {
  ...DEFAULT_CLIENT_SETTINGS,
  manageBuiltInDaemon: true,
  releaseChannel: "stable",
};

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface DesktopSettingsBridge {
  isElectron(): boolean;
  loadDesktopSettings(): Promise<DesktopSettings>;
  migrateLegacyDesktopSettings(input: {
    manageBuiltInDaemon?: boolean;
    releaseChannel?: ReleaseChannel;
  }): Promise<void>;
}

export interface SettingsDeps {
  storage: KeyValueStorage;
  desktop: DesktopSettingsBridge;
}

export async function saveAppSettings(input: {
  queryClient: QueryClient;
  updates: Partial<AppSettings>;
  deps: SettingsDeps;
}): Promise<void> {
  const current =
    input.queryClient.getQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY) ??
    (await loadAppSettingsFromStorage(input.deps));
  const next = { ...current, ...input.updates };
  input.queryClient.setQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY, next);
  await input.deps.storage.setItem(APP_SETTINGS_KEY, JSON.stringify(next));
}

export async function loadAppSettingsFromStorage(deps: SettingsDeps): Promise<AppSettings> {
  try {
    const stored = await deps.storage.getItem(APP_SETTINGS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<AppSettings>;
      return { ...DEFAULT_CLIENT_SETTINGS, ...pickAppSettings(parsed) };
    }

    const legacyStored = await deps.storage.getItem(LEGACY_SETTINGS_KEY);
    if (legacyStored) {
      const legacyParsed = JSON.parse(legacyStored) as Record<string, unknown>;
      const next = {
        ...DEFAULT_CLIENT_SETTINGS,
        ...pickAppSettingsFromLegacy(legacyParsed),
      } satisfies AppSettings;
      await deps.storage.setItem(APP_SETTINGS_KEY, JSON.stringify(next));
      return next;
    }

    await deps.storage.setItem(APP_SETTINGS_KEY, JSON.stringify(DEFAULT_CLIENT_SETTINGS));
    return DEFAULT_CLIENT_SETTINGS;
  } catch (error) {
    console.error("[AppSettings] Failed to load settings:", error);
    throw error;
  }
}

export async function loadSettingsFromStorage(deps: SettingsDeps): Promise<Settings> {
  const legacyDesktopSettings = deps.desktop.isElectron()
    ? await loadLegacyDesktopSettingsFromStorage(deps.storage)
    : null;
  const appSettings = await loadAppSettingsFromStorage(deps);

  if (!deps.desktop.isElectron()) {
    return {
      ...DEFAULT_APP_SETTINGS,
      ...appSettings,
    };
  }

  if (legacyDesktopSettings) {
    await deps.desktop.migrateLegacyDesktopSettings(legacyDesktopSettings);
  }

  const desktopSettings = await deps.desktop.loadDesktopSettings();
  return {
    ...DEFAULT_APP_SETTINGS,
    ...appSettings,
    manageBuiltInDaemon: desktopSettings.daemon.manageBuiltInDaemon,
    releaseChannel: desktopSettings.releaseChannel,
  };
}

// Color scheme + letter spacing + Windows shell toggles, factored out of
// pickAppSettings to keep its cyclomatic complexity under the lint ceiling.
function pickTerminalShellSettings(stored: Partial<AppSettings>): Partial<AppSettings> {
  const result: Partial<AppSettings> = {};
  if (
    typeof stored.terminalColorScheme === "string" &&
    VALID_TERMINAL_COLOR_SCHEMES.has(stored.terminalColorScheme)
  ) {
    result.terminalColorScheme = stored.terminalColorScheme as TerminalColorSchemeId;
  }
  const terminalLetterSpacing = parseTerminalLetterSpacing(stored.terminalLetterSpacing);
  if (terminalLetterSpacing !== null) {
    result.terminalLetterSpacing = terminalLetterSpacing;
  }
  if (typeof stored.windowsPreferPowerShell7 === "boolean") {
    result.windowsPreferPowerShell7 = stored.windowsPreferPowerShell7;
  }
  if (typeof stored.windowsLaunchAsAdmin === "boolean") {
    result.windowsLaunchAsAdmin = stored.windowsLaunchAsAdmin;
  }
  return result;
}

function parseWorkspaceTitleSource(value: unknown): WorkspaceTitleSource | null {
  if (value === "title" || value === "branch") {
    return value;
  }
  return null;
}

// Workspace title source + the device-local new-theme toggle, factored out of
// pickAppSettings to keep its cyclomatic complexity under the lint ceiling.
function pickMiscAppSettings(stored: Partial<AppSettings>): Partial<AppSettings> {
  const result: Partial<AppSettings> = {};
  const workspaceTitleSource = parseWorkspaceTitleSource(stored.workspaceTitleSource);
  if (workspaceTitleSource !== null) {
    result.workspaceTitleSource = workspaceTitleSource;
  }
  // Device-local: deliberately NOT part of extractSyncedAppearance, so toggling
  // the new theme on one device does not propagate to others.
  if (typeof stored.newThemeEnabled === "boolean") {
    result.newThemeEnabled = stored.newThemeEnabled;
  }
  if (typeof stored.autoExpandReasoning === "boolean") {
    result.autoExpandReasoning = stored.autoExpandReasoning;
  }
  return result;
}

function pickAppSettings(stored: Partial<AppSettings>): Partial<AppSettings> {
  const result: Partial<AppSettings> = {};
  if (typeof stored.theme === "string" && VALID_THEMES.has(stored.theme)) {
    result.theme = stored.theme;
  }
  const language =
    parseAppLanguage(stored.language) ?? migrateLegacyLanguageSetting(stored.language);
  if (language !== null) {
    result.language = language;
  }
  if (stored.sendBehavior === "interrupt" || stored.sendBehavior === "queue") {
    result.sendBehavior = stored.sendBehavior;
  }
  if (
    typeof stored.serviceUrlBehavior === "string" &&
    VALID_SERVICE_URL_BEHAVIORS.has(stored.serviceUrlBehavior)
  ) {
    result.serviceUrlBehavior = stored.serviceUrlBehavior;
  }
  const terminalScrollbackLines = parseTerminalScrollbackLines(stored.terminalScrollbackLines);
  if (terminalScrollbackLines !== null) {
    result.terminalScrollbackLines = terminalScrollbackLines;
  }
  const uiFontFamily = sanitizeFontFamily(stored.uiFontFamily);
  if (uiFontFamily !== null) {
    result.uiFontFamily = uiFontFamily;
  }
  const monoFontFamily = sanitizeFontFamily(stored.monoFontFamily);
  if (monoFontFamily !== null) {
    result.monoFontFamily = monoFontFamily;
  }
  const uiFontSize = parseClampedFontSize(stored.uiFontSize, {
    min: MIN_UI_FONT_SIZE,
    max: MAX_UI_FONT_SIZE,
  });
  if (uiFontSize !== null) {
    result.uiFontSize = uiFontSize;
  }
  const codeFontSize = parseClampedFontSize(stored.codeFontSize, {
    min: MIN_CODE_FONT_SIZE,
    max: MAX_CODE_FONT_SIZE,
  });
  if (codeFontSize !== null) {
    result.codeFontSize = codeFontSize;
  }
  if (typeof stored.syntaxTheme === "string" && isSyntaxThemeId(stored.syntaxTheme)) {
    result.syntaxTheme = stored.syntaxTheme;
  }
  if (typeof stored.terminalLigaturesEnabled === "boolean") {
    result.terminalLigaturesEnabled = stored.terminalLigaturesEnabled;
  }
  Object.assign(result, pickTerminalShellSettings(stored));
  const paddingFields = [
    "terminalPaddingTop",
    "terminalPaddingBottom",
    "terminalPaddingLeft",
    "terminalPaddingRight",
  ] as const;
  for (const field of paddingFields) {
    const padding = parseTerminalPadding(stored[field]);
    if (padding !== null) {
      result[field] = padding;
    }
  }
  Object.assign(result, pickMiscAppSettings(stored));
  return result;
}

// The appearance fields synced across a user's devices: app theme + code syntax
// theme + terminal color scheme. Deliberately theme/colors only — font sizes and
// other AppSettings stay device-local (a phone and a desktop want different sizes).
// The return type is left inferred (an anonymous object-literal type) so it stays
// assignable to the opaque `Record<string, unknown>` push payload — a named
// interface would lack the index signature that assignment needs.
export function extractSyncedAppearance(settings: AppSettings) {
  return {
    theme: settings.theme,
    syntaxTheme: settings.syntaxTheme,
    terminalColorScheme: settings.terminalColorScheme,
  };
}

// Validate an opaque synced blob received from a peer into a Partial<AppSettings>,
// reusing the same per-field checks as on-load so a malformed or older peer can't
// inject invalid values. Unknown/missing fields are simply skipped.
export function pickSyncedAppearance(raw: Record<string, unknown>): Partial<AppSettings> {
  const result: Partial<AppSettings> = {};
  if (typeof raw.theme === "string" && VALID_THEMES.has(raw.theme)) {
    result.theme = raw.theme as AppSettings["theme"];
  }
  if (typeof raw.syntaxTheme === "string" && isSyntaxThemeId(raw.syntaxTheme)) {
    result.syntaxTheme = raw.syntaxTheme;
  }
  if (
    typeof raw.terminalColorScheme === "string" &&
    VALID_TERMINAL_COLOR_SCHEMES.has(raw.terminalColorScheme)
  ) {
    result.terminalColorScheme = raw.terminalColorScheme as TerminalColorSchemeId;
  }
  return result;
}

// COMPAT(forkLanguageSetting): the pre-merge fork persisted language as
// "auto" | "en" | "zh" | "ja" | "es". Map those legacy values onto upstream's
// AppLanguage on read so an existing install keeps its language choice.
// "zh" → "zh-CN"; "auto" and anything unsupported (e.g. "ja") → "system".
function migrateLegacyLanguageSetting(value: unknown): AppLanguage | null {
  if (typeof value !== "string") {
    return null;
  }
  if (value === "zh") {
    return "zh-CN";
  }
  return "system";
}

function pickAppSettingsFromLegacy(legacy: Record<string, unknown>): Partial<AppSettings> {
  const result: Partial<AppSettings> = {};
  if (legacy.theme === "dark" || legacy.theme === "light" || legacy.theme === "auto") {
    result.theme = legacy.theme;
  }
  return result;
}

export function parseTerminalScrollbackLines(value: unknown): number | null {
  let numericValue = NaN;
  if (typeof value === "number") {
    numericValue = value;
  } else if (typeof value === "string" && value.trim().length > 0) {
    numericValue = Number(value);
  }
  if (!Number.isFinite(numericValue)) {
    return null;
  }
  return Math.min(
    MAX_TERMINAL_SCROLLBACK_LINES,
    Math.max(MIN_TERMINAL_SCROLLBACK_LINES, Math.floor(numericValue)),
  );
}

export function parseTerminalPadding(value: unknown): number | null {
  return parseClampedFontSize(value, {
    min: MIN_TERMINAL_PADDING,
    max: MAX_TERMINAL_PADDING,
  });
}

// Letter spacing accepts negatives (to tighten cramped fonts), so it can't reuse
// the digits-only padding parser. parseClampedFontSize already floors + clamps
// and tolerates a negative `min`, which is exactly what's needed here.
export function parseTerminalLetterSpacing(value: unknown): number | null {
  return parseClampedFontSize(value, {
    min: MIN_TERMINAL_LETTER_SPACING,
    max: MAX_TERMINAL_LETTER_SPACING,
  });
}

export function parseClampedFontSize(
  value: unknown,
  bounds: { min: number; max: number },
): number | null {
  let numericValue = NaN;
  if (typeof value === "number") {
    numericValue = value;
  } else if (typeof value === "string" && value.trim().length > 0) {
    numericValue = Number(value);
  }
  if (!Number.isFinite(numericValue)) {
    return null;
  }
  return Math.min(bounds.max, Math.max(bounds.min, Math.floor(numericValue)));
}

export function sanitizeFontFamily(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return ""; // explicit empty = default
  }
  if (trimmed.length > MAX_FONT_FAMILY_LENGTH) {
    return null;
  }
  if (/[;{}<>]/.test(trimmed)) {
    return null; // would break the web CSS font-family declaration
  }
  if ([...trimmed].some((char) => char.charCodeAt(0) <= 0x1f)) {
    return null; // control chars would corrupt the font-family string
  }
  return trimmed; // quotes/commas are legit in stacks
}

async function loadLegacyDesktopSettingsFromStorage(storage: KeyValueStorage): Promise<{
  manageBuiltInDaemon?: boolean;
  releaseChannel?: ReleaseChannel;
} | null> {
  const stored = await loadRendererSettingsPayload(storage);
  if (!stored) {
    return null;
  }

  const result: {
    manageBuiltInDaemon?: boolean;
    releaseChannel?: ReleaseChannel;
  } = {};

  if (typeof stored.manageBuiltInDaemon === "boolean") {
    result.manageBuiltInDaemon = stored.manageBuiltInDaemon;
  }
  if (stored.releaseChannel === "stable" || stored.releaseChannel === "beta") {
    result.releaseChannel = stored.releaseChannel;
  }

  return Object.keys(result).length > 0 ? result : null;
}

async function loadRendererSettingsPayload(
  storage: KeyValueStorage,
): Promise<Record<string, unknown> | null> {
  const current = await storage.getItem(APP_SETTINGS_KEY);
  if (current) {
    return JSON.parse(current) as Record<string, unknown>;
  }

  const legacy = await storage.getItem(LEGACY_SETTINGS_KEY);
  if (!legacy) {
    return null;
  }
  return JSON.parse(legacy) as Record<string, unknown>;
}
