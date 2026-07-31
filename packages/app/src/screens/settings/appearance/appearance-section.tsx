import { useCallback, useEffect, useMemo, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Text, TextInput, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronDown, Monitor, Moon, Sun } from "lucide-react-native";
import {
  SYNTAX_THEME_OPTIONS,
  type SyntaxThemeId,
  type SyntaxThemeOption,
} from "@getpaseo/highlight";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { SettingsSection } from "@/screens/settings/settings-section";
import {
  MAX_CODE_FONT_SIZE,
  MAX_UI_FONT_SIZE,
  MIN_CODE_FONT_SIZE,
  MIN_UI_FONT_SIZE,
  parseClampedFontSize,
  parseTerminalLetterSpacing,
  parseTerminalPadding,
  sanitizeFontFamily,
  useAppSettings,
  type AppSettings,
} from "@/hooks/use-settings";
import {
  DEFAULT_MONO_FONT_STACK,
  DEFAULT_UI_FONT_STACK,
  ICON_SIZE,
  THEME_SWATCHES,
  type Theme,
} from "@/styles/theme";
import { isNative } from "@/constants/platform";
import {
  TERMINAL_COLOR_PRESETS,
  TERMINAL_COLOR_SCHEME_IDS,
  type TerminalColorSchemeId,
} from "@/constants/terminal-color-presets";
import { settingsStyles } from "@/styles/settings";
import { AppearancePreview } from "./appearance-preview";
import { LigaturePreview } from "./ligature-preview";

// ---------------------------------------------------------------------------
// Theme-reactive leaf icons (withUnistyles + uniProps color mapping — no
// useUnistyles). Icon sizes read the static ICON_SIZE token; the appearance
// feature does not scale icons.
// ---------------------------------------------------------------------------

const ThemedSun = withUnistyles(Sun);
const ThemedMoon = withUnistyles(Moon);
const ThemedMonitor = withUnistyles(Monitor);
const ThemedChevronDown = withUnistyles(ChevronDown);

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function getThemeLabel(t: TFunction, value: AppSettings["theme"]): string {
  // Brand-name themes: keep the product spelling in every locale.
  if (value === "claudeLight") return "Claude Light";
  if (value === "catppuccinLatte") return "Catppuccin Latte";
  if (value === "catppuccinFrappe") return "Catppuccin Frappé";
  if (value === "catppuccinMacchiato") return "Catppuccin Macchiato";
  if (value === "catppuccinMocha") return "Catppuccin Mocha";
  const labelKeys: Record<
    Exclude<
      AppSettings["theme"],
      | "claudeLight"
      | "catppuccinLatte"
      | "catppuccinFrappe"
      | "catppuccinMacchiato"
      | "catppuccinMocha"
    >,
    string
  > = {
    light: "settings.appearance.theme.options.light",
    dark: "settings.appearance.theme.options.dark",
    zinc: "settings.appearance.theme.options.zinc",
    midnight: "settings.appearance.theme.options.midnight",
    claude: "settings.appearance.theme.options.claude",
    ghostty: "settings.appearance.theme.options.ghostty",
    auto: "settings.appearance.theme.options.auto",
  };
  return t(labelKeys[value]);
}

const PRIMARY_THEMES: readonly AppSettings["theme"][] = ["light", "dark", "auto"];
const VARIANT_THEMES: readonly AppSettings["theme"][] = [
  "claudeLight",
  "catppuccinLatte",
  "zinc",
  "midnight",
  "claude",
  "ghostty",
  "catppuccinFrappe",
  "catppuccinMacchiato",
  "catppuccinMocha",
];

// Platform default stacks can be the bare native tokens ("normal"/"monospace");
// those read as a bug, so show a human label in the placeholder instead.
const BARE_DEFAULT_STACKS: ReadonlySet<string> = new Set(["normal", "monospace"]);

function resolveDefaultStackPlaceholder(t: TFunction, stack: string): string {
  return BARE_DEFAULT_STACKS.has(stack) ? t("settings.appearance.fonts.systemDefault") : stack;
}

