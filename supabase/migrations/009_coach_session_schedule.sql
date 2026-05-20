alter table public.coach_client_links
  add column if not exists session_schedule jsonb not null default '[]'::jsonb,
  add column if not exists recurrence_preference text;

alter table public.coach_client_links
  drop constraint if exists coach_client_links_recurrence_preference_check;

alter table public.coach_client_links
  add constraint coach_client_links_recurrence_preference_check
  check (recurrence_preference in ('monthly_fixed', 'change_next_week', 'schedule_later') or recurrence_preference is null);

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
  recurrence_preference text
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
    l.recurrence_preference
  from public.profiles p
  left join public.coach_client_links l
    on l.client_user_id = p.user_id
   and l.coach_user_id = auth.uid()
  left join auth.users au
    on au.id = p.user_id
  where p.coach_id = auth.uid()
  order by coalesce(l.updated_at, p.created_at) desc;
$$;

grant execute on function public.get_my_coach_clients() to authenticated;
