import type { PropsWithChildren } from 'react';

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { incrementSessionCount, maybeRequestReview } from '@/hooks/useAppRating';

const XP_STORAGE_KEY = 'apex.gamification.xp';
const XP_PER_LEVEL = 100;

// Milestones (total XP values) at which we nudge for a review
const REVIEW_XP_MILESTONES = [300, 1000, 3000];

type GamificationContextValue = {
  addXp: (amount: number) => Promise<void>;
  level: number;
  loading: boolean;
  xp: number;
};

const GamificationContext = createContext<GamificationContextValue | undefined>(
  undefined,
);

export function GamificationProvider({ children }: PropsWithChildren) {
  const [xp, setXp] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const hydrateXp = async () => {
      const storedXp = await AsyncStorage.getItem(XP_STORAGE_KEY);
      setXp(Number(storedXp ?? 0));
      setLoading(false);
      // Count this as a session (fires once per app mount)
      incrementSessionCount().catch(() => null);
    };

    hydrateXp().catch(() => setLoading(false));
  }, []);

  const value = useMemo<GamificationContextValue>(
    () => ({
      addXp: async (amount) => {
        setXp((currentXp) => {
          const nextXp = currentXp + amount;
          AsyncStorage.setItem(XP_STORAGE_KEY, String(nextXp)).catch(() => null);
          // Fire review prompt when crossing an XP milestone
          const crossedMilestone = REVIEW_XP_MILESTONES.some(
            (m) => currentXp < m && nextXp >= m,
          );
          if (crossedMilestone) {
            maybeRequestReview().catch(() => null);
          }
          return nextXp;
        });
      },
      level: Math.floor(xp / XP_PER_LEVEL) + 1,
      loading,
      xp,
    }),
    [loading, xp],
  );

  return (
    <GamificationContext.Provider value={value}>
      {children}
    </GamificationContext.Provider>
  );
}

export function useGamification() {
  const context = useContext(GamificationContext);

  if (!context) {
    throw new Error(
      'useGamification must be used within a GamificationProvider.',
    );
  }

  return context;
}