// Local size string (digits only) -> preview override number. Empty/invalid
// yields undefined so the preview falls back to the committed theme value.
function sizeDraftToOverride(value: string): number | undefined {
  if (value.length === 0) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function dropdownTriggerStyle({ pressed }: PressableStateCallbackType) {
  return [styles.trigger, pressed ? styles.triggerPressed : null];
}

// ---------------------------------------------------------------------------
// Theme picker
// ---------------------------------------------------------------------------

interface ThemeLeadingProps {
  themeValue: AppSettings["theme"];
}

function ThemeLeading({ themeValue }: ThemeLeadingProps) {
  switch (themeValue) {
    case "light":
      return <ThemedSun size={ICON_SIZE.md} uniProps={mutedColorMapping} />;
    case "dark":
      return <ThemedMoon size={ICON_SIZE.md} uniProps={mutedColorMapping} />;
    case "auto":
      return <ThemedMonitor size={ICON_SIZE.md} uniProps={mutedColorMapping} />;
    default:
      return <ThemeSwatch color={THEME_SWATCHES[themeValue]} />;
  }
}

interface ThemeSwatchProps {
  color: string;
}

function ThemeSwatch({ color }: ThemeSwatchProps) {
  const swatchStyle = useMemo(() => [styles.swatch, { backgroundColor: color }], [color]);
  return <View style={swatchStyle} />;
}

interface ThemeMenuItemProps {
  themeValue: AppSettings["theme"];
  selected: boolean;
  onChange: (theme: AppSettings["theme"]) => void;
}

function ThemeMenuItem({ themeValue, selected, onChange }: ThemeMenuItemProps) {
  const { t } = useTranslation();
  const handleSelect = useCallback(() => {
    onChange(themeValue);
  }, [onChange, themeValue]);
  const leading = useMemo(() => <ThemeLeading themeValue={themeValue} />, [themeValue]);
  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect} leading={leading}>
      {getThemeLabel(t, themeValue)}
    </DropdownMenuItem>
  );
}

interface ThemeRowProps {
  value: AppSettings["theme"];
  onChange: (theme: AppSettings["theme"]) => void;
}

