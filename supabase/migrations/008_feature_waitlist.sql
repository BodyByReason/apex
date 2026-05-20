create extension if not exists pgcrypto;

create table if not exists public.feature_waitlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  feature_key text not null,
  feature_name text not null,
  source text,
  created_at timestamptz not null default timezone('utc', now()),
  unique (user_id, feature_key)
);

alter table public.feature_waitlist enable row level security;

drop policy if exists "Users can view own waitlist rows" on public.feature_waitlist;
create policy "Users can view own waitlist rows"
on public.feature_waitlist
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own waitlist rows" on public.feature_waitlist;
create policy "Users can insert own waitlist rows"
on public.feature_waitlist
for insert
with check (auth.uid() = user_id);
