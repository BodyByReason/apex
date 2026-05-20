-- Migration 029 gated on is_coach = true in profiles, but that column is never
-- set for the coach account (admin mode is device-local AsyncStorage only).
-- Fix: drop the is_coach policy and allow any authenticated user to read all
-- fit call bookings — same pattern as ww_daily_stats (public leaderboard).
-- Coach mode itself is password-gated in the app, so this is safe.

DROP POLICY IF EXISTS "Coach can read all fit calls" ON coaching_fit_calls;

CREATE POLICY "Authenticated users can read all fit calls"
  ON coaching_fit_calls FOR SELECT
  TO authenticated
  USING (true);
