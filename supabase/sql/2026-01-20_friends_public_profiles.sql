-- Friends + public profiles (public_id) + avatar storage bucket
-- NOTE: profiles.id is the Supabase auth user id (uuid).

-- Extensions
create extension if not exists "pgcrypto";

-- Profiles additions (if profiles already exists)
alter table if exists public.profiles
  add column if not exists display_name text,
  add column if not exists avatar_url text,
  add column if not exists public_id text;

-- Backfill missing display_name/public_id
update public.profiles
set display_name = coalesce(nullif(display_name, ''), 'Listener')
where display_name is null or display_name = '';

update public.profiles
set public_id = replace(gen_random_uuid()::text, '-', '')
where public_id is null or public_id = '';

-- Default generator for future inserts
alter table if exists public.profiles
  alter column public_id set default replace(gen_random_uuid()::text, '-', '');

-- Enforce constraints
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'public_id'
  ) then
    execute 'alter table public.profiles alter column public_id set not null';
    execute 'create unique index if not exists profiles_public_id_unique on public.profiles(public_id)';
  end if;
end $$;

-- Ensure public_id on insert even if client omits it (belt-and-suspenders)
create or replace function public.ensure_profiles_public_id()
returns trigger as $$
begin
  if new.public_id is null or new.public_id = '' then
    new.public_id := replace(gen_random_uuid()::text, '-', '');
  end if;
  return new;
end;
$$ language plpgsql;

do $$
begin
  if to_regclass('public.profiles') is not null then
    execute 'drop trigger if exists trg_profiles_public_id on public.profiles';
    execute 'create trigger trg_profiles_public_id before insert on public.profiles for each row execute function public.ensure_profiles_public_id()';
  end if;
end $$;

-- Profiles RLS (display_name + avatar_url + public_id for authenticated users)
alter table if exists public.profiles enable row level security;

-- Drop legacy policies by name (common Supabase defaults) and replace with authenticated-only policies.
drop policy if exists "Public profiles are viewable by everyone." on public.profiles;
drop policy if exists "Public profiles are viewable by everyone" on public.profiles;
drop policy if exists "Users can update their own profile." on public.profiles;
drop policy if exists "Users can update their own profile" on public.profiles;
drop policy if exists "Users can insert their own profile." on public.profiles;
drop policy if exists "Users can insert their own profile" on public.profiles;

-- Drop any prior iterations of these policies.
drop policy if exists "profiles_select_public" on public.profiles;
drop policy if exists "profiles_select_authenticated" on public.profiles;
drop policy if exists "profiles_insert_self" on public.profiles;
drop policy if exists "profiles_update_self" on public.profiles;

-- Recreate only these three policies, scoped to the authenticated role.
create policy "profiles_select_authenticated"
on public.profiles
for select
to authenticated
using (true);

create policy "profiles_insert_self"
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

create policy "profiles_update_self"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

-- Belt-and-suspenders: drop any other remaining policies on profiles (prevents public read from lingering).
do $$
declare
  pol record;
begin
  for pol in (
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname not in ('profiles_select_authenticated', 'profiles_insert_self', 'profiles_update_self')
  ) loop
    execute format('drop policy if exists %I on public.profiles', pol.policyname);
  end loop;
end $$;

-- Storage bucket for avatars (best-effort; safe if already exists)
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Friend requests table
create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  status text not null check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists friend_requests_unique_pair
on public.friend_requests(requester_id, recipient_id);

create index if not exists friend_requests_recipient_status_idx
on public.friend_requests(recipient_id, status);

create index if not exists friend_requests_requester_status_idx
on public.friend_requests(requester_id, status);

-- Auto-updated timestamp
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_friend_requests_updated_at on public.friend_requests;
create trigger trg_friend_requests_updated_at
before update on public.friend_requests
for each row execute function public.set_updated_at();

-- RLS policies (basic, minimal)
alter table public.friend_requests enable row level security;

-- Drop legacy policies by name (common Supabase defaults / prior iterations).
drop policy if exists "Enable read access for authenticated users" on public.friend_requests;
drop policy if exists "Enable insert for authenticated users" on public.friend_requests;
drop policy if exists "Enable update for users based on email" on public.friend_requests;
drop policy if exists "friend_requests_select_public" on public.friend_requests;
drop policy if exists "friend_requests_select_authenticated" on public.friend_requests;
drop policy if exists "friend_requests_insert_self" on public.friend_requests;
drop policy if exists "friend_requests_insert_recipient" on public.friend_requests;
drop policy if exists "friend_requests_insert_requester_pending" on public.friend_requests;
drop policy if exists "friend_requests_update_recipient" on public.friend_requests;
drop policy if exists "friend_requests_update_parties" on public.friend_requests;
drop policy if exists "friend_requests_delete_parties" on public.friend_requests;

drop policy if exists "friend_requests_select_self" on public.friend_requests;
create policy "friend_requests_select_self"
on public.friend_requests
for select
to authenticated
using (auth.uid() = requester_id or auth.uid() = recipient_id);

create policy "friend_requests_insert_requester_pending"
on public.friend_requests
for insert
to authenticated
with check (
  auth.uid() = requester_id
  and requester_id <> recipient_id
  and status = 'pending'
);

create policy "friend_requests_update_parties"
on public.friend_requests
for update
to authenticated
using (auth.uid() = requester_id or auth.uid() = recipient_id)
with check (
  (auth.uid() = requester_id or auth.uid() = recipient_id)
  and requester_id <> recipient_id
  and (
    status in ('accepted', 'declined')
    or (status = 'pending' and auth.uid() = requester_id)
  )
);

create policy "friend_requests_delete_parties"
on public.friend_requests
for delete
to authenticated
using (
  (auth.uid() = requester_id or auth.uid() = recipient_id)
  and status = 'accepted'
);

-- Belt-and-suspenders: drop any other remaining policies on friend_requests.
do $$
declare
  pol record;
begin
  for pol in (
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'friend_requests'
      and policyname not in ('friend_requests_select_self', 'friend_requests_insert_requester_pending', 'friend_requests_update_parties', 'friend_requests_delete_parties')
  ) loop
    execute format('drop policy if exists %I on public.friend_requests', pol.policyname);
  end loop;
end $$;
