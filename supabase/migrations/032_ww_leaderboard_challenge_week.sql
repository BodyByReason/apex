-- Walk & Water leaderboard — add challenge_week for 3-day board filtering.
--
-- Rows written during an active 3-day challenge window (Tue–Thu Arizona time)
-- carry the Tuesday date of that week so they can be queried as a cohort.
-- Off-cycle rows (Fri–Mon) and longer-challenge rows carry NULL, meaning they
-- count toward the global all-time board only.

alter table public.ww_daily_stats
  add column if not exists challenge_week date;

-- Sparse index — only indexes non-null rows (the Tue–Thu challenge days).
create index if not exists ww_daily_stats_challenge_week_idx
  on public.ww_daily_stats (challenge_week)
  where challenge_week is not null;
