-- Walk & Water Challenge leaderboard
-- Each user has one row per calendar date storing their best stats for that day.
-- Users can only write their own rows but can read all rows (for the leaderboard).

create table if not exists public.ww_daily_stats (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  stat_date   date not null default current_date,
  steps       integer not null default 0 check (steps >= 0),
  water_glasses integer not null default 0 check (water_glasses >= 0),
  streak      integer not null default 0 check (streak >= 0),
  updated_at  timestamptz not null default timezone('utc', now()),
  unique (user_id, stat_date)
);

-- Index for leaderboard queries (latest date per user)
create index if not exists ww_daily_stats_date_idx on public.ww_daily_stats (stat_date desc);

-- RLS
alter table public.ww_daily_stats enable row level security;

-- Anyone authenticated can read all rows (leaderboard is public within the challenge)
create policy "ww_daily_stats: authenticated read"
  on public.ww_daily_stats for select
  to authenticated
  using (true);

-- Users can only insert/update their own rows
create policy "ww_daily_stats: own insert"
  on public.ww_daily_stats for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "ww_daily_stats: own update"
  on public.ww_daily_stats for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
