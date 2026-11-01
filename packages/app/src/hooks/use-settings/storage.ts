import { isSyntaxThemeId, type SyntaxThemeId } from "@getpaseo/highlight";
import type { ActiveTurnBehavior } from "@getpaseo/protocol/messages";
import type { QueryClient } from "@tanstack/react-query";
import {
  VALID_TERMINAL_COLOR_SCHEMES,
  type TerminalColorSchemeId,
} from "@/constants/terminal-color-presets";
import type { DesktopSettings } from "@/desktop/settings/desktop-settings";
import type { AppLanguage } from "@/i18n/locales";
import type { SidebarNavPreference } from "@/sidebar-nav/model";
import {
  DEFAULT_USAGE_PREFERENCES,
  UsagePreferencesSchema,
  type UsagePreferences,
} from "@/usage/preferences";
import {
  DEFAULT_SIDEBAR_CHECKS_DISPLAY,
  type SidebarChecksDisplay,
} from "@/components/sidebar/display-preferences/checks-display";
import {
  DEFAULT_SIDEBAR_ROW_ITEMS,
  isChecksHiddenByLegacyRowItem,
  type SidebarRowItems,
} from "@/components/sidebar/display-preferences/row-items";
import { isNative } from "@/constants/platform";
import {
  DEFAULT_CONTENT_MAX_WIDTH,
  FONT_SIZE,
  PLUGIN_THEME_PREFERENCE,
  THEME_OPTIONS,
  THEME_TO_UNISTYLES,
  type ThemePreference,
} from "@/styles/theme";
import { z } from "zod";
import { APP_SETTINGS_KEY, LEGACY_SETTINGS_KEY } from "./keys";
import { migrateAppSettings } from "./migrations";

export { APP_SETTINGS_KEY } from "./keys";
export const APP_SETTINGS_QUERY_KEY = ["app-settings"];

export type SendShortcut = "enter" | "mod-enter";

export type SendBehavior = ActiveTurnBehavior | "queue";
export type ReleaseChannel = "stable" | "beta";
export type ServiceUrlBehavior = "ask" | "in-app" | "external";
export type WorkspaceTitleSource = "title" | "branch";
export type ToolCallDetailLevel = "overview" | "detailed";
/** Minutes between automatic Grok usage syncs from the composer meter. 0 = off. */
export type GrokUsageRefreshIntervalMinutes = 0 | 1 | 5 | 15 | 30;
/** Composer plan-usage ring: fill + center label show used or remaining %. */
export type ProviderUsageMeterPercentageMode = "used" | "remaining";

const VALID_THEMES = new Set<string>([...Object.keys(THEME_TO_UNISTYLES), "auto"]);
export type PullRequestOpenLocation = "main" | "side" | "explorer";
/** What a sidebar workspace row shows in the space to the right of its title. */
export type SidebarWorkspaceTrailing = "diff" | "timestamp" | "none";
/** How much of an agent's work the chat shows between the user's message and the reply. */
export type ChatDisplay = "full" | "collapseToolCalls" | "collapseTurns";

const ThemePreferenceSchema = z.enum([
  ...THEME_OPTIONS.map((option) => option.name),
  PLUGIN_THEME_PREFERENCE,
]);
/** Where the theme picker lands when the persisted preference cannot be honoured. */
export const DEFAULT_THEME_PREFERENCE = "auto" satisfies ThemePreference;
export const DEFAULT_TERMINAL_SCROLLBACK_LINES = 10_000;
export const MIN_TERMINAL_SCROLLBACK_LINES = 0;
export const MAX_TERMINAL_SCROLLBACK_LINES = 1_000_000;
export function defaultUiBaseFontSize(native: boolean): number {
  return native ? 15 : FONT_SIZE.base;
}

export const DEFAULT_UI_BASE_FONT_SIZE = defaultUiBaseFontSize(isNative);
export const MIN_UI_BASE_FONT_SIZE = 10;
export const MAX_UI_BASE_FONT_SIZE = 21;
export function defaultContentFontSize(native: boolean): number {
  return native ? 16 : FONT_SIZE.content;
}

