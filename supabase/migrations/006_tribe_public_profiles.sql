create or replace function public.get_public_profiles(target_user_ids uuid[])
returns table (
  user_id uuid,
  display_name text,
  username text,
  avatar_url text
)
language sql
security definer
set search_path = public
as $$
  select
    p.user_id,
    p.display_name,
    p.username,
    p.avatar_url
  from public.profiles p
  where p.user_id = any(target_user_ids);
$$;

revoke all on function public.get_public_profiles(uuid[]) from public;
grant execute on function public.get_public_profiles(uuid[]) to authenticated;
