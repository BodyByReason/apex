create extension if not exists pgcrypto;

create table if not exists public.tribe_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  badge_type text not null check (badge_type in ('pr', 'q', 'tip', 'win')),
  content text not null,
  like_count integer not null default 0 check (like_count >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.tribe_posts
  add column if not exists user_id uuid,
  add column if not exists badge_type text,
  add column if not exists content text,
  add column if not exists like_count integer default 0,
  add column if not exists created_at timestamptz default timezone('utc', now()),
  add column if not exists updated_at timestamptz default timezone('utc', now());

update public.tribe_posts
set
  badge_type = coalesce(badge_type, 'win'),
  content = coalesce(content, ''),
  like_count = coalesce(like_count, 0),
  created_at = coalesce(created_at, timezone('utc', now())),
  updated_at = coalesce(updated_at, timezone('utc', now()))
where
  badge_type is null
  or content is null
  or like_count is null
  or created_at is null
  or updated_at is null;

alter table public.tribe_posts
  alter column badge_type set not null,
  alter column content set not null,
  alter column like_count set default 0,
  alter column like_count set not null,
  alter column created_at set default timezone('utc', now()),
  alter column created_at set not null,
  alter column updated_at set default timezone('utc', now()),
  alter column updated_at set not null;

create index if not exists tribe_posts_created_at_idx on public.tribe_posts (created_at desc);
create index if not exists tribe_posts_user_id_idx on public.tribe_posts (user_id);

create table if not exists public.tribe_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.tribe_posts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  content text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.tribe_comments
  add column if not exists post_id uuid,
  add column if not exists user_id uuid,
  add column if not exists content text,
  add column if not exists created_at timestamptz default timezone('utc', now()),
  add column if not exists updated_at timestamptz default timezone('utc', now());

update public.tribe_comments
set
  content = coalesce(content, ''),
  created_at = coalesce(created_at, timezone('utc', now())),
  updated_at = coalesce(updated_at, timezone('utc', now()))
where
  content is null
  or created_at is null
  or updated_at is null;

alter table public.tribe_comments
  alter column content set not null,
  alter column created_at set default timezone('utc', now()),
  alter column created_at set not null,
  alter column updated_at set default timezone('utc', now()),
  alter column updated_at set not null;

create index if not exists tribe_comments_post_id_idx on public.tribe_comments (post_id, created_at asc);
create index if not exists tribe_comments_user_id_idx on public.tribe_comments (user_id);

drop trigger if exists set_tribe_posts_updated_at on public.tribe_posts;
create trigger set_tribe_posts_updated_at
before update on public.tribe_posts
for each row
execute function public.set_updated_at();

drop trigger if exists set_tribe_comments_updated_at on public.tribe_comments;
create trigger set_tribe_comments_updated_at
before update on public.tribe_comments
for each row
execute function public.set_updated_at();

alter table public.tribe_posts enable row level security;
alter table public.tribe_comments enable row level security;

drop policy if exists "Authenticated read tribe posts" on public.tribe_posts;
create policy "Authenticated read tribe posts"
  on public.tribe_posts for select
  using (auth.uid() is not null);

drop policy if exists "Insert own tribe posts" on public.tribe_posts;
create policy "Insert own tribe posts"
  on public.tribe_posts for insert
  with check (auth.uid() = user_id);

drop policy if exists "Update own tribe posts" on public.tribe_posts;
create policy "Update own tribe posts"
  on public.tribe_posts for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Delete own tribe posts" on public.tribe_posts;
create policy "Delete own tribe posts"
  on public.tribe_posts for delete
  using (auth.uid() = user_id);

drop policy if exists "Authenticated read tribe comments" on public.tribe_comments;
create policy "Authenticated read tribe comments"
  on public.tribe_comments for select
  using (auth.uid() is not null);

drop policy if exists "Insert own tribe comments" on public.tribe_comments;
create policy "Insert own tribe comments"
  on public.tribe_comments for insert
  with check (auth.uid() = user_id);

drop policy if exists "Delete own tribe comments" on public.tribe_comments;
create policy "Delete own tribe comments"
  on public.tribe_comments for delete
  using (auth.uid() = user_id);
