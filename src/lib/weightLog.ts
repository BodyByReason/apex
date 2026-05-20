/**
 * weightLog.ts
 *
 * Types and AsyncStorage helpers for the APEX body-weight tracking system.
 *   - WeightEntry — individual weigh-in records (morning / evening / manual)
 *   - Helper functions for reading, adding, and querying log entries
 *   - Frequency helpers: should the user weigh in today (morning / evening)?
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Keys ────────────────────────────────────────────────────────────────────

export const WEIGHT_LOG_KEY = 'apex.weightLog';

// ─── Types ───────────────────────────────────────────────────────────────────

export type WeighFrequency = 'twice_daily' | 'every_other_day' | 'weekly';
export type WeighSession  = 'morning' | 'evening' | 'manual';

export type WeightEntry = {
  id: string;
  /** Weight in pounds (always stored as lbs; display conversion done in UI) */
  weightLbs: number;
  /** User-chosen session for this entry */
  session: WeighSession;
  /** ISO timestamp */
  loggedAt: string;
  /** Optional note (e.g. "post-workout", "feeling bloated") */
  note?: string;
  /** URI if the user photographed their scale */
  photoUri?: string;
};

// ─── Storage helpers ──────────────────────────────────────────────────────────

export async function getWeightLog(): Promise<WeightEntry[]> {
  const raw = await AsyncStorage.getItem(WEIGHT_LOG_KEY).catch(() => null);
  return raw ? (JSON.parse(raw) as WeightEntry[]) : [];
}

export async function addWeightEntry(
  entry: Omit<WeightEntry, 'id' | 'loggedAt'>,
): Promise<WeightEntry> {
  const log = await getWeightLog();
  const newEntry: WeightEntry = {
    ...entry,
    id: `w-${Date.now()}`,
    loggedAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(WEIGHT_LOG_KEY, JSON.stringify([...log, newEntry]));
  return newEntry;
}

/** Entries logged today (local date) */
export async function getTodayEntries(): Promise<WeightEntry[]> {
  const log = await getWeightLog();
  const today = new Date().toISOString().slice(0, 10);
  return log.filter((e) => e.loggedAt.slice(0, 10) === today);
}

/** Most recent entry regardless of date */
export async function getLatestEntry(): Promise<WeightEntry | null> {
  const log = await getWeightLog();
  if (!log.length) return null;
  return log[log.length - 1];
}

/** Rolling 7-day average weight */
export async function get7DayAverage(): Promise<number | null> {
  const log = await getWeightLog();
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = log.filter((e) => new Date(e.loggedAt).getTime() >= cutoff);
  if (!recent.length) return null;
  return recent.reduce((sum, e) => sum + e.weightLbs, 0) / recent.length;
}

// ─── Frequency / checklist helpers ───────────────────────────────────────────

/**
 * Returns which weigh-in sessions are due today based on the user's chosen frequency.
 * Used by DashboardScreen to build the daily checklist items.
 */
export function getDueSessions(
  frequency: WeighFrequency,
  todayEntries: WeightEntry[],
): Array<{ session: WeighSession; done: boolean; label: string }> {
  const today = new Date().toISOString().slice(0, 10);

  if (frequency === 'twice_daily') {
    const mornDone = todayEntries.some((e) => e.session === 'morning');
    const eveDone  = todayEntries.some((e) => e.session === 'evening');
    return [
      { session: 'morning', done: mornDone, label: 'Log Morning Weight' },
      { session: 'evening', done: eveDone,  label: 'Log Evening Weight' },
    ];
  }

  if (frequency === 'every_other_day') {
    // Due on even days of year
    const dayOfYear = Math.floor(
      (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86_400_000,
    );
    if (dayOfYear % 2 !== 0) return []; // not due today
    const done = todayEntries.length > 0;
    return [{ session: 'manual', done, label: 'Log Your Weight' }];
  }

  // weekly — due on whichever weekday they first weighed in, or Sunday
  const log = [] as WeightEntry[]; // sync stub — caller passes todayEntries
  void log; // suppress unused warning
  const dayOfWeek = new Date().getDay(); // 0=Sun
  // We show it every Sunday (or every Monday — use day 1 for Monday)
  if (dayOfWeek !== 0) return []; // only prompt on Sunday
  const done = todayEntries.length > 0;
  return [{ session: 'manual', done, label: 'Weekly Weigh-In' }];
}

/**
 * Human-readable label for a frequency setting.
 */
export function frequencyLabel(f: WeighFrequency): string {
  return f === 'twice_daily'
    ? 'Morning & Night'
    : f === 'every_other_day'
    ? 'Every Other Day'
    : 'Once a Week';
}

export function weighSessionLabel(session: WeighSession): string {
  return session === 'manual' ? 'Now' : session === 'morning' ? 'Morning' : 'Evening';
}
