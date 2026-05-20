create extension if not exists pgcrypto;

create table if not exists public.demo_assets (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  coach_label text not null,
  exercise_name text not null,
  asset_kind text not null check (asset_kind in ('reference', 'video')),
  status text not null default 'candidate' check (status in ('candidate', 'approved', 'archived')),
  prompt text,
  image_url text,
  video_url text,
  request_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists demo_assets_lookup_idx
  on public.demo_assets (coach_label, exercise_name, asset_kind, status, created_at desc);

create or replace function public.set_demo_assets_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_demo_assets_updated_at on public.demo_assets;
create trigger set_demo_assets_updated_at
before update on public.demo_assets
for each row execute procedure public.set_demo_assets_updated_at();

alter table public.demo_assets enable row level security;

drop policy if exists "Demo assets owner select" on public.demo_assets;
create policy "Demo assets owner select"
on public.demo_assets
for select
using (auth.uid() = created_by);

drop policy if exists "Demo assets owner insert" on public.demo_assets;
create policy "Demo assets owner insert"
on public.demo_assets
for insert
with check (auth.uid() = created_by);

drop policy if exists "Demo assets owner update" on public.demo_assets;
create policy "Demo assets owner update"
on public.demo_assets
for update
using (auth.uid() = created_by)
with check (auth.uid() = created_by);

insert into storage.buckets (id, name, public)
values ('demo-reference-assets', 'demo-reference-assets', true)
on conflict (id) do nothing;
