/**
 * Walk & Water Challenge Edition — Mode Management
 *
 * When Walk & Water mode is enabled the app renders WalkWaterTabNavigator
 * instead of the standard APEX MainNavigator. Togglable from the admin panel
 * (CoachModeScreen) so it can be used for a separate ad campaign / funnel.
 *
 * Stored device-locally — never syncs to Supabase.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceEventEmitter } from 'react-native';

/** Returns a YYYY-MM-DD string in the device's local timezone (not UTC). */
function localDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Returns the canonical start date for a challenge of the given length.
 * 3-day challenges always start on Tuesday — if the user signs up Wed or Thu
 * (mid-challenge), backdate to this week's Tuesday so the day counter matches
 * the global cohort. Outside the Tue–Thu window, use today (next cycle hasn't started).
 */
function getChallengeStartDate(challengeDays: number): string {
  if (challengeDays !== 3) return localDateString(new Date());
  const d = new Date();
  const dow = d.getDay(); // 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat
  if (dow >= 2 && dow <= 4) {
    // Tue–Thu: active challenge window — rewind to this week's Tuesday
    d.setDate(d.getDate() - (dow - 2));
  } else {
    // Fri–Mon: between challenges — advance to next Tuesday
    // Formula: (9 - dow) % 7 gives exact days until next Tue from any non-Tue day
    d.setDate(d.getDate() + (9 - dow) % 7);
  }
  return localDateString(d);
}

/** Difference in local calendar days between two YYYY-MM-DD strings. */
function localDaysBetween(startDateStr: string, endDateStr: string): number {
  const [sy, sm, sd] = startDateStr.split('-').map(Number);
  const [ey, em, ed] = endDateStr.split('-').map(Number);
  const start = new Date(sy, sm - 1, sd).getTime();
  const end   = new Date(ey, em - 1, ed).getTime();
  return Math.floor((end - start) / 86400000);
}

const WW_MODE_KEY     = 'apex._edition.walkWater';
const WW_QUIZ_KEY     = 'apex._edition.walkWaterQuiz';
const WW_PLAN_KEY     = 'apex._edition.walkWaterPlan';
const WW_UPGRADED_KEY = 'apex._edition.wwUpgraded';
const WW_LAST_COMPLETED_DAYS_KEY     = 'apex.ww.lastCompletedChallengeDays';
const WW_ACTIVITY_DATES_KEY          = 'apex.ww.activityDates';
const WW_CHALLENGE_COMPLETED_AT_KEY  = 'apex.ww.challengeCompletedAt';

export const WALK_WATER_MODE_EVENT      = 'apex.walkWaterModeChanged';
export const WALK_WATER_QUIZ_DONE_EVENT = 'apex.walkWaterQuizDone';
export const WALK_WATER_UPGRADE_EVENT   = 'apex.walkWaterUpgraded';

// ─── Mode flag ────────────────────────────────────────────────────────────────

export async function isWalkWaterModeEnabled(): Promise<boolean> {
  try {
    const stored = await AsyncStorage.getItem(WW_MODE_KEY);
    if (stored === null) {
      return true;
    }
    return stored === '1';
  } catch {
    return true;
  }
}

export async function setWalkWaterModeEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(WW_MODE_KEY, enabled ? '1' : '0');
  DeviceEventEmitter.emit(WALK_WATER_MODE_EVENT, enabled);
}

// ─── Upgrade flag (WW → APEX tabs unlock) ────────────────────────────────────

