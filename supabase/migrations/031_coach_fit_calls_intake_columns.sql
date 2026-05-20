-- Add intake columns to coaching_fit_calls so the full DM booking context
-- is visible in the coach inbox thread. Previously only challenge/biggestChallenge
-- was saved; goal and diet_habits were lost (stored only in AsyncStorage on the
-- client's device). Both columns are nullable so existing rows are unaffected.

ALTER TABLE public.coaching_fit_calls
  ADD COLUMN IF NOT EXISTS goal       text,
  ADD COLUMN IF NOT EXISTS diet_habits text;
