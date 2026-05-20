insert into storage.buckets (id, name, public)
values ('coach-assets', 'coach-assets', true)
on conflict (id) do nothing;
