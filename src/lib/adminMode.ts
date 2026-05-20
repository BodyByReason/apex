/**
 * Admin / Developer Mode
 *
 * Provides an in-app toggle so the developer can preview Pro features and
 * toggle between Pro and Free views without going through RevenueCat.
 *
 * Keys are intentionally obscure so they won't be accidentally set.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceEventEmitter } from 'react-native';
import { env } from '@/lib/env';

const ADMIN_KEY = 'apex._dev.adminEnabled';
const PRO_PREVIEW_KEY = 'apex._dev.proPreview';
// Password is loaded from the environment — never hardcoded in source.
// Set EXPO_PUBLIC_COACH_ACCESS_PASSWORD in your .env / EAS secret.
const COACH_ACCESS_PASSWORD = env.EXPO_PUBLIC_COACH_ACCESS_PASSWORD ?? '';

/** Event fired whenever Pro Preview is toggled — all `usePro` hooks listen. */
export const PRO_PREVIEW_EVENT = 'apex.proPreviewChanged';

/**
 * Whether developer tools are unlocked on this device.
 * This is a device-local flag — it never syncs to Supabase.
 */
export async function isAdminEnabled(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ADMIN_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function setAdminEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(ADMIN_KEY, enabled ? '1' : '0');
}

/**
 * Pro Preview — forces `isPro = true` in the `usePro` hook regardless of
 * the user's RevenueCat subscription status.  Useful for testing Pro screens
 * without purchasing.
 */
export async function isProPreview(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PRO_PREVIEW_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function setProPreview(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(PRO_PREVIEW_KEY, enabled ? '1' : '0');
  // Broadcast immediately so all mounted usePro hooks update without needing
  // a navigation cycle or app restart.
  DeviceEventEmitter.emit(PRO_PREVIEW_EVENT, enabled);
}

/**
 * Clear all dev overrides — resets to normal user experience.
 */
export async function clearAdminOverrides(): Promise<void> {
  await AsyncStorage.multiRemove([ADMIN_KEY, PRO_PREVIEW_KEY]);
}

export function verifyCoachAccessPassword(password: string): boolean {
  // Defence in depth: if the env secret is missing in the build (e.g. EAS
  // secret not configured for a production profile), reject ALL passwords
  // including an empty one. Without this guard, an unset env would make
  // `'' === ''` return true and unlock coach + admin tooling for anyone.
  if (!COACH_ACCESS_PASSWORD || COACH_ACCESS_PASSWORD.length < 4) return false;
  return password.trim() === COACH_ACCESS_PASSWORD;
}
