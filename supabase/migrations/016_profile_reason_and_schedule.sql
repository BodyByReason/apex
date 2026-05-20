alter table public.profiles
  add column if not exists reason_why text[] null,
  add column if not exists reason_why_detail text null,
  add column if not exists wake_time text null,
  add column if not exists sleep_time text null,
  add column if not exists workout_time text null,
  add column if not exists workout_window text null,
  add column if not exists meals_per_day text null;
