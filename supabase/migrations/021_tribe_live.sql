create table tribe_live_sessions (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid references auth.users(id) not null,
  coach_name text not null,
  title text not null,
  livekit_room_name text not null,
  status text not null default 'live' check (status in ('live','ended')),
  viewer_count int not null default 0,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

create table tribe_live_comments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references tribe_live_sessions(id) on delete cascade not null,
  user_id uuid references auth.users(id) not null,
  author_name text not null,
  author_avatar_url text,
  author_is_coach boolean not null default false,
  body text not null,
  created_at timestamptz not null default now()
);

create table tribe_live_join_requests (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references tribe_live_sessions(id) on delete cascade not null,
  user_id uuid references auth.users(id) not null,
  requester_name text not null,
  status text not null default 'pending' check (status in ('pending','approved','denied')),
  created_at timestamptz not null default now(),
  unique(session_id, user_id)
);

alter table tribe_live_sessions enable row level security;
alter table tribe_live_comments enable row level security;
alter table tribe_live_join_requests enable row level security;

create policy "anyone can read live sessions" on tribe_live_sessions for select using (true);
create policy "coaches can insert sessions" on tribe_live_sessions for insert with check (auth.uid() = coach_id);
create policy "coaches can update their sessions" on tribe_live_sessions for update using (auth.uid() = coach_id);

create policy "anyone can read comments" on tribe_live_comments for select using (true);
create policy "authenticated users can comment" on tribe_live_comments for insert with check (auth.uid() = user_id);

create policy "anyone can read join requests" on tribe_live_join_requests for select using (true);
create policy "authenticated users can request" on tribe_live_join_requests for insert with check (auth.uid() = user_id);
create policy "coaches can update join requests" on tribe_live_join_requests for update using (true);
