import { DarkTheme as NavigationDarkTheme } from '@react-navigation/native';

import { colors } from './colors';

export { colors } from './colors';
export { spacing } from './spacing';
export { typography } from './typography';

export function buildDarkTheme(accent: string) {
  return {
    ...NavigationDarkTheme,
    dark: true,
    colors: {
      ...NavigationDarkTheme.colors,
      background: colors.background,
      border: colors.border,
      card: colors.surface,
      notification: accent,
      primary: accent,
      text: colors.textPrimary,
    },
  };
}

export const DarkTheme = buildDarkTheme(colors.accent);
