/**
 * Walk session storage and analytics.
 *
 * Completed walks are persisted in AsyncStorage (up to 100 entries).
 * Provides all-time records, calorie estimation, and AI-style suggestions
 * based on recent walk history.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const WALK_RECORDS_KEY = 'apex.walk.completedWalks.v1';

export type CompletedWalk = {
  id: string;
  date: number; // unix ms
  distanceKm: number;
  durationSeconds: number;
  caloriesBurned: number;
  mapSnapshotUri?: string; // local file URI of the route map captured at walk end
};

export type WalkAllTimeRecords = {
  bestDistanceKm: number;
  longestDurationSeconds: number;
  mostCalories: number;
  totalWalks: number;
  totalDistanceKm: number;
};

export type WalkDailyTotals = {
  caloriesBurned: number;
  distanceKm: number;
  steps: number;
  walks: number;
};

// ─── Calorie estimation ───────────────────────────────────────────────────────

/**
 * Estimate calories burned using MET (3.5 for moderate walking).
 * Formula: MET × weight_kg × duration_hours
 */
export function estimateCalories(durationSeconds: number, weightKg: number): number {
  return Math.round((3.5 * weightKg * durationSeconds) / 3600);
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function getCompletedWalks(): Promise<CompletedWalk[]> {
  try {
    const raw = await AsyncStorage.getItem(WALK_RECORDS_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as CompletedWalk[]).sort((a, b) => b.date - a.date);
  } catch {
    return [];
  }
}

export async function saveCompletedWalk(
  walk: Omit<CompletedWalk, 'id'>,
): Promise<CompletedWalk> {
  const existing = await getCompletedWalks();
  const entry: CompletedWalk = {
    ...walk,
    id: `walk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  };
  const next = [entry, ...existing].slice(0, 100);
  await AsyncStorage.setItem(WALK_RECORDS_KEY, JSON.stringify(next));
  return entry;
}

// ─── Records ─────────────────────────────────────────────────────────────────

export async function getWalkAllTimeRecords(): Promise<WalkAllTimeRecords> {
  const walks = await getCompletedWalks();
  if (!walks.length) {
    return {
      bestDistanceKm: 0,
      longestDurationSeconds: 0,
      mostCalories: 0,
      totalWalks: 0,
      totalDistanceKm: 0,
    };
  }
  return {
    bestDistanceKm: Math.max(...walks.map((w) => w.distanceKm)),
    longestDurationSeconds: Math.max(...walks.map((w) => w.durationSeconds)),
    mostCalories: Math.max(...walks.map((w) => w.caloriesBurned)),
    totalWalks: walks.length,
    totalDistanceKm: walks.reduce((s, w) => s + w.distanceKm, 0),
  };
}

// ─── Walking streak ───────────────────────────────────────────────────────────

/**
 * Counts consecutive days (ending today or yesterday) on which at least one
 * walk was logged. Returns 0 if no walks exist.
 */
export async function getWalkStreak(): Promise<number> {
  const walks = await getCompletedWalks();
  if (!walks.length) return 0;

  const uniqueDates = [
    ...new Set(
      walks.map((w) => new Date(w.date).toISOString().slice(0, 10)),
    ),
  ].sort((a, b) => b.localeCompare(a));

  let streak = 0;
  const today = new Date();

  for (let i = 0; i < uniqueDates.length; i++) {
    const expected = new Date(today);
    expected.setDate(today.getDate() - i);
    if (uniqueDates[i] === expected.toISOString().slice(0, 10)) {
      streak++;
    } else {
      break;
    }
  }

  return streak;
}

export async function getDailyWalkTotals(date = new Date()): Promise<WalkDailyTotals> {
  const walks = await getCompletedWalks();
  const target = date.toLocaleDateString('en-CA');
  const todayWalks = walks.filter((walk) => new Date(walk.date).toLocaleDateString('en-CA') === target);
  const distanceKm = todayWalks.reduce((sum, walk) => sum + walk.distanceKm, 0);
  const caloriesBurned = todayWalks.reduce((sum, walk) => sum + walk.caloriesBurned, 0);

  return {
    caloriesBurned,
    distanceKm,
    steps: Math.round(distanceKm * 1312),
    walks: todayWalks.length,
  };
}

const WALK_STREAK_MILESTONES = [3, 7, 14, 30];
const SEEN_WALK_STREAK_KEY = 'apex.inapp.seenWalkStreakMilestones';

/**
 * Checks whether a new walk-streak milestone has been crossed and returns the
 * celebration message (or null if no new milestone).
 */
export async function checkWalkStreakMilestone(streak: number): Promise<string | null> {
  if (streak < 3) return null;
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    const raw = await AsyncStorage.getItem(SEEN_WALK_STREAK_KEY);
    const seen: number[] = raw ? (JSON.parse(raw) as number[]) : [];
    const hit = WALK_STREAK_MILESTONES.filter((m) => streak >= m && !seen.includes(m));
    if (!hit.length) return null;

    const top = Math.max(...hit);
    const merged = [...new Set([...seen, ...hit])];
    await AsyncStorage.setItem(SEEN_WALK_STREAK_KEY, JSON.stringify(merged));
    return `${top}-day walking streak! Keep the momentum going. 🔥`;
  } catch {
    return null;
  }
}

// ─── AI Suggestion ────────────────────────────────────────────────────────────

const GENERIC_TIPS = [
  'Try to beat your best distance today — push past your comfort zone.',
  'Aim for at least 20 minutes. That is where fat burning really kicks in.',
  'Hydrate before you start. Even mild dehydration cuts performance.',
  'Pick up the pace for 30-second intervals to boost calorie burn.',
  'Consistency beats intensity. Another walk today builds the habit.',
  'Morning walks boost energy and metabolism for the rest of the day.',
  'Focus on your posture — shoulders back, core light, chin up.',
];

export async function getWalkSuggestion(): Promise<string> {
  const walks = await getCompletedWalks();

  if (!walks.length) {
    return 'Start your first walk to begin tracking progress and unlocking walking badges.';
  }

  const recent = walks.slice(0, 5);
  const avgDist = recent.reduce((s, w) => s + w.distanceKm, 0) / recent.length;
  const best = Math.max(...walks.map((w) => w.distanceKm));

  if (avgDist < 0.5) {
    return 'You are just getting started — even a short 10-minute walk builds the habit. Go for it.';
  }
  if (avgDist < 1) {
    return `Your recent average is ${avgDist.toFixed(1)} km. Try to hit 1 km today — you have got this.`;
  }
  if (avgDist < best * 0.75) {
    return `Your all-time best is ${best.toFixed(2)} km. You have not been close recently — today is the day to chase that record.`;
  }

  const longestRecent = Math.max(...recent.map((w) => w.durationSeconds));
  if (longestRecent < 1200) {
    return 'Most of your recent walks are under 20 minutes. Try extending to 25 minutes today for extra calorie burn.';
  }

  return GENERIC_TIPS[walks.length % GENERIC_TIPS.length];
}
