/**
 * Walk & Water Challenge — Leaderboard (Supabase-backed)
 *
 * Two boards:
 *   Global   — all-time aggregate of every day's stats per user.
 *   3-Day    — stats for the current (or most recent) Tue–Thu challenge week only.
 *
 * Composite score: steps + (waterGlasses × 200) + (streak × 500)
 * Water and consistency both matter, but a walker with 0 water can still rank.
 */

import { supabase } from '@/lib/supabase';

export type LeaderboardMode = 'global' | '3day';

export interface LeaderboardEntry {
  userId: string;
  username: string;
  steps: number;
  waterGlasses: number;
  streak: number;
  score: number;
  isMe: boolean;
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

/** YYYY-MM-DD in local device timezone. */
function localDateString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Returns the most recent Tuesday in Arizona time (UTC-7, no DST) as YYYY-MM-DD.
 * On Tue–Thu this is the current challenge week; on Fri–Mon it's last week's.
 * Used both for upserting challenge_week and for querying the 3-day board.
 */
export function mostRecentTuesdayAZ(): string {
  const azNow = new Date(Date.now() - 7 * 60 * 60 * 1000); // UTC-7
  const azDow = azNow.getUTCDay(); // 0=Sun … 6=Sat
  // Days since the most recent Tuesday (wraps correctly for Sun/Mon)
  const daysFromTue = azDow >= 2 ? azDow - 2 : azDow + 5;
  const tuesday = new Date(azNow);
  tuesday.setUTCDate(tuesday.getUTCDate() - daysFromTue);
  const y = tuesday.getUTCFullYear();
  const m = String(tuesday.getUTCMonth() + 1).padStart(2, '0');
  const d = String(tuesday.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * True if right now is inside the active 3-day challenge window (Tue–Thu AZ).
 */
function isActive3DayWindow(): boolean {
  const azNow = new Date(Date.now() - 7 * 60 * 60 * 1000);
  const azDow = azNow.getUTCDay();
  if (azDow < 2 || azDow > 4) return false;
  // Thursday closes at 4:00 pm AZ (16:00 AZ = 23:00 UTC)
  if (azDow === 4 && azNow.getUTCHours() >= 23) return false;
  return true;
}

function compositeScore(steps: number, waterGlasses: number, streak: number): number {
  return steps + waterGlasses * 200 + streak * 500;
}

// ─── Upsert ───────────────────────────────────────────────────────────────────

/**
 * Write (or overwrite) the current user's stats for today.
 * Safe to call on every focus — upserts on (user_id, stat_date).
 * Automatically sets challenge_week when inside the Tue–Thu AZ window.
 */
export async function upsertMyStats(
  steps: number,
  waterGlasses: number,
  streak: number,
  displayName?: string,
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const name = (user.user_metadata?.display_name as string | undefined)?.trim()
    || displayName?.trim()
    || 'Anonymous';

  // Only tag the row with challenge_week during the active Tue–Thu window.
  const challengeWeek = isActive3DayWindow() ? mostRecentTuesdayAZ() : null;

  await supabase
    .from('ww_daily_stats')
    .upsert(
      {
        user_id: user.id,
        stat_date: localDateString(),
        steps,
        water_glasses: waterGlasses,
        streak,
        display_name: name,
        challenge_week: challengeWeek,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,stat_date' },
    );
}

// ─── Shared aggregation helper ────────────────────────────────────────────────

type RawRow = {
  user_id: string;
  steps: number;
  water_glasses: number;
  streak: number;
  display_name: string | null;
  updated_at: string;
};

function aggregateRows(
  rows: RawRow[],
  myUserId: string | undefined,
): LeaderboardEntry[] {
  const byUser = new Map<string, Omit<LeaderboardEntry, 'score'>>();

  for (const row of rows) {
    const existing = byUser.get(row.user_id);
    if (existing) {
      existing.steps += row.steps;
      existing.waterGlasses += row.water_glasses;
      existing.streak = Math.max(existing.streak, row.streak);
    } else {
      byUser.set(row.user_id, {
        userId: row.user_id,
        steps: row.steps,
        waterGlasses: row.water_glasses,
        streak: row.streak,
        username: row.display_name?.trim() || 'Anonymous',
        isMe: row.user_id === myUserId,
      });
    }
  }

  return [...byUser.values()]
    .map((e) => ({ ...e, score: compositeScore(e.steps, e.waterGlasses, e.streak) }))
    .sort((a, b) => b.score - a.score);
}

// ─── Fetch: global (all-time) ─────────────────────────────────────────────────

/**
 * Fetch the all-time global leaderboard — every day, every user.
 * Aggregates by user: total steps, total water, best streak.
 * Ranked by composite score.
 *
 * Uses getSession() (local cache) instead of getUser() (network request)
 * so this never throws due to an auth timing issue after sign-in.
 */
export async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  const { data: { session } } = await supabase.auth.getSession();

  const { data, error } = await supabase
    .from('ww_daily_stats')
    .select('user_id, steps, water_glasses, streak, display_name, updated_at')
    .order('updated_at', { ascending: false });

  if (error) {
    console.warn('[Leaderboard] fetchLeaderboard error:', error.message);
    return [];
  }
  return aggregateRows((data ?? []) as RawRow[], session?.user?.id);
}

// ─── Fetch: 3-day challenge week ──────────────────────────────────────────────

/**
 * Fetch the 3-day challenge leaderboard for the most recent Tue–Thu window.
 * During the active challenge (Tue–Thu) this shows the live board.
 * After the challenge (Fri–Mon) this shows last week's final results.
 * Returns [] when no rows exist for that week yet.
 */
export async function fetch3DayLeaderboard(): Promise<LeaderboardEntry[]> {
  const { data: { session } } = await supabase.auth.getSession();
  const tuesday = mostRecentTuesdayAZ();

  // Derive Thursday (tuesday + 2 days) for the date range.
  const tuesdayMs = new Date(`${tuesday}T12:00:00Z`).getTime();
  const thursday = new Date(tuesdayMs + 2 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  // Query by stat_date range instead of challenge_week so rows logged before
  // challenge_week was stamped (e.g. first day, OTA timing) are still counted.
  const { data, error } = await supabase
    .from('ww_daily_stats')
    .select('user_id, steps, water_glasses, streak, display_name, updated_at')
    .gte('stat_date', tuesday)
    .lte('stat_date', thursday)
    .order('updated_at', { ascending: false });

  if (error) {
    console.warn('[Leaderboard] fetch3DayLeaderboard error:', error.message);
    return [];
  }
  return aggregateRows((data ?? []) as RawRow[], session?.user?.id);
}