export const DEFAULT_CONTENT_FONT_SIZE = defaultContentFontSize(isNative);
export const MIN_CONTENT_FONT_SIZE = 10;
export const MAX_CONTENT_FONT_SIZE = 21;
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
// The redesigned floating UI is the only look — classic chrome is retired.
// Kept as a constant for defaults / COMPAT reads; load always forces true.
export const DEFAULT_NEW_THEME_ENABLED = true;
export const DEFAULT_GROK_USAGE_REFRESH_INTERVAL_MINUTES: GrokUsageRefreshIntervalMinutes = 5;
export const VALID_GROK_USAGE_REFRESH_INTERVAL_MINUTES = new Set<GrokUsageRefreshIntervalMinutes>([
  0, 1, 5, 15, 30,
]);
export const DEFAULT_PROVIDER_USAGE_METER_PERCENTAGE_MODE: ProviderUsageMeterPercentageMode =
  "used";
export { DEFAULT_CONTENT_MAX_WIDTH };
export const MIN_CONTENT_MAX_WIDTH = 600;
export const MAX_CONTENT_MAX_WIDTH = 4000;

export interface AppSettings {
  theme: ThemePreference;
  /** Which contributed theme `theme: "plugin"` selects. */
  pluginThemeId: string | null;
  language: AppLanguage;
  sendBehavior: SendBehavior;
  serviceUrlBehavior: ServiceUrlBehavior;
  terminalScrollbackLines: number;
  uiFontFamily: string; // "" = platform default UI stack
  monoFontFamily: string; // "" = platform default mono stack
  uiBaseFontSize: number; // clamped px, platform default 14 or 15
  contentFontSize: number; // clamped px, platform default 15 or 16
  codeFontSize: number; // clamped px, default 12
  /** Max width of chat and markdown content in px; null follows the current default. */
  contentMaxWidth: number | null;
  syntaxTheme: SyntaxThemeId; // default "one"
  terminalLigaturesEnabled: boolean; // programming ligatures in terminals + mono code surfaces
  terminalColorScheme: TerminalColorSchemeId; // "auto" follows the app theme, else a named preset
  terminalPaddingTop: number; // clamped px, default 0
  terminalPaddingBottom: number;
  terminalPaddingLeft: number;
  terminalPaddingRight: number;
  terminalLetterSpacing: number; // extra inter-character spacing (px), default 0
  windowsPreferPowerShell7: boolean; // Windows: prefer pwsh7 for default terminals
  windowsLaunchAsAdmin: boolean; // Windows: launch default terminals elevated via gsudo
  workspaceTitleSource: WorkspaceTitleSource;
  // Always true: classic chrome is retired; field kept for storage COMPAT.
  newThemeEnabled: boolean;
  sidebarWorkspaceTrailing: SidebarWorkspaceTrailing;
  sidebarRowItems: SidebarRowItems;
  sidebarChecksDisplay: SidebarChecksDisplay;
  /** Top-level sidebar rows in display order; empty means the default order, all visible. */
  sidebarNavItems: SidebarNavPreference[];
  /** Sidebar footer items in display order; empty means the default order, all visible. */
  sidebarFooterItems: SidebarNavPreference[];
  /** How usage reads and which windows the sidebar summary shows. */
  usage: UsagePreferences;
  autoExpandReasoning: boolean;
  chatDisplay: ChatDisplay;
  chatOutlineEnabled: boolean;
  vimKeybindings: boolean;
  /** How often the composer Grok usage meter auto-syncs (minutes). 0 disables. */
  grokUsageRefreshIntervalMinutes: GrokUsageRefreshIntervalMinutes;
  /** Composer plan-usage ring shows used % or remaining % (arc + center label). */
  providerUsageMeterPercentageMode: ProviderUsageMeterPercentageMode;
  sendShortcut: SendShortcut;
  filePanelAssociations: Record<string, string>;
  /** Desktop-only preferences for implicit opens into the ordinary side pane. */
  openInSidePane: OpenInSidePanePreferences;
  pullRequestOpenLocation: PullRequestOpenLocation;
}

export type AppSettingsUpdate =
  | Partial<AppSettings>
  | ((current: AppSettings) => Partial<AppSettings>);

export interface OpenInSidePanePreferences {
  explorerFiles: boolean;
  diffs: boolean;
  chatFiles: boolean;
  diffFiles: boolean;
  subagents: boolean;
}

export const DEFAULT_OPEN_IN_SIDE_PANE_PREFERENCES: OpenInSidePanePreferences = {
  explorerFiles: false,
  diffs: false,
  chatFiles: false,
  diffFiles: false,
  subagents: false,
};

export interface Settings extends AppSettings {
  manageBuiltInDaemon: boolean;
  releaseChannel: ReleaseChannel;
}

