create extension if not exists pgcrypto;

create table if not exists public.live_coaching_sessions (
  id uuid primary key default gen_random_uuid(),
  coach_user_id uuid not null references auth.users (id) on delete cascade,
  client_user_id uuid not null references auth.users (id) on delete cascade,
  coach_client_link_id uuid references public.coach_client_links (id) on delete set null,

  zoom_meeting_id text,
  zoom_meeting_uuid text,
  zoom_join_url text,
  zoom_start_url text,

  status text not null default 'scheduled'
    check (status in ('scheduled', 'live', 'completed', 'canceled', 'failed')),

  scheduled_start timestamptz,
  actual_start timestamptz,
  actual_end timestamptz,
  duration_minutes integer check (duration_minutes is null or duration_minutes >= 0),

  scheduled_via text
    check (scheduled_via in ('same_time_next_week', 'custom_time', 'instant')),

  celebration_shown boolean not null default false,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),

  constraint live_coaching_sessions_end_after_start_chk
    check (actual_end is null or actual_start is null or actual_end >= actual_start)
);

create index if not exists live_coaching_sessions_coach_start_idx
  on public.live_coaching_sessions (coach_user_id, scheduled_start desc);

create index if not exists live_coaching_sessions_client_start_idx
  on public.live_coaching_sessions (client_user_id, scheduled_start desc);

create index if not exists live_coaching_sessions_link_idx
  on public.live_coaching_sessions (coach_client_link_id);

create unique index if not exists live_coaching_sessions_one_open_per_pair_idx
  on public.live_coaching_sessions (coach_user_id, client_user_id)
  where status in ('scheduled', 'live');

drop trigger if exists set_live_coaching_sessions_updated_at on public.live_coaching_sessions;
create trigger set_live_coaching_sessions_updated_at
before update on public.live_coaching_sessions
for each row execute function public.set_updated_at();

create table if not exists public.zoom_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  zoom_user_id text not null,
  zoom_account_id text,
  app_type text not null
    check (app_type in ('oauth_user', 'oauth_s2s')),
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  scopes text[],
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists zoom_connections_user_idx
  on public.zoom_connections (user_id);

drop trigger if exists set_zoom_connections_updated_at on public.zoom_connections;
create trigger set_zoom_connections_updated_at
before update on public.zoom_connections
for each row execute function public.set_updated_at();

alter table public.coach_client_links
  add column if not exists live_coaching_count integer not null default 0,
  add column if not exists last_live_session_at timestamptz;

create table if not exists public.user_achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  achievement_code text not null,
  earned_at timestamptz not null default timezone('utc', now()),
  context jsonb not null default '{}'::jsonb
);

create unique index if not exists user_achievements_unique
  on public.user_achievements (user_id, achievement_code);

create index if not exists user_achievements_user_earned_idx
  on public.user_achievements (user_id, earned_at desc);

