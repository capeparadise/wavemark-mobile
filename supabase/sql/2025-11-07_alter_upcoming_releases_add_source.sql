-- Phase 2: extend upcoming_releases with source + external IDs
alter table public.upcoming_releases
  add column if not exists source text default 'apple',
  add column if not exists mb_release_group_id text;

-- (Optional) backfill existing rows to 'apple'
update public.upcoming_releases set source = coalesce(source,'apple') where source is null;