export const DEFAULT_CLIENT_SETTINGS: AppSettings = {
  theme: DEFAULT_THEME_PREFERENCE,
  pluginThemeId: null,
  language: "system",
  sendBehavior: "steer",
  serviceUrlBehavior: "ask",
  terminalScrollbackLines: DEFAULT_TERMINAL_SCROLLBACK_LINES,
  uiFontFamily: "",
  monoFontFamily: "",
  uiBaseFontSize: DEFAULT_UI_BASE_FONT_SIZE,
  contentFontSize: DEFAULT_CONTENT_FONT_SIZE,
  codeFontSize: DEFAULT_CODE_FONT_SIZE,
  contentMaxWidth: null,
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
  sidebarWorkspaceTrailing: "timestamp",
  sidebarRowItems: DEFAULT_SIDEBAR_ROW_ITEMS,
  sidebarChecksDisplay: DEFAULT_SIDEBAR_CHECKS_DISPLAY,
  sidebarNavItems: [],
  sidebarFooterItems: [],
  usage: DEFAULT_USAGE_PREFERENCES,
  autoExpandReasoning: false,
  chatDisplay: "collapseTurns",
  chatOutlineEnabled: true,
  vimKeybindings: false,
  grokUsageRefreshIntervalMinutes: DEFAULT_GROK_USAGE_REFRESH_INTERVAL_MINUTES,
  providerUsageMeterPercentageMode: DEFAULT_PROVIDER_USAGE_METER_PERCENTAGE_MODE,
  sendShortcut: "enter",
  filePanelAssociations: {},
  openInSidePane: DEFAULT_OPEN_IN_SIDE_PANE_PREFERENCES,
  pullRequestOpenLocation: "explorer",
};

export const DEFAULT_APP_SETTINGS: Settings = {
  ...DEFAULT_CLIENT_SETTINGS,
  manageBuiltInDaemon: true,
  releaseChannel: "stable",
};

function clampedNumber(min: number, max: number) {
  return z
    .unknown()
    .transform((value) => parseClampedFontSize(value, { min, max }))
    .pipe(z.number());
}

function sanitizedFontFamily() {
  return z.unknown().transform(sanitizeFontFamily).pipe(z.string());
}

const SidebarRowItemsSchema = z
  .looseObject({
    branch: z.boolean().catch(DEFAULT_SIDEBAR_ROW_ITEMS.branch),
    project: z.boolean().catch(DEFAULT_SIDEBAR_ROW_ITEMS.project),
    host: z.boolean().catch(DEFAULT_SIDEBAR_ROW_ITEMS.host),
    changeRequest: z.boolean().catch(DEFAULT_SIDEBAR_ROW_ITEMS.changeRequest),
    services: z.boolean().optional().catch(undefined),
    labels: z.boolean().catch(DEFAULT_SIDEBAR_ROW_ITEMS.labels),
    // COMPAT(sidebarRowItemsChecks): migrated in v0.3.0, remove after 2027-08-05.
    checks: z.boolean().optional().catch(undefined),
    // COMPAT(sidebarRowItemsScripts): migrated in v0.3.0, remove after 2027-08-05.
    scripts: z.boolean().optional().catch(undefined),
  })
  .catch(DEFAULT_SIDEBAR_ROW_ITEMS);

type StoredAppSettingsFallback = AppSettings & {
  uiFontSize?: number;
  compactToolCalls?: boolean;
  toolCallDetailLevel?: "overview" | "detailed";
  manageBuiltInDaemon?: boolean;
  releaseChannel?: ReleaseChannel;
  needsWrite: boolean;
};

const DEFAULT_STORED_APP_SETTINGS = {
  ...DEFAULT_CLIENT_SETTINGS,
  needsWrite: false,
} satisfies StoredAppSettingsFallback;

