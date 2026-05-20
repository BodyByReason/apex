import type { PropsWithChildren } from 'react';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getLocales } from 'expo-localization';
import i18n from 'i18next';

import { LANGUAGE_STORAGE_KEY } from '@/lib/i18n';

export type LanguageId = 'en' | 'es';

const LANGUAGES: Array<{ id: LanguageId; label: string; nativeLabel: string }> = [
  { id: 'en', label: 'English', nativeLabel: 'English' },
  { id: 'es', label: 'Spanish', nativeLabel: 'Español' },
];

type LanguageContextValue = {
  languages: typeof LANGUAGES;
  language: LanguageId;
  setLanguage: (language: LanguageId) => Promise<void>;
};

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

function normalizeLanguage(value?: string | null): LanguageId {
  return value?.startsWith('es') ? 'es' : 'en';
}

export function LanguageProvider({ children }: PropsWithChildren) {
  const [language, setLanguageState] = useState<LanguageId>('en');

  useEffect(() => {
    AsyncStorage.getItem(LANGUAGE_STORAGE_KEY)
      .then(async (stored) => {
        const next = normalizeLanguage(stored ?? getLocales()[0]?.languageCode);
        setLanguageState(next);
        await i18n.changeLanguage(next);
      })
      .catch(() => null);
  }, []);

  const setLanguage = useCallback(async (next: LanguageId) => {
    setLanguageState(next);
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    await i18n.changeLanguage(next);
  }, []);

  const value = useMemo(
    () => ({
      language,
      languages: LANGUAGES,
      setLanguage,
    }),
    [language, setLanguage],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
