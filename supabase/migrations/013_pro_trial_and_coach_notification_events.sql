alter table public.profiles
  add column if not exists pro_trial_started_at timestamptz,
  add column if not exists pro_trial_ends_at timestamptz;

create table if not exists public.coach_notification_events (
  id uuid primary key default gen_random_uuid(),
  coach_user_id uuid not null,
  client_user_id uuid,
  type text not null default 'live_coaching_purchase',
  title text not null,
  body text not null,
  email_body text,
  sms_body text,
  delivered_email_at timestamptz,
  delivered_sms_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.coach_notification_events enable row level security;

drop policy if exists "Coach notification events select" on public.coach_notification_events;
create policy "Coach notification events select"
  on public.coach_notification_events
  for select
  using (coach_user_id = auth.uid());

drop policy if exists "Coach notification events insert" on public.coach_notification_events;
create policy "Coach notification events insert"
  on public.coach_notification_events
  for insert
  with check (auth.uid() is not null);

create index if not exists coach_notification_events_coach_created_idx
  on public.coach_notification_events (coach_user_id, created_at desc);