export async function isWWUpgraded(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(WW_UPGRADED_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function setWWUpgraded(upgraded: boolean): Promise<void> {
  await AsyncStorage.setItem(WW_UPGRADED_KEY, upgraded ? '1' : '0');
  DeviceEventEmitter.emit(WALK_WATER_UPGRADE_EVENT, upgraded);
}

// ─── Quiz answers ─────────────────────────────────────────────────────────────

export type DailyStepsRange = 'under2k' | '2to5k' | '5to8k' | 'over8k';
export type DailyWaterRange = 'under4' | '4to6' | '6to8' | 'over8';
export type WalkGoal = 'lose_weight' | 'more_energy' | 'build_habit' | 'feel_better';
export type BestWalkTime = 'morning' | 'lunch' | 'afternoon' | 'evening';
export type ChallengeDuration = 3 | 7 | 14 | 21 | 30;

export type WWGender = 'male' | 'female' | 'other';

export type WalkWaterQuizAnswers = {
  dailySteps:    DailyStepsRange;
  dailyWater:    DailyWaterRange;
  primaryGoal:   WalkGoal;
  gender:        WWGender;
  bestWalkTime:  BestWalkTime;
  challengeDays: ChallengeDuration;
};

export async function saveWalkWaterQuizAnswers(answers: WalkWaterQuizAnswers): Promise<void> {
  await AsyncStorage.setItem(WW_QUIZ_KEY, JSON.stringify(answers));
}

export async function getWalkWaterQuizAnswers(): Promise<WalkWaterQuizAnswers | null> {
  try {
    const raw = await AsyncStorage.getItem(WW_QUIZ_KEY);
    return raw ? (JSON.parse(raw) as WalkWaterQuizAnswers) : null;
  } catch {
    return null;
  }
}

// ─── Generated plan ───────────────────────────────────────────────────────────

export type WalkWaterPlan = {
  dailyStepGoal: number;       // target steps/day
  dailyWaterGoalOz: number;    // target water oz/day (8 oz per glass)
  challengeDays: ChallengeDuration;
  startDate: string;           // ISO date
  walkTimeLabel: string;       // human-readable suggested walk window
  goalLabel: string;           // human-readable primary goal
  weeklyProgressions: Array<{ week: number; stepGoal: number; waterGoalOz: number }>;
};

export function buildWalkWaterPlan(answers: WalkWaterQuizAnswers): WalkWaterPlan {
  const baseSteps: Record<DailyStepsRange, number> = {
    under2k: 4000,
    '2to5k': 6000,
    '5to8k': 8000,
    over8k: 10000,
  };

  const baseWaterOz: Record<DailyWaterRange, number> = {
    under4: 48,   // 6 glasses × 8 oz
    '4to6': 64,   // 8 glasses
    '6to8': 80,   // 10 glasses
    over8: 96,    // 12 glasses
  };

  const walkTimeLabels: Record<BestWalkTime, string> = {
    morning:   'Morning (6–9 AM)',
    lunch:     'Lunch (12–1 PM)',
    afternoon: 'Afternoon (3–5 PM)',
    evening:   'Evening (6–8 PM)',
  };

  const goalLabels: Record<WalkGoal, string> = {
    lose_weight:  'Lean out',
    more_energy:  'More energy',
    build_habit:  'Build confidence',
    feel_better:  'Feel better every day',
  };

  const stepGoal = baseSteps[answers.dailySteps];
  const waterGoalOz = baseWaterOz[answers.dailyWater];
  const weeks = Math.ceil(answers.challengeDays / 7);

  const weeklyProgressions = Array.from({ length: weeks }, (_, i) => ({
    week: i + 1,
    stepGoal: stepGoal + i * 500,
    waterGoalOz: waterGoalOz + i * 8,
  }));

  return {
    challengeDays: answers.challengeDays,
    dailyStepGoal: stepGoal,
    dailyWaterGoalOz: waterGoalOz,
    startDate: getChallengeStartDate(answers.challengeDays),
    walkTimeLabel: walkTimeLabels[answers.bestWalkTime],
    goalLabel: goalLabels[answers.primaryGoal],
    weeklyProgressions,
  };
}

export async function saveWalkWaterPlan(plan: WalkWaterPlan): Promise<void> {
  // Starting a new challenge clears the previous round's completion state
  await Promise.all([
    AsyncStorage.setItem(WW_PLAN_KEY, JSON.stringify(plan)),
    AsyncStorage.removeItem(WW_GROUP_WORKOUT_KEY),
    AsyncStorage.removeItem(WW_GROUP_WORKOUT_TIME_KEY),
    AsyncStorage.removeItem(WW_ACTIVITY_DATES_KEY),
    AsyncStorage.removeItem(WW_CHALLENGE_COMPLETED_AT_KEY),
  ]);
}

export async function getWalkWaterPlan(): Promise<WalkWaterPlan | null> {
  try {
    const raw = await AsyncStorage.getItem(WW_PLAN_KEY);
    if (!raw) return null;
    const plan = JSON.parse(raw) as WalkWaterPlan;
    // Self-heal: if the stored startDate is after the canonical challenge start
    // (e.g. user completed the quiz on Wed but the 3-day challenge began Tue),
    // correct it so the day counter matches the global cohort.
    const canonical = getChallengeStartDate(plan.challengeDays);
    if (plan.startDate > canonical) {
      const corrected = { ...plan, startDate: canonical };
      await AsyncStorage.setItem(WW_PLAN_KEY, JSON.stringify(corrected));
      return corrected;
    }
    return plan;
  } catch {
    return null;
  }
}

// ─── Water log (today) ────────────────────────────────────────────────────────

function todayWaterKey(): string {
  return `apex.ww.water.${localDateString(new Date())}`;
}

export async function getWaterOzToday(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(todayWaterKey());
    return raw ? Number(raw) : 0;
  } catch {
    return 0;
  }
}

export async function addWaterOz(oz: number): Promise<number> {
  const current = await getWaterOzToday();
  const next = Math.max(0, current + oz);
  await Promise.all([
    AsyncStorage.setItem(todayWaterKey(), String(next)),
    recordWWActivityToday(),
  ]);
  return next;
}

export async function setWaterOz(oz: number): Promise<void> {
  await AsyncStorage.setItem(todayWaterKey(), String(Math.max(0, oz)));
}

// ─── Group workout completion ─────────────────────────────────────────────────

const WW_GROUP_WORKOUT_KEY      = 'apex.ww.groupWorkoutDone';
const WW_GROUP_WORKOUT_TIME_KEY = 'apex.ww.groupWorkoutDoneAt';

export async function getGroupWorkoutDone(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(WW_GROUP_WORKOUT_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function setGroupWorkoutDone(): Promise<void> {
  const now = String(Date.now());
  const plan = await getWalkWaterPlan().catch(() => null);
  await Promise.all([
    AsyncStorage.setItem(WW_GROUP_WORKOUT_KEY, '1'),
    AsyncStorage.setItem(WW_GROUP_WORKOUT_TIME_KEY, now),
    plan?.challengeDays
      ? AsyncStorage.setItem(WW_LAST_COMPLETED_DAYS_KEY, String(plan.challengeDays))
      : Promise.resolve(),
  ]);
}

export async function getGroupWorkoutCompletionTime(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(WW_GROUP_WORKOUT_TIME_KEY);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

export async function getLastCompletedChallengeDays(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(WW_LAST_COMPLETED_DAYS_KEY);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

// ─── Activity tracking ────────────────────────────────────────────────────────

const WATER_KEY_PREFIX = 'apex.ww.water.';

/**
 * One-time migration: scans all existing per-day water log keys in AsyncStorage
 * and seeds WW_ACTIVITY_DATES_KEY with those dates.
 * Runs at most once — subsequent calls find the key already set and skip.
 * Returns the seeded date array (may be empty if no prior water history).
 */
async function migrateActivityDatesFromWaterLogs(): Promise<string[]> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const waterKeys = allKeys.filter((k) => k.startsWith(WATER_KEY_PREFIX));
    if (waterKeys.length === 0) return [];

    const pairs = await AsyncStorage.multiGet(waterKeys);
    const dates: string[] = [];
    for (const [key, val] of pairs) {
      if (val && Number(val) > 0) {
        const dateStr = key.slice(WATER_KEY_PREFIX.length);
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) dates.push(dateStr);
      }
    }
    dates.sort();
    if (dates.length > 0) {
      await AsyncStorage.setItem(WW_ACTIVITY_DATES_KEY, JSON.stringify(dates));
    }
    return dates;
  } catch {
    return [];
  }
}

/**
 * Records today as an active day (walk completed or water logged).
 * Used to power the real day-streak shown in the dashboard badge.
 * Best-effort: never throws.
 */
export async function recordWWActivityToday(): Promise<void> {
  const today = localDateString(new Date());
  try {
    const raw = await AsyncStorage.getItem(WW_ACTIVITY_DATES_KEY);
    const dates: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    if (!dates.includes(today)) {
      await AsyncStorage.setItem(WW_ACTIVITY_DATES_KEY, JSON.stringify([...dates, today]));
    }
  } catch {
    // streak is cosmetic — never let this break the caller
  }
}

// ─── Challenge streak ─────────────────────────────────────────────────────────

/**
 * Walk a date set backward from `startDate`, counting consecutive active days.
 * Returns the number of consecutive days found.
 */
function walkStreakBackward(dateSet: Set<string>, startDate: Date): number {
  const cursor = new Date(startDate);
  let streak = 0;
  while (dateSet.has(localDateString(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/**
 * Returns how many consecutive days the user has logged at least one walk or
 * water entry, with a grace period for the current day:
 *
 *   - If today is active → walk backward from today (normal case).
 *   - If today is NOT yet active but yesterday WAS → walk backward from
 *     yesterday (grace period — user hasn't broken their streak, they just
 *     haven't logged anything yet today).
 *   - If neither today nor yesterday is active → streak is 0.
 */
export async function getWalkWaterStreak(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(WW_ACTIVITY_DATES_KEY);
    // No activity data yet — run one-time migration from historical water logs
    // so existing users don't see a 0 streak after the OTA that introduced this key.
    if (!raw) {
      const migrated = await migrateActivityDatesFromWaterLogs();
      if (migrated.length === 0) return 0;
      const dateSet = new Set(migrated);
      const today = new Date();
      if (dateSet.has(localDateString(today))) return walkStreakBackward(dateSet, today);
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      return walkStreakBackward(dateSet, yesterday);
    }
    const dates: string[] = JSON.parse(raw) as string[];
    if (dates.length === 0) return 0;
    const dateSet = new Set(dates);
    const today = new Date();
    if (dateSet.has(localDateString(today))) return walkStreakBackward(dateSet, today);
    // Grace period: today not yet active — show yesterday's streak if it exists.
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return walkStreakBackward(dateSet, yesterday);
  } catch {
    return 0;
  }
}

// ─── Challenge completion timestamp ──────────────────────────────────────────

/**
 * Persists the exact moment the challenge first completed.
 * Used as the replay-window anchor for users who never did the group workout,
 * so the "Don't Stop Now" banner fires 48 h after completion on any day.
 */
export async function setChallengeCompletedAt(timestamp: number): Promise<void> {
  await AsyncStorage.setItem(WW_CHALLENGE_COMPLETED_AT_KEY, String(timestamp));
}

export async function getChallengeCompletedAt(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(WW_CHALLENGE_COMPLETED_AT_KEY);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}
