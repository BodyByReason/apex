insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tribe-live-videos',
  'tribe-live-videos',
  true,
  524288000, -- 500 MB per file
  array['video/mp4', 'video/webm', 'video/quicktime']
)
on conflict (id) do nothing;

create policy "public can read tribe live videos"
  on storage.objects for select
  using (bucket_id = 'tribe-live-videos');

create policy "service role can upload tribe live videos"
  on storage.objects for insert
  with check (bucket_id = 'tribe-live-videos');
