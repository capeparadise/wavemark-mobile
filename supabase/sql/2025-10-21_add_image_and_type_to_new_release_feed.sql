-- Adds image_url and release_type to new_release_feed
-- Safe to run multiple times with IF NOT EXISTS / DO block guards

alter table if exists public.new_release_feed
  add column if not exists image_url text;

alter table if exists public.new_release_feed
  add column if not exists release_type text check (release_type in ('album','single','compilation'));

-- Optional: index to speed up dedupe checks
create index if not exists new_release_feed_spotify_url_idx on public.new_release_feed(spotify_url);