const StoredAppSettingsSchema = z
  .looseObject({
    newThemeEnabled: z
      .unknown()
      .optional()
      .transform(() => true),
    terminalLigaturesEnabled: z.boolean().catch(true),
    windowsPreferPowerShell7: z.boolean().catch(true),
    windowsLaunchAsAdmin: z.boolean().catch(true),
    terminalPaddingTop: clampedNumber(0, 64).catch(5),
    terminalPaddingBottom: clampedNumber(0, 64).catch(5),
    terminalPaddingLeft: clampedNumber(0, 64).catch(5),
    terminalPaddingRight: clampedNumber(0, 64).catch(5),
    terminalLetterSpacing: clampedNumber(-5, 10).catch(0),
    terminalColorScheme: z
      .string()
      .refine((v) => VALID_TERMINAL_COLOR_SCHEMES.has(v))
      .catch("auto"),
    grokUsageRefreshIntervalMinutes: z
      .union([z.literal(0), z.literal(1), z.literal(5), z.literal(15), z.literal(30)])
      .catch(5),
    providerUsageMeterPercentageMode: z.enum(["used", "remaining"]).catch("used"),
    theme: ThemePreferenceSchema.catch(DEFAULT_THEME_PREFERENCE),
    pluginThemeId: z.string().nullable().catch(null),
    language: z
      .enum(["system", "ar", "en", "es", "fr", "ja", "ko", "pt-BR", "ru", "zh-CN"])
      .catch("system"),
    sendBehavior: z.enum(["interrupt", "steer", "queue"]).catch("steer"),
    serviceUrlBehavior: z.enum(["ask", "in-app", "external"]).catch("ask"),
    terminalScrollbackLines: clampedNumber(
      MIN_TERMINAL_SCROLLBACK_LINES,
      MAX_TERMINAL_SCROLLBACK_LINES,
    ).catch(DEFAULT_TERMINAL_SCROLLBACK_LINES),
    uiFontFamily: sanitizedFontFamily().catch(""),
    monoFontFamily: sanitizedFontFamily().catch(""),
    uiBaseFontSize: clampedNumber(MIN_UI_BASE_FONT_SIZE, MAX_UI_BASE_FONT_SIZE)
      .optional()
      .catch(undefined),
    contentFontSize: clampedNumber(MIN_CONTENT_FONT_SIZE, MAX_CONTENT_FONT_SIZE)
      .optional()
      .catch(DEFAULT_CONTENT_FONT_SIZE),
    // COMPAT(uiFontSizeScale): replaced by the literal base size in v0.4, remove after 2027-08-17.
    uiFontSize: clampedNumber(11, 24).optional().catch(undefined),
    codeFontSize: clampedNumber(MIN_CODE_FONT_SIZE, MAX_CODE_FONT_SIZE).catch(
      DEFAULT_CODE_FONT_SIZE,
    ),
    contentMaxWidth: z
      .null()
      .or(clampedNumber(MIN_CONTENT_MAX_WIDTH, MAX_CONTENT_MAX_WIDTH))
      .catch(null),
    syntaxTheme: z.string().refine(isSyntaxThemeId).catch("one"),
    workspaceTitleSource: z.enum(["title", "branch"]).catch("title"),
    sidebarWorkspaceTrailing: z.enum(["diff", "timestamp", "none"]).catch("timestamp"),
    sidebarRowItems: SidebarRowItemsSchema,
    sidebarChecksDisplay: z
      .enum(["iconAndText", "icon", "none"])
      .optional()
      .catch(DEFAULT_SIDEBAR_CHECKS_DISPLAY),
    sidebarNavItems: z.array(z.object({ key: z.string(), visible: z.boolean() })).catch([]),
    sidebarFooterItems: z.array(z.object({ key: z.string(), visible: z.boolean() })).catch([]),
    usage: UsagePreferencesSchema,
    autoExpandReasoning: z.boolean().catch(false),
    chatDisplay: z.enum(["full", "collapseToolCalls", "collapseTurns"]).optional().catch("full"),
    // COMPAT(toolCallDetailLevel): replaced by chatDisplay in v0.13, remove after 2027-04-24.
    toolCallDetailLevel: z
      .enum(["overview", "detailed"])
      .or(z.literal("concise").transform(() => "overview" as const))
      .optional()
      .catch(undefined),
    // COMPAT(compactToolCalls): migrated in v0.1.105, remove after 2027-01-12.
    compactToolCalls: z.boolean().optional().catch(undefined),
    chatOutlineEnabled: z.boolean().catch(true),
    vimKeybindings: z.boolean().catch(false),
    sendShortcut: z.enum(["enter", "mod-enter"]).catch("enter"),
    filePanelAssociations: z.record(z.string(), z.string()).catch({}),
    openInSidePane: z
      .object({
        explorerFiles: z.boolean().catch(false),
        diffs: z.boolean().optional(),
        // COMPAT(diffDestinationPreference): legacy split preferences, remove after 2027-02-26.
        explorerChanges: z.boolean().optional(),
        changesLinks: z.boolean().optional(),
        chatFiles: z.boolean().catch(false),
        diffFiles: z.boolean().catch(false),
        subagents: z.boolean().catch(false),
        // COMPAT(pullRequestOpenLocation): legacy side-pane toggle, remove after 2027-02-26.
        pullRequests: z.boolean().optional(),
      })
      .transform(({ explorerChanges, changesLinks, pullRequests, ...preferences }) => ({
        ...preferences,
        diffs: preferences.diffs ?? explorerChanges ?? changesLinks ?? false,
        legacyPullRequestsInSidePane: pullRequests,
      }))
      .catch({
        ...DEFAULT_OPEN_IN_SIDE_PANE_PREFERENCES,
        legacyPullRequestsInSidePane: undefined,
      }),
    pullRequestOpenLocation: z.enum(["main", "side", "explorer"]).optional(),
    // COMPAT(explorerSidebarRouting): replaced by source-specific side-pane preferences in v0.6.
    openSupportingTabsInSidePanel: z.boolean().optional().catch(undefined),
    // COMPAT(rendererDesktopSettings): these fields used to share this renderer-owned key.
    manageBuiltInDaemon: z.boolean().optional().catch(undefined),
    releaseChannel: z.enum(["stable", "beta"]).optional().catch(undefined),
  })
  .transform((stored) => {
    const { legacyPullRequestsInSidePane, ...openInSidePane } = stored.openInSidePane;
    const needsWrite =
      (stored.uiBaseFontSize === undefined && stored.uiFontSize !== undefined) ||
      stored.contentFontSize === undefined;
    const uiBaseFontSize =
      stored.uiBaseFontSize ??
      (stored.uiFontSize === undefined
        ? DEFAULT_UI_BASE_FONT_SIZE
        : Math.round((FONT_SIZE.base * stored.uiFontSize) / 16));
    const sidebarChecksDisplay =
      stored.sidebarChecksDisplay ??
      (isChecksHiddenByLegacyRowItem(stored.sidebarRowItems)
        ? "none"
        : DEFAULT_SIDEBAR_CHECKS_DISPLAY);
    const groupsToolCalls = stored.toolCallDetailLevel
      ? stored.toolCallDetailLevel === "overview"
      : stored.compactToolCalls === true;
    const chatDisplay = stored.chatDisplay ?? (groupsToolCalls ? "collapseToolCalls" : "full");
    return {
      ...stored,
      openInSidePane,
      pullRequestOpenLocation:
        stored.pullRequestOpenLocation ?? (legacyPullRequestsInSidePane ? "side" : "explorer"),
      uiBaseFontSize,
      contentFontSize: stored.contentFontSize ?? uiBaseFontSize,
      sidebarChecksDisplay,
      sidebarRowItems: {
        ...stored.sidebarRowItems,
        services:
          stored.sidebarRowItems.services ??
          (stored.sidebarRowItems.scripts === false ? false : DEFAULT_SIDEBAR_ROW_ITEMS.services),
      },
      chatDisplay,
      needsWrite,
    };
  })
  .catch(DEFAULT_STORED_APP_SETTINGS);

