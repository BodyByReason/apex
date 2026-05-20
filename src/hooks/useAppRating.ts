/**
 * useAppRating
 *
 * Best-practice app rating logic:
 *  - Only triggers after genuinely positive moments (streak milestone, workout logged, etc.)
 *  - Never fires more than once per 60 days
 *  - Never fires on first launch or first session
 *  - Respects platform's own throttling on top of ours
 *  - Uses expo-store-review (install: npx expo install expo-store-review)
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';

import { loadCachedProfile, syncProfileToSupabase } from '@/lib/profileSync';
import { isProTrialActive } from '@/lib/proTrial';
import { supabase } from '@/lib/supabase';

const KEY_LAST_PROMPTED = 'apex.rating.lastPrompted';
const KEY_SESSION_COUNT = 'apex.rating.sessionCount';
const KEY_TRIAL_BONUS_GRANTED = 'apex.rating.trialBonusGranted';
const COOLDOWN_DAYS = 60;
const MIN_SESSIONS = 3; // don't ask until they've used the app at least 3 times
const EXTRA_TRIAL_DAYS = 7;

async function shouldPrompt(): Promise<boolean> {
  const [lastStr, countStr] = await Promise.all([
    AsyncStorage.getItem(KEY_LAST_PROMPTED),
    AsyncStorage.getItem(KEY_SESSION_COUNT),
  ]);

  const sessionCount = parseInt(countStr ?? '0', 10);
  if (sessionCount < MIN_SESSIONS) return false;

  if (!lastStr) return true; // never prompted before

  const daysSince = (Date.now() - parseInt(lastStr, 10)) / (1000 * 60 * 60 * 24);
  return daysSince >= COOLDOWN_DAYS;
}

async function markPrompted() {
  await AsyncStorage.setItem(KEY_LAST_PROMPTED, String(Date.now()));
}

async function hasTrialBonus() {
  const raw = await AsyncStorage.getItem(KEY_TRIAL_BONUS_GRANTED);
  return raw === '1';
}

function askTrialBonusReview(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      'Enjoying APEX?',
      'Leave a quick review and we’ll add 1 extra free week to your current trial.',
      [
        { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Leave review', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

async function grantTrialBonusWeek() {
  const profile = await loadCachedProfile();
  if (!profile?.proTrialEndsAt?.trim()) return false;

  const currentEnd = Date.parse(profile.proTrialEndsAt);
  if (Number.isNaN(currentEnd)) return false;

  const nextEnd = new Date(currentEnd + EXTRA_TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const nextProfile = { ...profile, proTrialEndsAt: nextEnd };
  const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
  await syncProfileToSupabase(data.session?.user?.id, nextProfile).catch(() => null);
  await AsyncStorage.setItem(KEY_TRIAL_BONUS_GRANTED, '1');
  return true;
}

export async function incrementSessionCount() {
  const countStr = await AsyncStorage.getItem(KEY_SESSION_COUNT);
  const next = parseInt(countStr ?? '0', 10) + 1;
  await AsyncStorage.setItem(KEY_SESSION_COUNT, String(next));
}

/**
 * Call this after a positive user event:
 *   - 7-day streak reached
 *   - 10th workout logged
 *   - First goal completed
 *   - etc.
 *
 * It will silently no-op if the cooldown hasn't passed or sessions are too low.
 */
export async function maybeRequestReview(): Promise<boolean> {
  try {
    const ok = await shouldPrompt();
    if (!ok) return false;

    const profile = await loadCachedProfile().catch(() => null);
    const trialBonusAvailable = Boolean(profile && isProTrialActive(profile) && !(await hasTrialBonus()));

    if (trialBonusAvailable) {
      const accepted = await askTrialBonusReview();
      if (!accepted) return false;
    }

    // Dynamic import so the app doesn't crash if expo-store-review isn't installed yet
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore – install with: npx expo install expo-store-review
    const StoreReview = await import('expo-store-review').catch(() => null);
    if (!StoreReview) return false;

    const isAvailable = await StoreReview.default.isAvailableAsync();
    if (!isAvailable) return false;

    await StoreReview.default.requestReview();
    await markPrompted();
    if (trialBonusAvailable) {
      await grantTrialBonusWeek().catch(() => null);
    }
    return true;
  } catch {
    // Never surface rating errors to the user
    return false;
  }
}
