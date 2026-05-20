create extension if not exists "uuid-ossp";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  username text not null unique,
  avatar_url text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.workouts (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users (id) on delete cascade,
  workout_type text not null,
  duration_minutes integer not null check (duration_minutes >= 0),
  calories_burned integer not null default 0 check (calories_burned >= 0),
  workout_date date not null default current_date,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.workouts
  add column if not exists workout_type text,
  add column if not exists duration_minutes integer,
  add column if not exists calories_burned integer default 0,
  add column if not exists workout_date date default current_date,
  add column if not exists notes text,
  add column if not exists created_at timestamptz default timezone('utc', now()),
  add column if not exists updated_at timestamptz default timezone('utc', now());

update public.workouts
set
  workout_type = coalesce(workout_type, 'Workout'),
  duration_minutes = coalesce(duration_minutes, 0),
  calories_burned = coalesce(calories_burned, 0),
  workout_date = coalesce(workout_date, current_date),
  created_at = coalesce(created_at, timezone('utc', now())),
  updated_at = coalesce(updated_at, timezone('utc', now()))
where
  workout_type is null
  or duration_minutes is null
  or calories_burned is null
  or workout_date is null
  or created_at is null
  or updated_at is null;

alter table public.workouts
  alter column workout_type set not null,
  alter column duration_minutes set not null,
  alter column calories_burned set default 0,
  alter column calories_burned set not null,
  alter column workout_date set default current_date,
  alter column workout_date set not null,
  alter column created_at set default timezone('utc', now()),
  alter column created_at set not null,
  alter column updated_at set default timezone('utc', now()),
  alter column updated_at set not null;

create table if not exists public.nutrition_entries (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users (id) on delete cascade,
  meal_name text not null,
  calories integer not null default 0 check (calories >= 0),
  protein_grams numeric(8,2) not null default 0 check (protein_grams >= 0),
  carbs_grams numeric(8,2) not null default 0 check (carbs_grams >= 0),
  fat_grams numeric(8,2) not null default 0 check (fat_grams >= 0),
  consumed_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.nutrition_entries
  add column if not exists meal_name text,
  add column if not exists calories integer default 0,
  add column if not exists protein_grams numeric(8,2) default 0,
  add column if not exists carbs_grams numeric(8,2) default 0,
  add column if not exists fat_grams numeric(8,2) default 0,
  add column if not exists consumed_at timestamptz default timezone('utc', now()),
  add column if not exists created_at timestamptz default timezone('utc', now()),
  add column if not exists updated_at timestamptz default timezone('utc', now());

update public.nutrition_entries
set
  meal_name = coalesce(meal_name, 'Meal'),
  calories = coalesce(calories, 0),
  protein_grams = coalesce(protein_grams, 0),
  carbs_grams = coalesce(carbs_grams, 0),
  fat_grams = coalesce(fat_grams, 0),
  consumed_at = coalesce(consumed_at, timezone('utc', now())),
  created_at = coalesce(created_at, timezone('utc', now())),
  updated_at = coalesce(updated_at, timezone('utc', now()))
where
  meal_name is null
  or calories is null
  or protein_grams is null
  or carbs_grams is null
  or fat_grams is null
  or consumed_at is null
  or created_at is null
  or updated_at is null;

alter table public.nutrition_entries
  alter column meal_name set not null,
  alter column calories set default 0,
  alter column calories set not null,
  alter column protein_grams set default 0,
  alter column protein_grams set not null,
  alter column carbs_grams set default 0,
  alter column carbs_grams set not null,
  alter column fat_grams set default 0,
  alter column fat_grams set not null,
  alter column consumed_at set default timezone('utc', now()),
  alter column consumed_at set not null,
  alter column created_at set default timezone('utc', now()),
  alter column created_at set not null,
  alter column updated_at set default timezone('utc', now()),
  alter column updated_at set not null;

create table if not exists public.tribes (
  id uuid primary key default uuid_generate_v4(),
  creator_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.tribes
  add column if not exists creator_id uuid,
  add column if not exists name text,
  add column if not exists description text,
  add column if not exists created_at timestamptz default timezone('utc', now()),
  add column if not exists updated_at timestamptz default timezone('utc', now());

update public.tribes
set
  name = coalesce(name, 'Tribe'),
  created_at = coalesce(created_at, timezone('utc', now())),
  updated_at = coalesce(updated_at, timezone('utc', now()))
where
  name is null
  or created_at is null
  or updated_at is null;

alter table public.tribes
  alter column name set not null,
  alter column created_at set default timezone('utc', now()),
  alter column created_at set not null,
  alter column updated_at set default timezone('utc', now()),
  alter column updated_at set not null;

create table if not exists public.tribe_memberships (
  id uuid primary key default uuid_generate_v4(),
  tribe_id uuid not null references public.tribes (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint tribe_memberships_user_tribe_unique unique (tribe_id, user_id)
);

alter table public.tribe_memberships
  add column if not exists tribe_id uuid,
  add column if not exists user_id uuid,
  add column if not exists joined_at timestamptz default timezone('utc', now()),
  add column if not exists created_at timestamptz default timezone('utc', now()),
  add column if not exists updated_at timestamptz default timezone('utc', now());

update public.tribe_memberships
set
  joined_at = coalesce(joined_at, timezone('utc', now())),
  created_at = coalesce(created_at, timezone('utc', now())),
  updated_at = coalesce(updated_at, timezone('utc', now()))
where
  joined_at is null
  or created_at is null
  or updated_at is null;

alter table public.tribe_memberships
  alter column joined_at set default timezone('utc', now()),
  alter column joined_at set not null,
  alter column created_at set default timezone('utc', now()),
  alter column created_at set not null,
  alter column updated_at set default timezone('utc', now()),
  alter column updated_at set not null;

create table if not exists public.plans (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.plans
  add column if not exists user_id uuid,
  add column if not exists name text,
  add column if not exists description text,
  add column if not exists created_at timestamptz default timezone('utc', now()),
  add column if not exists updated_at timestamptz default timezone('utc', now());

update public.plans
set
  name = coalesce(name, 'Plan'),
  created_at = coalesce(created_at, timezone('utc', now())),
  updated_at = coalesce(updated_at, timezone('utc', now()))
where
  name is null
  or created_at is null
  or updated_at is null;

alter table public.plans
  alter column name set not null,
  alter column created_at set default timezone('utc', now()),
  alter column created_at set not null,
  alter column updated_at set default timezone('utc', now()),
  alter column updated_at set not null;

create table if not exists public.coach_messages (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users (id) on delete cascade,
  coach_id uuid references auth.users (id) on delete set null,
  sender_role text not null check (sender_role in ('user', 'coach')),
  content text not null,
  sent_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.coach_messages
  add column if not exists user_id uuid,
  add column if not exists coach_id uuid,
  add column if not exists sender_role text,
  add column if not exists content text,
  add column if not exists sent_at timestamptz default timezone('utc', now()),
  add column if not exists created_at timestamptz default timezone('utc', now()),
  add column if not exists updated_at timestamptz default timezone('utc', now());

update public.coach_messages
set
  sender_role = coalesce(sender_role, 'user'),
  content = coalesce(content, ''),
  sent_at = coalesce(sent_at, timezone('utc', now())),
  created_at = coalesce(created_at, timezone('utc', now())),
  updated_at = coalesce(updated_at, timezone('utc', now()))
where
  sender_role is null
  or content is null
  or sent_at is null
  or created_at is null
  or updated_at is null;

alter table public.coach_messages
  alter column sender_role set not null,
  alter column content set not null,
  alter column sent_at set default timezone('utc', now()),
  alter column sent_at set not null,
  alter column created_at set default timezone('utc', now()),
  alter column created_at set not null,
  alter column updated_at set default timezone('utc', now()),
  alter column updated_at set not null;

create index if not exists workouts_user_id_idx on public.workouts (user_id);
create index if not exists workouts_user_id_workout_date_idx on public.workouts (user_id, workout_date desc);
create index if not exists nutrition_entries_user_id_idx on public.nutrition_entries (user_id);
create index if not exists nutrition_entries_user_id_consumed_at_idx on public.nutrition_entries (user_id, consumed_at desc);
create index if not exists tribes_creator_id_idx on public.tribes (creator_id);
create index if not exists tribe_memberships_tribe_id_idx on public.tribe_memberships (tribe_id);
create index if not exists tribe_memberships_user_id_idx on public.tribe_memberships (user_id);
create index if not exists plans_user_id_idx on public.plans (user_id);
create index if not exists coach_messages_user_id_idx on public.coach_messages (user_id);
create index if not exists coach_messages_coach_id_idx on public.coach_messages (coach_id);

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

drop trigger if exists set_workouts_updated_at on public.workouts;
create trigger set_workouts_updated_at
before update on public.workouts
for each row
execute function public.set_updated_at();

drop trigger if exists set_nutrition_entries_updated_at on public.nutrition_entries;
create trigger set_nutrition_entries_updated_at
before update on public.nutrition_entries
for each row
execute function public.set_updated_at();

drop trigger if exists set_tribes_updated_at on public.tribes;
create trigger set_tribes_updated_at
before update on public.tribes
for each row
execute function public.set_updated_at();

drop trigger if exists set_tribe_memberships_updated_at on public.tribe_memberships;
create trigger set_tribe_memberships_updated_at
before update on public.tribe_memberships
for each row
execute function public.set_updated_at();

drop trigger if exists set_plans_updated_at on public.plans;
create trigger set_plans_updated_at
before update on public.plans
for each row
execute function public.set_updated_at();

drop trigger if exists set_coach_messages_updated_at on public.coach_messages;
create trigger set_coach_messages_updated_at
before update on public.coach_messages
for each row
execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.workouts enable row level security;
alter table public.nutrition_entries enable row level security;
alter table public.tribes enable row level security;
alter table public.tribe_memberships enable row level security;
alter table public.plans enable row level security;
alter table public.coach_messages enable row level security;

drop policy if exists "Select own profile" on public.profiles;
create policy "Select own profile"
  on public.profiles for select
  using (auth.uid() = user_id);

drop policy if exists "Insert own profile" on public.profiles;
create policy "Insert own profile"
  on public.profiles for insert
  with check (auth.uid() = user_id);

drop policy if exists "Update own profile" on public.profiles;
create policy "Update own profile"
  on public.profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Delete own profile" on public.profiles;
create policy "Delete own profile"
  on public.profiles for delete
  using (auth.uid() = user_id);

drop policy if exists "Select own workouts" on public.workouts;
create policy "Select own workouts"
  on public.workouts for select
  using (auth.uid() = user_id);

drop policy if exists "Insert own workouts" on public.workouts;
create policy "Insert own workouts"
  on public.workouts for insert
  with check (auth.uid() = user_id);

drop policy if exists "Update own workouts" on public.workouts;
create policy "Update own workouts"
  on public.workouts for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Delete own workouts" on public.workouts;
create policy "Delete own workouts"
  on public.workouts for delete
  using (auth.uid() = user_id);

drop policy if exists "Select own nutrition entries" on public.nutrition_entries;
create policy "Select own nutrition entries"
  on public.nutrition_entries for select
  using (auth.uid() = user_id);

drop policy if exists "Insert own nutrition entries" on public.nutrition_entries;
create policy "Insert own nutrition entries"
  on public.nutrition_entries for insert
  with check (auth.uid() = user_id);

drop policy if exists "Update own nutrition entries" on public.nutrition_entries;
create policy "Update own nutrition entries"
  on public.nutrition_entries for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Delete own nutrition entries" on public.nutrition_entries;
create policy "Delete own nutrition entries"
  on public.nutrition_entries for delete
  using (auth.uid() = user_id);

drop policy if exists "Public read tribes" on public.tribes;
create policy "Public read tribes"
  on public.tribes for select
  using (true);

drop policy if exists "Insert own tribes" on public.tribes;
create policy "Insert own tribes"
  on public.tribes for insert
  with check (auth.uid() = creator_id);

drop policy if exists "Update own tribes" on public.tribes;
create policy "Update own tribes"
  on public.tribes for update
  using (auth.uid() = creator_id)
  with check (auth.uid() = creator_id);

drop policy if exists "Delete own tribes" on public.tribes;
create policy "Delete own tribes"
  on public.tribes for delete
  using (auth.uid() = creator_id);

drop policy if exists "Select own tribe memberships" on public.tribe_memberships;
create policy "Select own tribe memberships"
  on public.tribe_memberships for select
  using (auth.uid() = user_id);

drop policy if exists "Insert own tribe memberships" on public.tribe_memberships;
create policy "Insert own tribe memberships"
  on public.tribe_memberships for insert
  with check (auth.uid() = user_id);

drop policy if exists "Delete own tribe memberships" on public.tribe_memberships;
create policy "Delete own tribe memberships"
  on public.tribe_memberships for delete
  using (auth.uid() = user_id);

drop policy if exists "Select own plans" on public.plans;
create policy "Select own plans"
  on public.plans for select
  using (auth.uid() = user_id);

drop policy if exists "Insert own plans" on public.plans;
create policy "Insert own plans"
  on public.plans for insert
  with check (auth.uid() = user_id);

drop policy if exists "Update own plans" on public.plans;
create policy "Update own plans"
  on public.plans for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Delete own plans" on public.plans;
create policy "Delete own plans"
  on public.plans for delete
  using (auth.uid() = user_id);

drop policy if exists "Select own coach messages" on public.coach_messages;
create policy "Select own coach messages"
  on public.coach_messages for select
  using (auth.uid() = user_id or auth.uid() = coach_id);

drop policy if exists "Insert own coach messages" on public.coach_messages;
create policy "Insert own coach messages"
  on public.coach_messages for insert
  with check (auth.uid() = user_id or auth.uid() = coach_id);

drop policy if exists "Update own coach messages" on public.coach_messages;
create policy "Update own coach messages"
  on public.coach_messages for update
  using (auth.uid() = user_id or auth.uid() = coach_id)
  with check (auth.uid() = user_id or auth.uid() = coach_id);

drop policy if exists "Delete own coach messages" on public.coach_messages;
create policy "Delete own coach messages"
  on public.coach_messages for delete
  using (auth.uid() = user_id or auth.uid() = coach_id);
