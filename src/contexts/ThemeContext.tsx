/**
 * ThemeContext
 *
 * Lets users pick an accent color during onboarding.
 * The chosen theme is stored in AsyncStorage under the UserProfile key
 * and rehydrated on launch.
 *
 * Usage:
 *   const { accent, accentSoft, accentBorder } = useTheme();
 */
import type { PropsWithChildren } from 'react';

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

export type ThemeId = 'green' | 'blue' | 'purple' | 'orange' | 'rose' | 'pink' | 'gold';

export type ThemeOption = {
  id: ThemeId;
  label: string;
  accent: string;
  accentSoft: string;
  accentBorder: string;
  accentStrongBorder: string;
  preview: string; // emoji shown in picker
};

export const THEMES: ThemeOption[] = [
  {
    accent: '#00FF87',
    accentBorder: 'rgba(0,255,135,0.15)',
    accentSoft: 'rgba(0,255,135,0.05)',
    accentStrongBorder: 'rgba(0,255,135,0.22)',
    id: 'green',
    label: 'APEX Green',
    preview: '🟢',
  },
  {
    accent: '#3B82F6',
    accentBorder: 'rgba(59,130,246,0.2)',
    accentSoft: 'rgba(59,130,246,0.06)',
    accentStrongBorder: 'rgba(59,130,246,0.3)',
    id: 'blue',
    label: 'Electric Blue',
    preview: '🔵',
  },
  {
    accent: '#A855F7',
    accentBorder: 'rgba(168,85,247,0.2)',
    accentSoft: 'rgba(168,85,247,0.06)',
    accentStrongBorder: 'rgba(168,85,247,0.3)',
    id: 'purple',
    label: 'Neon Purple',
    preview: '🟣',
  },
  {
    accent: '#FF6B35',
    accentBorder: 'rgba(255,107,53,0.2)',
    accentSoft: 'rgba(255,107,53,0.06)',
    accentStrongBorder: 'rgba(255,107,53,0.3)',
    id: 'orange',
    label: 'Sunset Orange',
    preview: '🟠',
  },
  {
    accent: '#F43F5E',
    accentBorder: 'rgba(244,63,94,0.2)',
    accentSoft: 'rgba(244,63,94,0.06)',
    accentStrongBorder: 'rgba(244,63,94,0.3)',
    id: 'rose',
    label: 'Rose Red',
    preview: '🔴',
  },
  {
    accent: '#FF4FB3',
    accentBorder: 'rgba(255,79,179,0.22)',
    accentSoft: 'rgba(255,79,179,0.08)',
    accentStrongBorder: 'rgba(255,79,179,0.34)',
    id: 'pink',
    label: 'Hot Pink',
    preview: '🩷',
  },
  {
    accent: '#F5C451',
    accentBorder: 'rgba(245,196,81,0.24)',
    accentSoft: 'rgba(245,196,81,0.08)',
    accentStrongBorder: 'rgba(245,196,81,0.34)',
    id: 'gold',
    label: 'Victory Gold',
    preview: '🟡',
  },
];

const THEME_STORAGE_KEY = 'apex.theme';
const DEFAULT_THEME = THEMES[0];

type ThemeContextValue = ThemeOption & {
  setTheme: (id: ThemeId) => Promise<void>;
  allThemes: ThemeOption[];
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: PropsWithChildren) {
  const [themeId, setThemeId] = useState<ThemeId>('green');

  useEffect(() => {
    AsyncStorage.getItem(THEME_STORAGE_KEY)
      .then((stored) => {
        if (stored && THEMES.find((t) => t.id === stored)) {
          setThemeId(stored as ThemeId);
        }
      })
      .catch(() => null);
  }, []);

  const setTheme = useCallback(async (id: ThemeId) => {
    setThemeId(id);
    await AsyncStorage.setItem(THEME_STORAGE_KEY, id);
  }, []);

  const active = THEMES.find((t) => t.id === themeId) ?? DEFAULT_THEME;

  const value = useMemo<ThemeContextValue>(
    () => ({ ...active, allThemes: THEMES, setTheme }),
    [active, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
