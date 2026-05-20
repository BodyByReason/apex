create extension if not exists pgcrypto;

alter table public.profiles
  add column if not exists coach_id uuid references auth.users (id) on delete set null,
  add column if not exists is_coach boolean default false,
  add column if not exists coach_bio text,
  add column if not exists created_at timestamptz default timezone('utc', now()),
  add column if not exists updated_at timestamptz default timezone('utc', now());

update public.profiles
set
  created_at = coalesce(created_at, timezone('utc', now())),
  updated_at = coalesce(updated_at, timezone('utc', now()))
where
  created_at is null
  or updated_at is null;

alter table public.profiles
  alter column created_at set default timezone('utc', now()),
  alter column updated_at set default timezone('utc', now());

create index if not exists profiles_coach_id_idx on public.profiles (coach_id);

create table if not exists public.coach_invites (
  id uuid primary key default gen_random_uuid(),
  coach_user_id uuid not null references auth.users (id) on delete cascade,
  code text not null unique,
  status text not null default 'active' check (status in ('active', 'redeemed', 'expired', 'cancelled')),
  expires_at timestamptz not null default timezone('utc', now()) + interval '7 days',
  redeemed_by_user_id uuid references auth.users (id) on delete set null,
  redeemed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists coach_invites_coach_user_id_idx on public.coach_invites (coach_user_id);
create index if not exists coach_invites_status_idx on public.coach_invites (status);

create table if not exists public.coach_client_links (
  id uuid primary key default gen_random_uuid(),
  coach_user_id uuid not null references auth.users (id) on delete cascade,
  client_user_id uuid not null unique references auth.users (id) on delete cascade,
  package_id text,
  duration_id text,
  session_type text check (session_type in ('1on1', 'group', 'mobility')),
  start_date date,
  next_session timestamptz,
  total_sessions integer not null default 0,
  completed_sessions integer not null default 0,
  notes text,
  bonus jsonb not null default '{"extraSessionsTotal":0,"extraSessionsUsed":0,"extraSessionType":"1on1","gifts":[]}'::jsonb,
  status text not null default 'linked' check (status in ('linked', 'active', 'paused', 'cancelled', 'completed')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists coach_client_links_coach_user_id_idx on public.coach_client_links (coach_user_id);
create index if not exists coach_client_links_status_idx on public.coach_client_links (status);

drop trigger if exists set_coach_invites_updated_at on public.coach_invites;
create trigger set_coach_invites_updated_at
before update on public.coach_invites
for each row execute procedure public.set_updated_at();

drop trigger if exists set_coach_client_links_updated_at on public.coach_client_links;
create trigger set_coach_client_links_updated_at
before update on public.coach_client_links
for each row execute procedure public.set_updated_at();

alter table public.coach_invites enable row level security;
alter table public.coach_client_links enable row level security;

drop policy if exists "Coach own invites select" on public.coach_invites;
create policy "Coach own invites select"
  on public.coach_invites for select
  using (auth.uid() = coach_user_id);

drop policy if exists "Coach own invites insert" on public.coach_invites;
create policy "Coach own invites insert"
  on public.coach_invites for insert
  with check (auth.uid() = coach_user_id);

drop policy if exists "Coach own invites update" on public.coach_invites;
create policy "Coach own invites update"
  on public.coach_invites for update
  using (auth.uid() = coach_user_id)
  with check (auth.uid() = coach_user_id);

drop policy if exists "Coach client links select" on public.coach_client_links;
create policy "Coach client links select"
  on public.coach_client_links for select
  using (auth.uid() = coach_user_id or auth.uid() = client_user_id);

drop policy if exists "Coach client links insert" on public.coach_client_links;
create policy "Coach client links insert"
  on public.coach_client_links for insert
  with check (auth.uid() = coach_user_id or auth.uid() = client_user_id);

drop policy if exists "Coach client links update" on public.coach_client_links;
create policy "Coach client links update"
  on public.coach_client_links for update
  using (auth.uid() = coach_user_id or auth.uid() = client_user_id)
  with check (auth.uid() = coach_user_id or auth.uid() = client_user_id);

create or replace function public.create_coach_invite(p_expires_in_hours integer default 168)
returns table (id uuid, code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  generated_code text;
  invite_row public.coach_invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  generated_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.coach_invites (
    coach_user_id,
    code,
    expires_at
  )
  values (
    auth.uid(),
    generated_code,
    timezone('utc', now()) + make_interval(hours => greatest(p_expires_in_hours, 1))
  )
  returning * into invite_row;

  return query
  select invite_row.id, invite_row.code, invite_row.expires_at;
end;
$$;

create or replace function public.get_my_coach_invites()
returns table (
  id uuid,
  code text,
  status text,
  expires_at timestamptz,
  redeemed_by_user_id uuid,
  redeemed_at timestamptz,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    ci.id,
    ci.code,
    ci.status,
    ci.expires_at,
    ci.redeemed_by_user_id,
    ci.redeemed_at,
    ci.created_at
  from public.coach_invites ci
  where ci.coach_user_id = auth.uid()
  order by ci.created_at desc;
$$;

create or replace function public.redeem_coach_invite(p_code text)
returns table (
  coach_user_id uuid,
  coach_display_name text,
  coach_username text,
  coach_avatar_url text,
  coach_selected_title text,
  coach_bio text,
  coach_is_coach boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  invite_row public.coach_invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select *
  into invite_row
  from public.coach_invites
  where upper(code) = upper(trim(p_code))
    and status = 'active'
  order by created_at desc
  limit 1;

  if invite_row.id is null then
    raise exception 'Invite code not found or already used';
  end if;

  if invite_row.expires_at <= timezone('utc', now()) then
    update public.coach_invites
    set status = 'expired'
    where id = invite_row.id;
    raise exception 'Invite code has expired';
  end if;

  if invite_row.coach_user_id = auth.uid() then
    raise exception 'You cannot redeem your own coach invite';
  end if;

  update public.coach_invites
  set
    status = 'redeemed',
    redeemed_by_user_id = auth.uid(),
    redeemed_at = timezone('utc', now())
  where id = invite_row.id;

  update public.profiles
  set coach_id = invite_row.coach_user_id
  where user_id = auth.uid();

  insert into public.coach_client_links (
    coach_user_id,
    client_user_id,
    status
  )
  values (
    invite_row.coach_user_id,
    auth.uid(),
    'linked'
  )
  on conflict (client_user_id) do update
  set
    coach_user_id = excluded.coach_user_id,
    status = 'linked',
    updated_at = timezone('utc', now());

  return query
  select
    p.user_id,
    coalesce(nullif(p.display_name, ''), p.username, 'Coach') as coach_display_name,
    p.username,
    p.avatar_url,
    p.selected_title,
    p.coach_bio,
    coalesce(p.is_coach, false)
  from public.profiles p
  where p.user_id = invite_row.coach_user_id;
end;
$$;

create or replace function public.get_my_linked_coach()
returns table (
  coach_user_id uuid,
  coach_display_name text,
  coach_username text,
  coach_avatar_url text,
  coach_selected_title text,
  coach_bio text,
  coach_is_coach boolean
)
language sql
security definer
set search_path = public
as $$
  select
    p.user_id,
    coalesce(nullif(p.display_name, ''), p.username, 'Coach') as coach_display_name,
    p.username,
    p.avatar_url,
    p.selected_title,
    p.coach_bio,
    coalesce(p.is_coach, false)
  from public.profiles me
  join public.profiles p on p.user_id = me.coach_id
  where me.user_id = auth.uid();
$$;

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
  link_status text
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
    coalesce(l.status, 'linked') as link_status
  from public.profiles p
  left join public.coach_client_links l
    on l.client_user_id = p.user_id
   and l.coach_user_id = auth.uid()
  left join auth.users au
    on au.id = p.user_id
  where p.coach_id = auth.uid()
  order by coalesce(l.updated_at, p.created_at, p.updated_at, timezone('utc', now())) desc;
$$;

grant execute on function public.create_coach_invite(integer) to authenticated;
grant execute on function public.get_my_coach_invites() to authenticated;
grant execute on function public.redeem_coach_invite(text) to authenticated;
grant execute on function public.get_my_linked_coach() to authenticated;
grant execute on function public.get_my_coach_clients() to authenticated;