type StoredAppSettings = z.output<typeof StoredAppSettingsSchema>;
export type PersistedAppSettings = Omit<StoredAppSettings, "needsWrite">;

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
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
  updates: AppSettingsUpdate;
  deps: SettingsDeps;
}): Promise<void> {
  const storedCurrent =
    input.queryClient.getQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY) ??
    (await loadAppSettingsFromStorage(input.deps));
  const current = normalizeAppSettings(storedCurrent);
  const updates = typeof input.updates === "function" ? input.updates(current) : input.updates;
  const next = { ...current, ...updates, newThemeEnabled: true };
  input.queryClient.setQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY, next);
  await writeAppSettings(
    input.deps.storage,
    (await readSettingsObject(input.deps.storage, APP_SETTINGS_KEY)) ??
      StoredAppSettingsSchema.parse({}),
    next,
  );
}

export async function loadAppSettingsFromStorage(deps: SettingsDeps): Promise<AppSettings> {
  try {
    const read = await readAppSettings(deps);
    if (read.needsWrite) {
      await writeAppSettings(deps.storage, read.stored, read.settings);
    }
    const { needsWrite: _needsWrite, ...stored } = read.stored;
    return await migrateAppSettings(read.settings, deps.storage, stored, {
      native: isNative,
    });
  } catch (error) {
    console.error("[AppSettings] Failed to load settings:", error);
    throw error;
  }
}

/**
 * Reads whichever of the settings blobs exists, without migrating. `needsWrite` covers the reads
 * that produce settings the stored blob does not already spell out.
 */