create table if not exists public.workout_exercise_logs (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references public.workouts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  exercise_name text not null,
  set_number integer not null check (set_number > 0),
  reps integer,
  weight_lbs numeric,
  completed_at timestamptz,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists workout_exercise_logs_user_date_idx
  on public.workout_exercise_logs (user_id, completed_at desc);

create index if not exists workout_exercise_logs_workout_idx
  on public.workout_exercise_logs (workout_id);

drop trigger if exists set_workout_exercise_logs_updated_at on public.workout_exercise_logs;
create trigger set_workout_exercise_logs_updated_at
before update on public.workout_exercise_logs
for each row execute function public.set_updated_at();

create or replace function public.award_achievement(
  p_user_id uuid,
  p_achievement_code text,
  p_context jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null and auth.role() <> 'service_role' then
    raise exception 'Authentication required';
  end if;

  if auth.role() <> 'service_role' and auth.uid() <> p_user_id then
    raise exception 'Not allowed to award achievements for another user';
  end if;

  insert into public.user_achievements (
    user_id,
    achievement_code,
    context
  )
  values (
    p_user_id,
    p_achievement_code,
    coalesce(p_context, '{}'::jsonb)
  )
  on conflict (user_id, achievement_code) do nothing;
end;
$$;

create or replace function public.complete_live_coaching_session(
  p_session_id uuid
)
returns table (
  coach_user_id uuid,
  client_user_id uuid,
  live_count integer,
  duration_minutes integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  l_session public.live_coaching_sessions%rowtype;
  l_now_utc timestamptz := timezone('utc', now());
  l_duration integer;
begin
  select *
    into l_session
    from public.live_coaching_sessions
   where id = p_session_id
   for update;

  if l_session.id is null then
    raise exception 'Live coaching session not found: %', p_session_id;
  end if;

  if auth.uid() is null and auth.role() <> 'service_role' then
    raise exception 'Authentication required';
  end if;

  if auth.role() <> 'service_role'
     and auth.uid() <> l_session.coach_user_id
     and auth.uid() <> l_session.client_user_id then
    raise exception 'Not allowed to complete this live coaching session';
  end if;

  if l_session.status = 'completed' then
    coach_user_id := l_session.coach_user_id;
    client_user_id := l_session.client_user_id;
    duration_minutes := l_session.duration_minutes;
    live_count := (
      select ccl.live_coaching_count
        from public.coach_client_links ccl
       where ccl.id = l_session.coach_client_link_id
    );
    return next;
    return;
  end if;

  if l_session.actual_start is null then
    raise exception 'Live coaching session % has no actual_start', p_session_id;
  end if;

  l_duration := greatest(
    0,
    floor(extract(epoch from (l_now_utc - l_session.actual_start)) / 60)
  )::integer;

  update public.live_coaching_sessions
     set status = 'completed',
         actual_end = l_now_utc,
         duration_minutes = l_duration,
         updated_at = l_now_utc
   where id = p_session_id;

  update public.coach_client_links
     set live_coaching_count = live_coaching_count + 1,
         last_live_session_at = l_now_utc,
         updated_at = l_now_utc
   where id = l_session.coach_client_link_id
   returning public.coach_client_links.live_coaching_count
        into live_count;

  coach_user_id := l_session.coach_user_id;
  client_user_id := l_session.client_user_id;
  duration_minutes := l_duration;

  return next;
end;
$$;

drop function if exists public.get_my_coach_clients();

create or replace function public.get_my_coach_clients()
returns table (
  user_id uuid,
  username text,
  display_name text,
  avatar_url text,
  email text,
  goal text,
  experience text,
  active_plan_id text,
  weight_lbs integer,
  goal_weight_lbs integer,
  age integer,
  daily_calorie_target integer,
  daily_protein integer,
  health_conditions text,
  medications text,
  equipment text,
  package_id text,
  duration_id text,
  session_type text,
  start_date date,
  next_session timestamptz,
  total_sessions integer,
  completed_sessions integer,
  notes text,
  bonus jsonb,
  link_status text,
  session_schedule jsonb,
  session_attendance jsonb,
  recurrence_preference text,
  live_coaching_count integer,
  last_live_session_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    p.user_id,
    p.username,
    p.display_name,
    p.avatar_url,
    au.email::text,
    p.goal,
    p.experience,
    p.active_plan_id,
    case when nullif(trim(p.weight_lbs), '') is null then null else round((p.weight_lbs)::numeric)::integer end,
    case when nullif(trim(p.goal_weight_lbs), '') is null then null else round((p.goal_weight_lbs)::numeric)::integer end,
    case when nullif(trim(p.age), '') is null then null else round((p.age)::numeric)::integer end,
    p.daily_calorie_target::integer,
    p.daily_protein::integer,
    case
      when p.health_conditions is null then null
      when pg_typeof(p.health_conditions)::text = 'text[]' then array_to_string(p.health_conditions, ', ')
      else p.health_conditions::text
    end,
    p.medications,
    case
      when p.equipment is null then null
      when pg_typeof(p.equipment)::text = 'text[]' then array_to_string(p.equipment, ', ')
      else p.equipment::text
    end,
    l.package_id,
    l.duration_id,
    l.session_type,
    l.start_date,
    l.next_session,
    coalesce(l.total_sessions, 0),
    coalesce(l.completed_sessions, 0),
    l.notes,
    coalesce(l.bonus, '{"extraSessionsTotal":0,"extraSessionsUsed":0,"extraSessionType":"1on1","gifts":[]}'::jsonb),
    coalesce(l.status, 'linked') as link_status,
    coalesce(l.session_schedule, '[]'::jsonb),
    coalesce(l.session_attendance, '[]'::jsonb),
    l.recurrence_preference,
    coalesce(l.live_coaching_count, 0),
    l.last_live_session_at
  from public.profiles p
  left join public.coach_client_links l
    on l.client_user_id = p.user_id
   and l.coach_user_id = auth.uid()
  left join auth.users au
    on au.id = p.user_id
  where p.coach_id = auth.uid()
  order by coalesce(l.updated_at, p.created_at) desc;
$$;

revoke all on function public.award_achievement(uuid, text, jsonb) from public;
grant execute on function public.award_achievement(uuid, text, jsonb) to authenticated;

revoke all on function public.complete_live_coaching_session(uuid) from public;
grant execute on function public.complete_live_coaching_session(uuid) to authenticated;

grant execute on function public.get_my_coach_clients() to authenticated;

alter table public.live_coaching_sessions enable row level security;
alter table public.zoom_connections enable row level security;
alter table public.user_achievements enable row level security;
alter table public.workout_exercise_logs enable row level security;

drop policy if exists "Live coaching sessions select" on public.live_coaching_sessions;
create policy "Live coaching sessions select"
  on public.live_coaching_sessions for select
  using (auth.uid() = coach_user_id or auth.uid() = client_user_id);

drop policy if exists "Live coaching sessions insert" on public.live_coaching_sessions;
create policy "Live coaching sessions insert"
  on public.live_coaching_sessions for insert
  with check (
    auth.uid() = coach_user_id
    or auth.uid() = client_user_id
    or auth.role() = 'service_role'
  );

drop policy if exists "Live coaching sessions update" on public.live_coaching_sessions;
create policy "Live coaching sessions update"
  on public.live_coaching_sessions for update
  using (auth.uid() = coach_user_id or auth.uid() = client_user_id or auth.role() = 'service_role')
  with check (auth.uid() = coach_user_id or auth.uid() = client_user_id or auth.role() = 'service_role');

drop policy if exists "Zoom connections service role full access" on public.zoom_connections;
create policy "Zoom connections service role full access"
  on public.zoom_connections for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "User achievements select own" on public.user_achievements;
create policy "User achievements select own"
  on public.user_achievements for select
  using (auth.uid() = user_id);

drop policy if exists "User achievements insert service role" on public.user_achievements;
create policy "User achievements insert service role"
  on public.user_achievements for insert
  with check (auth.role() = 'service_role' or auth.uid() = user_id);

drop policy if exists "Workout exercise logs own select" on public.workout_exercise_logs;
create policy "Workout exercise logs own select"
  on public.workout_exercise_logs for select
  using (
    auth.uid() = user_id
    or exists (
      select 1
        from public.coach_client_links ccl
       where ccl.client_user_id = workout_exercise_logs.user_id
         and ccl.coach_user_id = auth.uid()
         and ccl.status in ('active', 'linked')
    )
  );

drop policy if exists "Workout exercise logs own insert" on public.workout_exercise_logs;
create policy "Workout exercise logs own insert"
  on public.workout_exercise_logs for insert
  with check (auth.uid() = user_id);

drop policy if exists "Workout exercise logs own update" on public.workout_exercise_logs;
create policy "Workout exercise logs own update"
  on public.workout_exercise_logs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Workout exercise logs own delete" on public.workout_exercise_logs;
create policy "Workout exercise logs own delete"
  on public.workout_exercise_logs for delete
  using (auth.uid() = user_id);

drop policy if exists "Coach can read linked client workouts" on public.workouts;
create policy "Coach can read linked client workouts"
  on public.workouts for select
  using (
    auth.uid() = user_id
    or exists (
      select 1
        from public.coach_client_links ccl
       where ccl.client_user_id = workouts.user_id
         and ccl.coach_user_id = auth.uid()
         and ccl.status in ('active', 'linked')
    )
  );
