create extension if not exists pgcrypto;

create table if not exists public.suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  status text not null default 'open' check (status in ('open', 'planned', 'shipped')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.suggestion_votes (
  id uuid primary key default gen_random_uuid(),
  suggestion_id uuid not null references public.suggestions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  constraint suggestion_votes_unique unique (suggestion_id, user_id)
);

create index if not exists suggestions_created_at_idx on public.suggestions (created_at desc);
create index if not exists suggestions_user_id_idx on public.suggestions (user_id);
create index if not exists suggestion_votes_suggestion_id_idx on public.suggestion_votes (suggestion_id);
create index if not exists suggestion_votes_user_id_idx on public.suggestion_votes (user_id);

drop trigger if exists set_suggestions_updated_at on public.suggestions;
create trigger set_suggestions_updated_at
before update on public.suggestions
for each row
execute function public.set_updated_at();

alter table public.suggestions enable row level security;
alter table public.suggestion_votes enable row level security;

drop policy if exists "Public read suggestions" on public.suggestions;
create policy "Public read suggestions"
  on public.suggestions for select
  using (true);

drop policy if exists "Insert own suggestions" on public.suggestions;
create policy "Insert own suggestions"
  on public.suggestions for insert
  with check (auth.uid() = user_id);

drop policy if exists "Update own suggestions" on public.suggestions;
create policy "Update own suggestions"
  on public.suggestions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Delete own suggestions" on public.suggestions;
create policy "Delete own suggestions"
  on public.suggestions for delete
  using (auth.uid() = user_id);

drop policy if exists "Public read suggestion votes" on public.suggestion_votes;
create policy "Public read suggestion votes"
  on public.suggestion_votes for select
  using (true);

drop policy if exists "Insert own suggestion votes" on public.suggestion_votes;
create policy "Insert own suggestion votes"
  on public.suggestion_votes for insert
  with check (auth.uid() = user_id);

drop policy if exists "Delete own suggestion votes" on public.suggestion_votes;
create policy "Delete own suggestion votes"
  on public.suggestion_votes for delete
  using (auth.uid() = user_id);