async function readAppSettings(deps: SettingsDeps): Promise<{
  settings: AppSettings;
  needsWrite: boolean;
  stored: StoredAppSettings;
}> {
  const stored = await readSettingsObject(deps.storage, APP_SETTINGS_KEY);
  if (stored) {
    return {
      settings: normalizeAppSettings(stored),
      // COMPAT(uiFontSizeScale): persist the converted base size, remove after 2027-08-17.
      needsWrite: stored.needsWrite,
      stored,
    };
  }

  const legacyStored = await readSettingsObject(deps.storage, LEGACY_SETTINGS_KEY);
  if (legacyStored) {
    return {
      settings: {
        ...DEFAULT_CLIENT_SETTINGS,
        ...pickAppSettingsFromLegacy(legacyStored),
      } satisfies AppSettings,
      needsWrite: true,
      stored: legacyStored,
    };
  }

  const defaultStored = StoredAppSettingsSchema.parse({});
  return {
    settings: DEFAULT_CLIENT_SETTINGS,
    needsWrite: true,
    stored: defaultStored,
  };
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

export function normalizeAppSettings(value: unknown): AppSettings {
  const {
    needsWrite: _needsWrite,
    manageBuiltInDaemon: _manageBuiltInDaemon,
    releaseChannel: _releaseChannel,
    compactToolCalls: _compactToolCalls,
    toolCallDetailLevel: _toolCallDetailLevel,
    uiFontSize: _uiFontSize,
    ...settings
  } = StoredAppSettingsSchema.parse(value);
  return {
    ...settings,
    terminalColorScheme: settings.terminalColorScheme as TerminalColorSchemeId,
  };
}

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

function pickAppSettingsFromLegacy(legacy: StoredAppSettings): AppSettings {
  const settings = normalizeAppSettings(legacy);
  return {
    ...settings,
    // The legacy key rendered content on the interface ramp. Freeze that
    // rendered value into the new independent preference during migration.
    contentFontSize: legacy.uiBaseFontSize,
  };
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

export function parseContentMaxWidth(value: unknown): number | null {
  return parseClampedFontSize(value, {
    min: MIN_CONTENT_MAX_WIDTH,
    max: MAX_CONTENT_MAX_WIDTH,
  });
}

export function resolveContentMaxWidth(settings: Pick<AppSettings, "contentMaxWidth">): number {
  return settings.contentMaxWidth ?? DEFAULT_CONTENT_MAX_WIDTH;
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
  // Unistyles serializes theme values into one shared stylesheet. An unfinished
  // string, escape, comment, or block consumes the declarations that follow.
  let quote: string | null = null;
  let escaped = false;
  for (const char of trimmed) {
    if (escaped) {
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (quote !== null) {
      if (char === quote) quote = null;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (/[()[\]/*]/.test(char)) {
      return null;
    }
  }
  return quote === null && !escaped ? trimmed : null;
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

  if (stored.manageBuiltInDaemon !== undefined) {
    result.manageBuiltInDaemon = stored.manageBuiltInDaemon;
  }
  if (stored.releaseChannel !== undefined) {
    result.releaseChannel = stored.releaseChannel;
  }

  return Object.keys(result).length > 0 ? result : null;
}

async function loadRendererSettingsPayload(
  storage: KeyValueStorage,
): Promise<StoredAppSettings | null> {
  const current = await readSettingsObject(storage, APP_SETTINGS_KEY);
  if (current) {
    return current;
  }

  return readSettingsObject(storage, LEGACY_SETTINGS_KEY);
}

async function readSettingsObject(
  storage: KeyValueStorage,
  key: string,
): Promise<StoredAppSettings | null> {
  const raw = await storage.getItem(key);
  if (raw === null) {
    return null;
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    console.warn(`[AppSettings] Removing corrupt ${key}: invalid JSON.`);
    await storage.removeItem(key);
    return null;
  }
  return StoredAppSettingsSchema.parse(decoded);
}

async function writeAppSettings(
  storage: KeyValueStorage,
  stored: StoredAppSettings,
  settings: AppSettings,
): Promise<void> {
  const { needsWrite: _needsWrite, ...persistedStored } = stored;
  const storedSidebarRowItems = persistedStored.sidebarRowItems;
  await storage.setItem(
    APP_SETTINGS_KEY,
    JSON.stringify({
      ...persistedStored,
      ...settings,
      sidebarRowItems: {
        ...storedSidebarRowItems,
        ...settings.sidebarRowItems,
      },
    }),
  );
}