function ThemeRow({ value, onChange }: ThemeRowProps) {
  const { t } = useTranslation();
  const selectedLabel = getThemeLabel(t, value);
  return (
    <View style={settingsStyles.row}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{t("settings.appearance.theme.title")}</Text>
      </View>
      <DropdownMenu>
        <DropdownMenuTrigger
          style={dropdownTriggerStyle}
          accessibilityLabel={t("settings.appearance.theme.accessibilityLabel", {
            value: selectedLabel,
          })}
        >
          <ThemeLeading themeValue={value} />
          <Text style={styles.triggerText}>{selectedLabel}</Text>
          <ThemedChevronDown size={ICON_SIZE.sm} uniProps={mutedColorMapping} />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="end" width={200}>
          {PRIMARY_THEMES.map((themeValue) => (
            <ThemeMenuItem
              key={themeValue}
              themeValue={themeValue}
              selected={value === themeValue}
              onChange={onChange}
            />
          ))}
          <DropdownMenuSeparator />
          {VARIANT_THEMES.map((themeValue) => (
            <ThemeMenuItem
              key={themeValue}
              themeValue={themeValue}
              selected={value === themeValue}
              onChange={onChange}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

interface AutoExpandReasoningRowProps {
  value: boolean;
  onChange: (value: boolean) => void;
}

function AutoExpandReasoningRow({ value, onChange }: AutoExpandReasoningRowProps) {
  const { t } = useTranslation();
  return (
    <View style={settingsStyles.row}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>
          {t("settings.general.autoExpandReasoning.label")}
        </Text>
        <Text style={settingsStyles.rowHint}>
          {t("settings.general.autoExpandReasoning.description")}
        </Text>
      </View>
      <Switch value={value} onValueChange={onChange} />
    </View>
  );
}

const TOOL_CALL_DETAIL_LEVELS: readonly AppSettings["toolCallDetailLevel"][] = [
  "detailed",
  "overview",
];

function getToolCallDetailLevelLabel(
  t: TFunction,
  value: AppSettings["toolCallDetailLevel"],
): string {
  return t(`settings.general.toolCallDetail.options.${value}`);
}

interface ToolCallDetailMenuItemProps {
  value: AppSettings["toolCallDetailLevel"];
  selected: boolean;
  onChange: (value: AppSettings["toolCallDetailLevel"]) => void;
}

function ToolCallDetailMenuItem({ value, selected, onChange }: ToolCallDetailMenuItemProps) {
  const { t } = useTranslation();
  const handleSelect = useCallback(() => onChange(value), [onChange, value]);
  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect}>
      {getToolCallDetailLevelLabel(t, value)}
    </DropdownMenuItem>
  );
}

interface ToolCallDetailRowProps {
  value: AppSettings["toolCallDetailLevel"];
  onChange: (value: AppSettings["toolCallDetailLevel"]) => void;
}

function ToolCallDetailRow({ value, onChange }: ToolCallDetailRowProps) {
  const { t } = useTranslation();
  const selectedLabel = getToolCallDetailLevelLabel(t, value);
  return (
    <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{t("settings.general.toolCallDetail.label")}</Text>
        <Text style={settingsStyles.rowHint}>
          {t("settings.general.toolCallDetail.description")}
        </Text>
      </View>
      <DropdownMenu>
        <DropdownMenuTrigger
          style={dropdownTriggerStyle}
          accessibilityLabel={t("settings.general.toolCallDetail.accessibilityLabel", {
            value: selectedLabel,
          })}
        >
          <Text style={styles.triggerText}>{selectedLabel}</Text>
          <ThemedChevronDown size={ICON_SIZE.sm} uniProps={mutedColorMapping} />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="end" width={200}>
          {TOOL_CALL_DETAIL_LEVELS.map((option) => (
            <ToolCallDetailMenuItem
              key={option}
              value={option}
              selected={value === option}
              onChange={onChange}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Fonts: family text fields + numeric size fields (commit on blur/submit)
// ---------------------------------------------------------------------------

interface FontFamilyRowProps {
  title: string;
  hint: string;
  accessibilityLabel: string;
  placeholder: string;
  value: string;
  draft: string;
  onChangeDraft: (value: string) => void;
  onCommit: (value: string) => void;
}

function FontFamilyRow({
  title,
  hint,
  accessibilityLabel,
  placeholder,
  value,
  draft,
  onChangeDraft,
  onCommit,
}: FontFamilyRowProps) {
  const handleCommit = useCallback(() => {
    onCommit(draft);
  }, [draft, onCommit]);

  // Resync from the committed value when it changes elsewhere.
  useEffect(() => {
    onChangeDraft(value);
    // Only resync on external value changes, not on local keystrokes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <View style={settingsStyles.row}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
        <Text style={settingsStyles.rowHint}>{hint}</Text>
      </View>
      <TextInput
        value={draft}
        onChangeText={onChangeDraft}
        onBlur={handleCommit}
        onSubmitEditing={handleCommit}
        placeholder={placeholder}
        placeholderTextColor={styles.placeholderColor.color}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        style={styles.fontFamilyInput}
        accessibilityLabel={accessibilityLabel}
      />
    </View>
  );
}

interface FontSizeRowProps {
  title: string;
  accessibilityLabel: string;
  draft: string;
  onChangeDraft: (value: string) => void;
  onCommit: () => void;
}

function FontSizeRow({
  title,
  accessibilityLabel,
  draft,
  onChangeDraft,
  onCommit,
}: FontSizeRowProps) {
  return (
    <View style={settingsStyles.row}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
      </View>
      <View style={styles.sizeField}>
        <TextInput
          value={draft}
          onChangeText={onChangeDraft}
          onBlur={onCommit}
          onSubmitEditing={onCommit}
          keyboardType="number-pad"
          inputMode="numeric"
          selectTextOnFocus
          style={styles.sizeInput}
          accessibilityLabel={accessibilityLabel}
        />
        <Text style={styles.unit}>px</Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Terminal: ligatures toggle + fixed padding around the terminal content
// ---------------------------------------------------------------------------

type TerminalPaddingField =
  | "terminalPaddingTop"
  | "terminalPaddingBottom"
  | "terminalPaddingLeft"
  | "terminalPaddingRight";

interface TerminalPaddingRowProps {
  field: TerminalPaddingField;
  title: string;
  accessibilityLabel: string;
  value: number;
  onCommit: (field: TerminalPaddingField, value: number) => void;
}

function TerminalPaddingRow({
  field,
  title,
  accessibilityLabel,
  value,
  onCommit,
}: TerminalPaddingRowProps) {
  const [draft, setDraft] = useState(String(value));

  // Resync from the committed value when it changes elsewhere.
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const handleChangeDraft = useCallback((next: string) => {
    setDraft(next.replace(/[^\d]/g, ""));
  }, []);

  const handleCommit = useCallback(() => {
    const parsed = parseTerminalPadding(draft);
    const next = parsed ?? value;
    setDraft(String(next));
    if (next !== value) {
      onCommit(field, next);
    }
  }, [draft, field, onCommit, value]);

  return (
    <FontSizeRow
      title={title}
      accessibilityLabel={accessibilityLabel}
      draft={draft}
      onChangeDraft={handleChangeDraft}
      onCommit={handleCommit}
    />
  );
}

// ---------------------------------------------------------------------------
// Terminal letter spacing — unlike padding it accepts negatives, so it needs a
// sign-permitting input rather than the digits-only FontSizeRow sanitizer.
// ---------------------------------------------------------------------------

interface TerminalLetterSpacingRowProps {
  title: string;
  accessibilityLabel: string;
  value: number;
  onCommit: (value: number) => void;
}

function TerminalLetterSpacingRow({
  title,
  accessibilityLabel,
  value,
  onCommit,
}: TerminalLetterSpacingRowProps) {
  const [draft, setDraft] = useState(String(value));

  // Resync from the committed value when it changes elsewhere.
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const handleChangeDraft = useCallback((next: string) => {
    // Keep digits plus a single leading minus sign.
    const cleaned = next.replace(/[^\d-]/g, "").replace(/(?!^)-/g, "");
    setDraft(cleaned);
  }, []);

  const handleCommit = useCallback(() => {
    const parsed = parseTerminalLetterSpacing(draft);
    const next = parsed ?? value;
    setDraft(String(next));
    if (next !== value) {
      onCommit(next);
    }
  }, [draft, onCommit, value]);

  return (
    <View style={settingsStyles.row}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
      </View>
      <View style={styles.sizeField}>
        <TextInput
          value={draft}
          onChangeText={handleChangeDraft}
          onBlur={handleCommit}
          onSubmitEditing={handleCommit}
          keyboardType="numbers-and-punctuation"
          selectTextOnFocus
          style={styles.sizeInput}
          accessibilityLabel={accessibilityLabel}
        />
        <Text style={styles.unit}>px</Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Syntax highlight theme picker (commits immediately)
// ---------------------------------------------------------------------------

function syntaxLabelForId(id: SyntaxThemeId): string {
  const option = SYNTAX_THEME_OPTIONS.find((entry) => entry.id === id);
  return option ? option.label : id;
}

interface SyntaxMenuItemProps {
  option: SyntaxThemeOption;
  selected: boolean;
  onChange: (id: SyntaxThemeId) => void;
}

function SyntaxMenuItem({ option, selected, onChange }: SyntaxMenuItemProps) {
  const handleSelect = useCallback(() => {
    onChange(option.id);
  }, [onChange, option.id]);
  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect}>
      {option.label}
    </DropdownMenuItem>
  );
}

interface SyntaxRowProps {
  value: SyntaxThemeId;
  onChange: (id: SyntaxThemeId) => void;
}

function SyntaxRow({ value, onChange }: SyntaxRowProps) {
  const { t } = useTranslation();
  const selectedLabel = syntaxLabelForId(value);
  return (
    <View style={settingsStyles.row}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>
          {t("settings.appearance.syntax.highlightTheme")}
        </Text>
        <Text style={settingsStyles.rowHint}>
          {t("settings.appearance.syntax.highlightThemeHint")}
        </Text>
      </View>
      <DropdownMenu>
        <DropdownMenuTrigger
          style={dropdownTriggerStyle}
          accessibilityLabel={t("settings.appearance.syntax.highlightThemeAccessibility", {
            value: selectedLabel,
          })}
        >
          <Text style={styles.triggerText}>{selectedLabel}</Text>
          <ThemedChevronDown size={ICON_SIZE.sm} uniProps={mutedColorMapping} />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="end" width={200}>
          {SYNTAX_THEME_OPTIONS.map((option) => (
            <SyntaxMenuItem
              key={option.id}
              option={option}
              selected={value === option.id}
              onChange={onChange}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Terminal color scheme picker (commits immediately)
// ---------------------------------------------------------------------------

// Brand-name schemes render verbatim (like "Claude Light"); only the
// theme-relative ("auto") and High Contrast labels are localized.
const TERMINAL_SCHEME_BRAND_LABELS: Partial<Record<TerminalColorSchemeId, string>> = {
  oneDark: "One Dark",
  dracula: "Dracula",
  solarizedDark: "Solarized Dark",
  gruvboxDark: "Gruvbox Dark",
  nord: "Nord",
  monokai: "Monokai",
  catppuccinMocha: "Catppuccin Mocha",
  solarizedLight: "Solarized Light",
  githubLight: "GitHub Light",
};

function getTerminalSchemeLabel(t: TFunction, id: TerminalColorSchemeId): string {
  switch (id) {
    case "auto":
      return t("settings.appearance.terminal.colorScheme.options.auto");
    case "highContrastDark":
      return t("settings.appearance.terminal.colorScheme.options.highContrastDark");
    case "highContrastLight":
      return t("settings.appearance.terminal.colorScheme.options.highContrastLight");
    default:
      return TERMINAL_SCHEME_BRAND_LABELS[id] ?? id;
  }
}

function TerminalSchemeLeading({ scheme }: { scheme: TerminalColorSchemeId }) {
  // "auto" follows the live theme, so show the system/monitor glyph (matching
  // the theme picker) rather than a fixed swatch. Presets preview their bg.
  if (scheme === "auto") {
    return <ThemedMonitor size={ICON_SIZE.md} uniProps={mutedColorMapping} />;
  }
  return <ThemeSwatch color={TERMINAL_COLOR_PRESETS[scheme].background} />;
}

interface TerminalSchemeMenuItemProps {
  scheme: TerminalColorSchemeId;
  selected: boolean;
  onChange: (scheme: TerminalColorSchemeId) => void;
}

function TerminalSchemeMenuItem({ scheme, selected, onChange }: TerminalSchemeMenuItemProps) {
  const { t } = useTranslation();
  const handleSelect = useCallback(() => {
    onChange(scheme);
  }, [onChange, scheme]);
  const leading = useMemo(() => <TerminalSchemeLeading scheme={scheme} />, [scheme]);
  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect} leading={leading}>
      {getTerminalSchemeLabel(t, scheme)}
    </DropdownMenuItem>
  );
}

interface TerminalColorSchemeRowProps {
  value: TerminalColorSchemeId;
  onChange: (scheme: TerminalColorSchemeId) => void;
}

function TerminalColorSchemeRow({ value, onChange }: TerminalColorSchemeRowProps) {
  const { t } = useTranslation();
  const selectedLabel = getTerminalSchemeLabel(t, value);
  return (
    <View style={settingsStyles.row}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>
          {t("settings.appearance.terminal.colorScheme.title")}
        </Text>
        <Text style={settingsStyles.rowHint}>
          {t("settings.appearance.terminal.colorScheme.hint")}
        </Text>
      </View>
      <DropdownMenu>
        <DropdownMenuTrigger
          style={dropdownTriggerStyle}
          accessibilityLabel={t("settings.appearance.terminal.colorScheme.accessibilityLabel", {
            value: selectedLabel,
          })}
        >
          <TerminalSchemeLeading scheme={value} />
          <Text style={styles.triggerText}>{selectedLabel}</Text>
          <ThemedChevronDown size={ICON_SIZE.sm} uniProps={mutedColorMapping} />
        </DropdownMenuTrigger>
        {/* 12 entries — scrollable so the bottom presets stay reachable on short viewports. */}
        <DropdownMenuContent side="bottom" align="end" width={220} scrollable maxHeight={360}>
          {TERMINAL_COLOR_SCHEME_IDS.map((scheme) => (
            <TerminalSchemeMenuItem
              key={scheme}
              scheme={scheme}
              selected={value === scheme}
              onChange={onChange}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function AppearanceSection() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useAppSettings();
  const showFontFamilyRows = !isNative;
  const uiFontPlaceholder = resolveDefaultStackPlaceholder(t, DEFAULT_UI_FONT_STACK);
  const monoFontPlaceholder = resolveDefaultStackPlaceholder(t, DEFAULT_MONO_FONT_STACK);

  const [uiFontDraft, setUiFontDraft] = useState(settings.uiFontFamily);
  const [monoFontDraft, setMonoFontDraft] = useState(settings.monoFontFamily);
  const [uiSizeDraft, setUiSizeDraft] = useState(String(settings.uiFontSize));
  const [codeSizeDraft, setCodeSizeDraft] = useState(String(settings.codeFontSize));

  // Resync numeric drafts when the committed value changes elsewhere.
  useEffect(() => {
    setUiSizeDraft(String(settings.uiFontSize));
  }, [settings.uiFontSize]);
  useEffect(() => {
    setCodeSizeDraft(String(settings.codeFontSize));
  }, [settings.codeFontSize]);

  const handleThemeChange = useCallback(
    (theme: AppSettings["theme"]) => {
      void updateSettings({ theme });
    },
    [updateSettings],
  );

  const handleSyntaxThemeChange = useCallback(
    (syntaxTheme: SyntaxThemeId) => {
      void updateSettings({ syntaxTheme });
    },
    [updateSettings],
  );

  const handleTerminalColorSchemeChange = useCallback(
    (terminalColorScheme: TerminalColorSchemeId) => {
      void updateSettings({ terminalColorScheme });
    },
    [updateSettings],
  );

  const handleAutoExpandReasoningChange = useCallback(
    (autoExpandReasoning: boolean) => {
      void updateSettings({ autoExpandReasoning });
    },
    [updateSettings],
  );

  const handleToolCallDetailLevelChange = useCallback(
    (toolCallDetailLevel: AppSettings["toolCallDetailLevel"]) => {
      void updateSettings({ toolCallDetailLevel });
    },
    [updateSettings],
  );

  const commitUiFontFamily = useCallback(
    (value: string) => {
      const sanitized = sanitizeFontFamily(value);
      if (sanitized === null) {
        setUiFontDraft(settings.uiFontFamily);
        return;
      }
      setUiFontDraft(sanitized);
      if (sanitized !== settings.uiFontFamily) {
        void updateSettings({ uiFontFamily: sanitized });
      }
    },
    [settings.uiFontFamily, updateSettings],
  );

  const commitMonoFontFamily = useCallback(
    (value: string) => {
      const sanitized = sanitizeFontFamily(value);
      if (sanitized === null) {
        setMonoFontDraft(settings.monoFontFamily);
        return;
      }
      setMonoFontDraft(sanitized);
      if (sanitized !== settings.monoFontFamily) {
        void updateSettings({ monoFontFamily: sanitized });
      }
    },
    [settings.monoFontFamily, updateSettings],
  );

  const handleUiSizeChange = useCallback((value: string) => {
    setUiSizeDraft(value.replace(/[^\d]/g, ""));
  }, []);

  const handleCodeSizeChange = useCallback((value: string) => {
    setCodeSizeDraft(value.replace(/[^\d]/g, ""));
  }, []);

  const commitUiSize = useCallback(() => {
    const parsed = parseClampedFontSize(uiSizeDraft, {
      min: MIN_UI_FONT_SIZE,
      max: MAX_UI_FONT_SIZE,
    });
    const next = parsed ?? settings.uiFontSize;
    setUiSizeDraft(String(next));
    if (next !== settings.uiFontSize) {
      void updateSettings({ uiFontSize: next });
    }
  }, [settings.uiFontSize, uiSizeDraft, updateSettings]);

  const handleTerminalLigaturesChange = useCallback(
    (terminalLigaturesEnabled: boolean) => {
      void updateSettings({ terminalLigaturesEnabled });
    },
    [updateSettings],
  );

  const handleTerminalPaddingCommit = useCallback(
    (field: TerminalPaddingField, value: number) => {
      void updateSettings({ [field]: value });
    },
    [updateSettings],
  );

  const handleTerminalLetterSpacingCommit = useCallback(
    (terminalLetterSpacing: number) => {
      void updateSettings({ terminalLetterSpacing });
    },
    [updateSettings],
  );

  const handleWindowsPreferPowerShell7Change = useCallback(
    (windowsPreferPowerShell7: boolean) => {
      void updateSettings({ windowsPreferPowerShell7 });
    },
    [updateSettings],
  );

  const handleWindowsLaunchAsAdminChange = useCallback(
    (windowsLaunchAsAdmin: boolean) => {
      void updateSettings({ windowsLaunchAsAdmin });
    },
    [updateSettings],
  );

  const commitCodeSize = useCallback(() => {
    const parsed = parseClampedFontSize(codeSizeDraft, {
      min: MIN_CODE_FONT_SIZE,
      max: MAX_CODE_FONT_SIZE,
    });
    const next = parsed ?? settings.codeFontSize;
    setCodeSizeDraft(String(next));
    if (next !== settings.codeFontSize) {
      void updateSettings({ codeFontSize: next });
    }
  }, [codeSizeDraft, settings.codeFontSize, updateSettings]);

  // Live-while-typing: the in-progress drafts drive the preview without
  // committing to the global theme. Empty/invalid fields fall back to the
  // theme value inside the preview.
  const previewOverrides = useMemo(
    () => ({
      monoFontFamily: monoFontDraft,
      codeFontSize: sizeDraftToOverride(codeSizeDraft),
    }),
    [codeSizeDraft, monoFontDraft],
  );

  return (
    <View>
      <SettingsSection title={t("settings.appearance.theme.title")}>
        <View style={settingsStyles.card}>
          <ThemeRow value={settings.theme} onChange={handleThemeChange} />
        </View>
      </SettingsSection>
      <SettingsSection title={t("settings.appearance.detailLevel.title")}>
        <View style={settingsStyles.card}>
          <AutoExpandReasoningRow
            value={settings.autoExpandReasoning}
            onChange={handleAutoExpandReasoningChange}
          />
          <ToolCallDetailRow
            value={settings.toolCallDetailLevel}
            onChange={handleToolCallDetailLevelChange}
          />
        </View>
      </SettingsSection>
      <SettingsSection title={t("settings.appearance.fonts.title")}>
        <View style={settingsStyles.card}>
          {showFontFamilyRows ? (
            <FontFamilyRow
              title={t("settings.appearance.fonts.interfaceFont")}
              hint={t("settings.appearance.fonts.interfaceFontHint")}
              accessibilityLabel={t("settings.appearance.fonts.interfaceFontAccessibility")}
              placeholder={uiFontPlaceholder}
              value={settings.uiFontFamily}
              draft={uiFontDraft}
              onChangeDraft={setUiFontDraft}
              onCommit={commitUiFontFamily}
            />
          ) : null}
          <FontSizeRow
            title={t("settings.appearance.fonts.interfaceSize")}
            accessibilityLabel={t("settings.appearance.fonts.interfaceSizeAccessibility")}
            draft={uiSizeDraft}
            onChangeDraft={handleUiSizeChange}
            onCommit={commitUiSize}
          />
          {showFontFamilyRows ? (
            <FontFamilyRow
              title={t("settings.appearance.fonts.codeFont")}
              hint={t("settings.appearance.fonts.codeFontHint")}
              accessibilityLabel={t("settings.appearance.fonts.codeFontAccessibility")}
              placeholder={monoFontPlaceholder}
              value={settings.monoFontFamily}
              draft={monoFontDraft}
              onChangeDraft={setMonoFontDraft}
              onCommit={commitMonoFontFamily}
            />
          ) : null}
          <FontSizeRow
            title={t("settings.appearance.fonts.codeSize")}
            accessibilityLabel={t("settings.appearance.fonts.codeSizeAccessibility")}
            draft={codeSizeDraft}
            onChangeDraft={handleCodeSizeChange}
            onCommit={commitCodeSize}
          />
        </View>
      </SettingsSection>
      <SettingsSection title={t("settings.appearance.terminal.title")}>
        <View style={settingsStyles.card}>
          <TerminalColorSchemeRow
            value={settings.terminalColorScheme}
            onChange={handleTerminalColorSchemeChange}
          />
          <View style={settingsStyles.row}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>
                {t("settings.appearance.terminal.ligatures")}
              </Text>
              <Text style={settingsStyles.rowHint}>
                {t("settings.appearance.terminal.ligaturesHint")}
              </Text>
            </View>
            <Switch
              value={settings.terminalLigaturesEnabled}
              onValueChange={handleTerminalLigaturesChange}
              accessibilityLabel={t("settings.appearance.terminal.ligaturesAccessibility")}
            />
          </View>
          <LigaturePreview
            enabled={settings.terminalLigaturesEnabled}
            terminalColorScheme={settings.terminalColorScheme}
            overrides={previewOverrides}
          />
          <TerminalLetterSpacingRow
            title={t("settings.appearance.terminal.letterSpacing")}
            accessibilityLabel={t("settings.appearance.terminal.letterSpacingAccessibility")}
            value={settings.terminalLetterSpacing}
            onCommit={handleTerminalLetterSpacingCommit}
          />
          <TerminalPaddingRow
            field="terminalPaddingTop"
            title={t("settings.appearance.terminal.paddingTop")}
            accessibilityLabel={t("settings.appearance.terminal.paddingTopAccessibility")}
            value={settings.terminalPaddingTop}
            onCommit={handleTerminalPaddingCommit}
          />
          <TerminalPaddingRow
            field="terminalPaddingBottom"
            title={t("settings.appearance.terminal.paddingBottom")}
            accessibilityLabel={t("settings.appearance.terminal.paddingBottomAccessibility")}
            value={settings.terminalPaddingBottom}
            onCommit={handleTerminalPaddingCommit}
          />
          <TerminalPaddingRow
            field="terminalPaddingLeft"
            title={t("settings.appearance.terminal.paddingLeft")}
            accessibilityLabel={t("settings.appearance.terminal.paddingLeftAccessibility")}
            value={settings.terminalPaddingLeft}
            onCommit={handleTerminalPaddingCommit}
          />
          <TerminalPaddingRow
            field="terminalPaddingRight"
            title={t("settings.appearance.terminal.paddingRight")}
            accessibilityLabel={t("settings.appearance.terminal.paddingRightAccessibility")}
            value={settings.terminalPaddingRight}
            onCommit={handleTerminalPaddingCommit}
          />
        </View>
      </SettingsSection>
      <SettingsSection title={t("settings.appearance.windowsTerminal.title")}>
        <View style={settingsStyles.card}>
          <View style={settingsStyles.row}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowHint}>
                {t("settings.appearance.windowsTerminal.hint")}
              </Text>
            </View>
          </View>
          <View style={settingsStyles.row}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>
                {t("settings.appearance.windowsTerminal.preferPowerShell7")}
              </Text>
              <Text style={settingsStyles.rowHint}>
                {t("settings.appearance.windowsTerminal.preferPowerShell7Hint")}
              </Text>
            </View>
            <Switch
              value={settings.windowsPreferPowerShell7}
              onValueChange={handleWindowsPreferPowerShell7Change}
              accessibilityLabel={t(
                "settings.appearance.windowsTerminal.preferPowerShell7Accessibility",
              )}
            />
          </View>
          <View style={settingsStyles.row}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>
                {t("settings.appearance.windowsTerminal.launchAsAdmin")}
              </Text>
              <Text style={settingsStyles.rowHint}>
                {t("settings.appearance.windowsTerminal.launchAsAdminHint")}
              </Text>
            </View>
            <Switch
              value={settings.windowsLaunchAsAdmin}
              onValueChange={handleWindowsLaunchAsAdminChange}
              accessibilityLabel={t(
                "settings.appearance.windowsTerminal.launchAsAdminAccessibility",
              )}
            />
          </View>
        </View>
      </SettingsSection>
      <SettingsSection title={t("settings.appearance.syntax.title")}>
        <View style={settingsStyles.card}>
          <SyntaxRow value={settings.syntaxTheme} onChange={handleSyntaxThemeChange} />
        </View>
        <View style={styles.preview}>
          <AppearancePreview overrides={previewOverrides} />
        </View>
      </SettingsSection>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  preview: {
    marginTop: theme.spacing[4],
  },
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface0,
  },
  triggerPressed: {
    opacity: 0.85,
  },
  triggerText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  swatch: {
    width: ICON_SIZE.md,
    height: ICON_SIZE.md,
    borderRadius: ICON_SIZE.md / 2,
    // borderless card (new theme)
    ...theme.shadow.sm,
  },
  fontFamilyInput: {
    flexGrow: 1,
    flexShrink: 1,
    maxWidth: 280,
    minHeight: 36,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    textAlign: "left",
  },
  sizeField: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  sizeInput: {
    width: 64,
    minHeight: 36,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    textAlign: "right",
  },
  unit: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  placeholderColor: {
    color: theme.colors.foregroundMuted,
  },
}));
