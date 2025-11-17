-- Create upcoming_releases table for Phase 1 (Apple-based upcoming ingest)
create table if not exists public.upcoming_releases (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  artist_id text not null,
  artist_name text,
  title text not null,
  release_date date not null,
  apple_id text,
  apple_url text,
  created_at timestamptz not null default now(),
  resolved_listen_id uuid null -- optional link to listen_list row once added
);

-- Uniqueness per user + artist + title + release date to avoid duplicates
create unique index if not exists upcoming_releases_user_artist_title_date_idx
  on public.upcoming_releases (user_id, artist_id, title, release_date);

-- Basic RLS (assumes RLS enabled globally); users can see only their rows
alter table public.upcoming_releases enable row level security;
drop policy if exists "upcoming_releases_select" on public.upcoming_releases;
create policy "upcoming_releases_select" on public.upcoming_releases
  for select using ( auth.uid() = user_id );
drop policy if exists "upcoming_releases_insert" on public.upcoming_releases;
create policy "upcoming_releases_insert" on public.upcoming_releases
  for insert with check ( auth.uid() = user_id );
drop policy if exists "upcoming_releases_update" on public.upcoming_releases;
create policy "upcoming_releases_update" on public.upcoming_releases
  for update using ( auth.uid() = user_id );
drop policy if exists "upcoming_releases_delete" on public.upcoming_releases;
create policy "upcoming_releases_delete" on public.upcoming_releases
  for delete using ( auth.uid() = user_id );
