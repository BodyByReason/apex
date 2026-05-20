alter table tribe_live_sessions
  add column if not exists coach_avatar_url text,
  add column if not exists started_at timestamptz not null default now();
