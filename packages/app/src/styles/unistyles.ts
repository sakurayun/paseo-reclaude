import { StyleSheet } from "react-native-unistyles";
import {
  lightTheme,
  lightClaudeTheme,
  lightCatppuccinLatteTheme,
  newTheme,
  newThemeClaude,
  newThemeCatppuccinLatte,
  newThemeDark,
  newThemePaseoDark,
  newThemeMidnightDark,
  newThemeGhosttyDark,
  newThemeClaudeDark,
  newThemeCatppuccinFrappe,
  newThemeCatppuccinMacchiato,
  newThemeCatppuccinMocha,
  darkTheme,
  darkZincTheme,
  darkMidnightTheme,
  darkClaudeTheme,
  darkGhosttyTheme,
  darkCatppuccinFrappeTheme,
  darkCatppuccinMacchiatoTheme,
  darkCatppuccinMochaTheme,
} from "./theme";

StyleSheet.configure({
  themes: {
    light: lightTheme,
    lightClaude: lightClaudeTheme,
    lightCatppuccinLatte: lightCatppuccinLatteTheme,
    newTheme,
    newThemeClaude,
    newThemeCatppuccinLatte,
    newThemeDark,
    newThemePaseoDark,
    newThemeMidnightDark,
    newThemeGhosttyDark,
    newThemeClaudeDark,
    newThemeCatppuccinFrappe,
    newThemeCatppuccinMacchiato,
    newThemeCatppuccinMocha,
    dark: darkTheme,
    darkZinc: darkZincTheme,
    darkMidnight: darkMidnightTheme,
    darkClaude: darkClaudeTheme,
    darkGhostty: darkGhosttyTheme,
    darkCatppuccinFrappe: darkCatppuccinFrappeTheme,
    darkCatppuccinMacchiato: darkCatppuccinMacchiatoTheme,
    darkCatppuccinMocha: darkCatppuccinMochaTheme,
  },
  breakpoints: {
    xs: 0,
    sm: 576,
    md: 720,
    lg: 992,
    xl: 1200,
  },
  settings: {
    adaptiveThemes: true,
  },
});

// Type augmentation for TypeScript
interface AppThemes {
  light: typeof lightTheme;
  lightClaude: typeof lightClaudeTheme;
  lightCatppuccinLatte: typeof lightCatppuccinLatteTheme;
  newTheme: typeof newTheme;
  newThemeClaude: typeof newThemeClaude;
  newThemeCatppuccinLatte: typeof newThemeCatppuccinLatte;
  newThemeDark: typeof newThemeDark;
  newThemePaseoDark: typeof newThemePaseoDark;
  newThemeMidnightDark: typeof newThemeMidnightDark;
  newThemeGhosttyDark: typeof newThemeGhosttyDark;
  newThemeClaudeDark: typeof newThemeClaudeDark;
  newThemeCatppuccinFrappe: typeof newThemeCatppuccinFrappe;
  newThemeCatppuccinMacchiato: typeof newThemeCatppuccinMacchiato;
  newThemeCatppuccinMocha: typeof newThemeCatppuccinMocha;
  dark: typeof darkTheme;
  darkZinc: typeof darkZincTheme;
  darkMidnight: typeof darkMidnightTheme;
  darkClaude: typeof darkClaudeTheme;
  darkGhostty: typeof darkGhosttyTheme;
  darkCatppuccinFrappe: typeof darkCatppuccinFrappeTheme;
  darkCatppuccinMacchiato: typeof darkCatppuccinMacchiatoTheme;
  darkCatppuccinMocha: typeof darkCatppuccinMochaTheme;
}

interface AppBreakpoints {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
}

declare module "react-native-unistyles" {
  export interface UnistylesThemes extends AppThemes {}
  export interface UnistylesBreakpoints extends AppBreakpoints {}
}
