alter table tribe_live_sessions
  add column if not exists egress_id text,
  add column if not exists video_url text;

alter table tribe_posts
  add column if not exists video_url text;
