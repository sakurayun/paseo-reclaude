import { useCallback, useEffect, useMemo, useState } from "react";
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
import { SettingsSection } from "@/screens/settings/settings-section";
import { Switch } from "@/components/ui/switch";
import {
  MAX_CODE_FONT_SIZE,
  MAX_UI_FONT_SIZE,
  MIN_CODE_FONT_SIZE,
  MIN_UI_FONT_SIZE,
  parseClampedFontSize,
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
import { settingsStyles } from "@/styles/settings";
import { AppearancePreview } from "./appearance-preview";

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

type TFunc = ReturnType<typeof useTranslation<"settings">>["t"];

// Translatable theme labels. `auto` reads as "System" for the app theme.
// Proper-noun themes (Zinc, Midnight, Claude, Ghostty) are brand names and stay
// literal — see themeLabel().
const THEME_LABEL_KEYS = {
  light: "appearance.theme.light",
  dark: "appearance.theme.dark",
  auto: "appearance.theme.system",
} as const;

// Stored value -> displayed label. Brand-name themes are returned verbatim; the
// generic light/dark/system options are translated.
function themeLabel(t: TFunc, value: AppSettings["theme"]): string {
  switch (value) {
    case "light":
    case "dark":
    case "auto":
      return t(THEME_LABEL_KEYS[value]);
    case "claudeLight":
      return "Claude Light";
    case "zinc":
      return "Zinc";
    case "midnight":
      return "Midnight";
    case "claude":
      return "Claude";
    case "ghostty":
      return "Ghostty";
  }
}

const PRIMARY_THEMES: readonly AppSettings["theme"][] = ["light", "dark", "auto"];
const VARIANT_THEMES: readonly AppSettings["theme"][] = [
  "claudeLight",
  "zinc",
  "midnight",
  "claude",
  "ghostty",
];

// Platform default stacks can be the bare native tokens ("normal"/"monospace");
// those read as a bug, so show a human label in the placeholder instead.
const BARE_DEFAULT_STACKS: ReadonlySet<string> = new Set(["normal", "monospace"]);

function resolveDefaultStackPlaceholder(t: TFunc, stack: string): string {
  return BARE_DEFAULT_STACKS.has(stack) ? t("appearance.fonts.systemDefault") : stack;
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
  const { t } = useTranslation("settings");
  const handleSelect = useCallback(() => {
    onChange(themeValue);
  }, [onChange, themeValue]);
  const leading = useMemo(() => <ThemeLeading themeValue={themeValue} />, [themeValue]);
  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect} leading={leading}>
      {themeLabel(t, themeValue)}
    </DropdownMenuItem>
  );
}

interface ThemeRowProps {
  value: AppSettings["theme"];
  onChange: (theme: AppSettings["theme"]) => void;
}

