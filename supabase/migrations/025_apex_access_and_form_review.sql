alter table public.coach_client_links
  add column if not exists app_access text not null default 'ww' check (app_access in ('ww', 'apex')),
  add column if not exists origin_flow text check (origin_flow in ('ww_upgrade', 'client_migration'));

create index if not exists coach_client_links_app_access_idx
  on public.coach_client_links (app_access);

create table if not exists public.apex_access_links (
  id uuid primary key default gen_random_uuid(),
  coach_user_id uuid not null references auth.users (id) on delete cascade,
  target_user_id uuid references auth.users (id) on delete set null,
  token text not null unique,
  flow_type text not null check (flow_type in ('ww_upgrade', 'client_migration')),
  status text not null default 'pending' check (status in ('pending', 'claimed', 'expired', 'cancelled')),
  metadata jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null default timezone('utc', now()) + interval '30 days',
  claimed_by_user_id uuid references auth.users (id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists apex_access_links_coach_user_id_idx
  on public.apex_access_links (coach_user_id);

create index if not exists apex_access_links_status_idx
  on public.apex_access_links (status);

drop trigger if exists set_apex_access_links_updated_at on public.apex_access_links;
create trigger set_apex_access_links_updated_at
before update on public.apex_access_links
for each row execute procedure public.set_updated_at();

alter table public.apex_access_links enable row level security;

drop policy if exists "Coach can manage own apex access links" on public.apex_access_links;
create policy "Coach can manage own apex access links"
  on public.apex_access_links for all
  using (auth.uid() = coach_user_id)
  with check (auth.uid() = coach_user_id);

create or replace function public.claim_apex_access_link(p_token text)
returns table (
  app_access text,
  coach_user_id uuid,
  origin_flow text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  link_row public.apex_access_links%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select *
  into link_row
  from public.apex_access_links
  where token = trim(p_token)
    and status = 'pending'
  order by created_at desc
  limit 1;

  if link_row.id is null then
    raise exception 'Apex access link not found or already used';
  end if;

  if link_row.expires_at <= timezone('utc', now()) then
    update public.apex_access_links
    set status = 'expired'
    where id = link_row.id;
    raise exception 'Apex access link has expired';
  end if;

  if link_row.target_user_id is not null and link_row.target_user_id <> auth.uid() then
    raise exception 'This Apex access link was issued for a different account';
  end if;

  update public.apex_access_links
  set
    status = 'claimed',
    claimed_by_user_id = auth.uid(),
    claimed_at = timezone('utc', now())
  where id = link_row.id;

  insert into public.coach_client_links (
    coach_user_id,
    client_user_id,
    session_type,
    status,
    app_access,
    origin_flow,
    start_date
  )
  values (
    link_row.coach_user_id,
    auth.uid(),
    '1on1',
    'active',
    'apex',
    link_row.flow_type,
    current_date
  )
  on conflict (client_user_id) do update
  set
    coach_user_id = excluded.coach_user_id,
    session_type = coalesce(public.coach_client_links.session_type, '1on1'),
    status = 'active',
    app_access = 'apex',
    origin_flow = excluded.origin_flow,
    updated_at = timezone('utc', now());

  update public.profiles
  set coach_id = link_row.coach_user_id
  where user_id = auth.uid();

  return query
  select 'apex'::text, link_row.coach_user_id, link_row.flow_type;
end;
$$;

grant execute on function public.claim_apex_access_link(text) to authenticated;

create table if not exists public.form_review_clips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  coach_user_id uuid references auth.users (id) on delete set null,
  exercise_name text not null,
  storage_path text not null unique,
  video_url text not null,
  status text not null default 'submitted' check (status in ('submitted', 'reviewed', 'archived')),
  metadata jsonb not null default '{}'::jsonb,
  submitted_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists form_review_clips_user_id_idx
  on public.form_review_clips (user_id);

create index if not exists form_review_clips_coach_user_id_idx
  on public.form_review_clips (coach_user_id);

create index if not exists form_review_clips_submitted_at_idx
  on public.form_review_clips (submitted_at desc);

drop trigger if exists set_form_review_clips_updated_at on public.form_review_clips;
create trigger set_form_review_clips_updated_at
before update on public.form_review_clips
for each row execute procedure public.set_updated_at();

alter table public.form_review_clips enable row level security;

drop policy if exists "Users can read own form review clips" on public.form_review_clips;
create policy "Users can read own form review clips"
  on public.form_review_clips for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own form review clips" on public.form_review_clips;
create policy "Users can insert own form review clips"
  on public.form_review_clips for insert
  with check (auth.uid() = user_id);

drop policy if exists "Coach can read assigned form review clips" on public.form_review_clips;
create policy "Coach can read assigned form review clips"
  on public.form_review_clips for select
  using (auth.uid() = coach_user_id);

drop policy if exists "Coach can update assigned form review clips" on public.form_review_clips;
create policy "Coach can update assigned form review clips"
  on public.form_review_clips for update
  using (auth.uid() = coach_user_id)
  with check (auth.uid() = coach_user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'form-review-clips',
  'form-review-clips',
  true,
  262144000,
  array['video/mp4', 'video/webm', 'video/quicktime']
)
on conflict (id) do nothing;

drop policy if exists "public can read form review clips" on storage.objects;
create policy "public can read form review clips"
  on storage.objects for select
  using (bucket_id = 'form-review-clips');

drop policy if exists "authenticated users can upload form review clips" on storage.objects;
create policy "authenticated users can upload form review clips"
  on storage.objects for insert
  with check (bucket_id = 'form-review-clips' and auth.role() = 'authenticated');
