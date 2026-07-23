import { useCallback, useMemo, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Monitor, Moon, Sun } from "lucide-react-native";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Shortcut } from "@/components/ui/shortcut";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAppSettings, type AppSettings } from "@/hooks/use-settings";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { ICON_SIZE, THEME_SWATCHES, type Theme } from "@/styles/theme";

const ThemedSun = withUnistyles(Sun);
const ThemedMoon = withUnistyles(Moon);
const ThemedMonitor = withUnistyles(Monitor);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

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

function ThemeLeading({
  themeValue,
  hovered,
}: {
  themeValue: AppSettings["theme"];
  hovered?: boolean;
}) {
  const colorMapping = hovered ? foregroundColorMapping : foregroundMutedColorMapping;
  switch (themeValue) {
    case "light":
      return <ThemedSun size={ICON_SIZE.md} uniProps={colorMapping} />;
    case "dark":
      return <ThemedMoon size={ICON_SIZE.md} uniProps={colorMapping} />;
    case "auto":
      return <ThemedMonitor size={ICON_SIZE.md} uniProps={colorMapping} />;
    default:
      return <ThemeSwatch color={THEME_SWATCHES[themeValue]} />;
  }
}

function ThemeSwatch({ color }: { color: string }) {
  const swatchStyle = useMemo(() => [styles.swatch, { backgroundColor: color }], [color]);
  return <View style={swatchStyle} />;
}

function ThemeMenuItem({
  themeValue,
  selected,
  onChange,
}: {
  themeValue: AppSettings["theme"];
  selected: boolean;
  onChange: (theme: AppSettings["theme"]) => void;
}) {
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

/**
 * Compact theme picker for the left-sidebar footer (bottom-right).
 * Mirrors Settings → Appearance theme options without the full row chrome.
 */
export function SidebarThemeMenu() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useAppSettings();
  const cycleThemeKeys = useShortcutKeys("cycle-theme");
  const [open, setOpen] = useState(false);
  const currentTheme = settings.theme;
  const selectedLabel = getThemeLabel(t, currentTheme);
  const triggerLabel = t("sidebar.actions.theme");

  const handleThemeChange = useCallback(
    (theme: AppSettings["theme"]) => {
      void updateSettings({ theme });
    },
    [updateSettings],
  );

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip delayDuration={300} enabledOnDesktop={!open}>
        <TooltipTrigger asChild>
          <View>
            <DropdownMenuTrigger
              style={styles.trigger}
              testID="sidebar-theme"
              accessibilityRole="button"
              accessibilityLabel={t("settings.appearance.theme.accessibilityLabel", {
                value: selectedLabel,
              })}
            >
              {({ hovered }) => (
                <ThemeLeading themeValue={currentTheme} hovered={Boolean(hovered)} />
              )}
            </DropdownMenuTrigger>
          </View>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" offset={8}>
          <View style={styles.tooltipRow}>
            <Text style={styles.tooltipText}>{triggerLabel}</Text>
            {cycleThemeKeys ? <Shortcut chord={cycleThemeKeys} /> : null}
          </View>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        side="top"
        align="end"
        offset={8}
        width={200}
        scrollable
        maxHeight={360}
        testID="sidebar-theme-menu"
      >
        {PRIMARY_THEMES.map((themeValue) => (
          <ThemeMenuItem
            key={themeValue}
            themeValue={themeValue}
            selected={currentTheme === themeValue}
            onChange={handleThemeChange}
          />
        ))}
        <DropdownMenuSeparator />
        {VARIANT_THEMES.map((themeValue) => (
          <ThemeMenuItem
            key={themeValue}
            themeValue={themeValue}
            selected={currentTheme === themeValue}
            onChange={handleThemeChange}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[1],
  },
  swatch: {
    width: ICON_SIZE.md,
    height: ICON_SIZE.md,
    borderRadius: ICON_SIZE.md / 2,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  tooltipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  tooltipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.popoverForeground,
  },
}));