function ThemeRow({ value, onChange }: ThemeRowProps) {
  const { t } = useTranslation("settings");
  return (
    <View style={settingsStyles.row}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{t("appearance.theme.title")}</Text>
      </View>
      <DropdownMenu>
        <DropdownMenuTrigger
          style={dropdownTriggerStyle}
          accessibilityLabel={t("appearance.theme.a11y", { value: themeLabel(t, value) })}
        >
          <ThemeLeading themeValue={value} />
          <Text style={styles.triggerText}>{themeLabel(t, value)}</Text>
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
  withBorder: boolean;
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
  withBorder,
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
    <View style={withBorder ? styles.rowWithBorder : settingsStyles.row}>
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
  withBorder?: boolean;
  onChangeDraft: (value: string) => void;
  onCommit: () => void;
}

function FontSizeRow({
  title,
  accessibilityLabel,
  draft,
  withBorder = true,
  onChangeDraft,
  onCommit,
}: FontSizeRowProps) {
  return (
    <View style={withBorder ? styles.rowWithBorder : settingsStyles.row}>
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
  const { t } = useTranslation("settings");
  return (
    <View style={settingsStyles.row}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{t("appearance.syntax.title")}</Text>
        <Text style={settingsStyles.rowHint}>{t("appearance.syntax.hint")}</Text>
      </View>
      <DropdownMenu>
        <DropdownMenuTrigger
          style={dropdownTriggerStyle}
          accessibilityLabel={t("appearance.syntax.a11y", { value: syntaxLabelForId(value) })}
        >
          <Text style={styles.triggerText}>{syntaxLabelForId(value)}</Text>
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
// Page
// ---------------------------------------------------------------------------

export function AppearanceSection() {
  const { t } = useTranslation("settings");
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
      <SettingsSection title={t("appearance.theme.section")}>
        <View style={settingsStyles.card}>
          <ThemeRow value={settings.theme} onChange={handleThemeChange} />
        </View>
      </SettingsSection>
      <SettingsSection title={t("appearance.fonts.section")}>
        <View style={settingsStyles.card}>
          {showFontFamilyRows ? (
            <FontFamilyRow
              title={t("appearance.fonts.uiTitle")}
              hint={t("appearance.fonts.uiHint")}
              accessibilityLabel={t("appearance.fonts.uiA11y")}
              placeholder={uiFontPlaceholder}
              value={settings.uiFontFamily}
              draft={uiFontDraft}
              withBorder={false}
              onChangeDraft={setUiFontDraft}
              onCommit={commitUiFontFamily}
            />
          ) : null}
          <FontSizeRow
            title={t("appearance.fonts.uiSizeTitle")}
            accessibilityLabel={t("appearance.fonts.uiSizeA11y")}
            draft={uiSizeDraft}
            withBorder={showFontFamilyRows}
            onChangeDraft={handleUiSizeChange}
            onCommit={commitUiSize}
          />
          {showFontFamilyRows ? (
            <FontFamilyRow
              title={t("appearance.fonts.codeTitle")}
              hint={t("appearance.fonts.codeHint")}
              accessibilityLabel={t("appearance.fonts.codeA11y")}
              placeholder={monoFontPlaceholder}
              value={settings.monoFontFamily}
              draft={monoFontDraft}
              withBorder
              onChangeDraft={setMonoFontDraft}
              onCommit={commitMonoFontFamily}
            />
          ) : null}
          <FontSizeRow
            title={t("appearance.fonts.codeSizeTitle")}
            accessibilityLabel={t("appearance.fonts.codeSizeA11y")}
            draft={codeSizeDraft}
            onChangeDraft={handleCodeSizeChange}
            onCommit={commitCodeSize}
          />
        </View>
      </SettingsSection>
      <SettingsSection title={t("appearance.terminal.section")}>
        <View style={settingsStyles.card}>
          <View style={settingsStyles.row}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>
                {t("appearance.terminal.ligatures.title")}
              </Text>
              <Text style={settingsStyles.rowHint}>{t("appearance.terminal.ligatures.hint")}</Text>
            </View>
            <Switch
              value={settings.terminalLigaturesEnabled}
              onValueChange={handleTerminalLigaturesChange}
              accessibilityLabel={t("appearance.terminal.ligatures.a11y")}
            />
          </View>
          <TerminalPaddingRow
            field="terminalPaddingTop"
            title={t("appearance.terminal.padding.top")}
            accessibilityLabel={t("appearance.terminal.padding.topA11y")}
            value={settings.terminalPaddingTop}
            onCommit={handleTerminalPaddingCommit}
          />
          <TerminalPaddingRow
            field="terminalPaddingBottom"
            title={t("appearance.terminal.padding.bottom")}
            accessibilityLabel={t("appearance.terminal.padding.bottomA11y")}
            value={settings.terminalPaddingBottom}
            onCommit={handleTerminalPaddingCommit}
          />
          <TerminalPaddingRow
            field="terminalPaddingLeft"
            title={t("appearance.terminal.padding.left")}
            accessibilityLabel={t("appearance.terminal.padding.leftA11y")}
            value={settings.terminalPaddingLeft}
            onCommit={handleTerminalPaddingCommit}
          />
          <TerminalPaddingRow
            field="terminalPaddingRight"
            title={t("appearance.terminal.padding.right")}
            accessibilityLabel={t("appearance.terminal.padding.rightA11y")}
            value={settings.terminalPaddingRight}
            onCommit={handleTerminalPaddingCommit}
          />
        </View>
      </SettingsSection>
      <SettingsSection title={t("appearance.syntax.section")}>
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
  rowWithBorder: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
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
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  fontFamilyInput: {
    flexGrow: 1,
    flexShrink: 1,
    maxWidth: 280,
    minHeight: 36,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
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
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
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
