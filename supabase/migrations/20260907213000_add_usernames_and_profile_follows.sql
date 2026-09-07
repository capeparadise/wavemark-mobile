-- Searchable listener identities and one-way profile follows.
-- Existing accepted mutual connections are preserved as reciprocal follows.

create extension if not exists "pgcrypto";

alter table public.profiles
  add column if not exists username text,
  add column if not exists is_private boolean not null default true,
  add column if not exists profile_setup_completed boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists profiles_username_lower_unique_idx
  on public.profiles (lower(username))
  where username is not null;

create index if not exists profiles_username_search_idx
  on public.profiles (lower(username) text_pattern_ops)
  where username is not null and profile_setup_completed = true;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_username_format_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_username_format_check
      check (
        username is null
        or (
          username = lower(username)
          and username ~ '^[a-z0-9][a-z0-9._]{1,18}[a-z0-9]$'
        )
      );
  end if;
end
$$;

create table if not exists public.profile_follows (
  id uuid primary key default extensions.gen_random_uuid(),
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_follows_not_self check (follower_id <> following_id),
  constraint profile_follows_pair_unique unique (follower_id, following_id)
);

create index if not exists profile_follows_following_status_idx
  on public.profile_follows(following_id, status, created_at desc);

create index if not exists profile_follows_follower_status_idx
  on public.profile_follows(follower_id, status, created_at desc);

alter table public.profile_follows enable row level security;
revoke all on table public.profile_follows from anon, authenticated;

-- Preserve every existing accepted connection in both directions.
insert into public.profile_follows (follower_id, following_id, status, created_at, updated_at)
select fr.requester_id, fr.recipient_id, 'accepted', fr.created_at, now()
from public.friend_requests fr
where fr.status = 'accepted'
on conflict (follower_id, following_id)
do update set status = 'accepted', updated_at = now();

insert into public.profile_follows (follower_id, following_id, status, created_at, updated_at)
select fr.recipient_id, fr.requester_id, 'accepted', fr.created_at, now()
from public.friend_requests fr
where fr.status = 'accepted'
on conflict (follower_id, following_id)
do update set status = 'accepted', updated_at = now();

-- Preserve outstanding connection requests as one-way follow requests.
insert into public.profile_follows (follower_id, following_id, status, created_at, updated_at)
select fr.requester_id, fr.recipient_id, 'pending', fr.created_at, now()
from public.friend_requests fr
where fr.status = 'pending'
on conflict (follower_id, following_id) do nothing;

create or replace function public.sync_accepted_connection_to_follows()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'accepted' then
    insert into public.profile_follows (follower_id, following_id, status, created_at, updated_at)
    values (new.requester_id, new.recipient_id, 'accepted', coalesce(new.created_at, now()), now())
    on conflict (follower_id, following_id)
    do update set status = 'accepted', updated_at = now();

    insert into public.profile_follows (follower_id, following_id, status, created_at, updated_at)
    values (new.recipient_id, new.requester_id, 'accepted', coalesce(new.created_at, now()), now())
    on conflict (follower_id, following_id)
    do update set status = 'accepted', updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists sync_accepted_connection_to_follows_trigger on public.friend_requests;
create trigger sync_accepted_connection_to_follows_trigger
after insert or update of status on public.friend_requests
for each row execute function public.sync_accepted_connection_to_follows();

create or replace function public.check_username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and lower(trim(leading '@' from coalesce(p_username, ''))) ~ '^[a-z0-9][a-z0-9._]{1,18}[a-z0-9]$'
    and not exists (
      select 1
      from public.profiles p
      where lower(p.username) = lower(trim(leading '@' from coalesce(p_username, '')))
        and p.id <> auth.uid()
    );
$$;

create or replace function public.save_my_social_profile(
  p_username text,
  p_display_name text default null,
  p_is_private boolean default true
)
returns table (
  user_id uuid,
  display_name text,
  username text,
  avatar_url text,
  public_id text,
  is_private boolean,
  profile_setup_completed boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  clean_username text := lower(trim(leading '@' from trim(coalesce(p_username, ''))));
  clean_display_name text := nullif(trim(coalesce(p_display_name, '')), '');
begin
  if uid is null then
    raise exception using message = 'Not signed in', errcode = '28000';
  end if;

  if clean_username !~ '^[a-z0-9][a-z0-9._]{1,18}[a-z0-9]$' then
    raise exception using message = 'Use 3–20 letters, numbers, dots or underscores', errcode = '22023';
  end if;

  begin
    insert into public.profiles (
      id, display_name, username, avatar_url, public_id,
      is_private, profile_setup_completed, updated_at
    )
    values (
      uid,
      coalesce(clean_display_name, 'Listener'),
      clean_username,
      null,
      encode(extensions.gen_random_bytes(16), 'hex'),
      coalesce(p_is_private, true),
      true,
      now()
    )
    on conflict (id) do update
    set display_name = coalesce(clean_display_name, public.profiles.display_name),
        username = clean_username,
        is_private = coalesce(p_is_private, true),
        profile_setup_completed = true,
        updated_at = now();

    if coalesce(p_is_private, true) = false then
      update public.profile_follows
      set status = 'accepted', updated_at = now()
      where following_id = uid and status = 'pending';
    end if;
  exception when unique_violation then
    raise exception using message = 'That username is already taken', errcode = '23505';
  end;

  return query
  select p.id, p.display_name, p.username, p.avatar_url, p.public_id,
         p.is_private, p.profile_setup_completed
  from public.profiles p
  where p.id = uid;
end;
$$;

create or replace function public.search_listener_profiles(p_query text, p_limit int default 20)
returns table (
  user_id uuid,
  display_name text,
  username text,
  avatar_url text,
  is_private boolean,
  relationship_status text
)
language sql
stable
security definer
set search_path = public
as $$
  with input as (
    select lower(trim(leading '@' from trim(coalesce(p_query, '')))) as q,
           greatest(1, least(coalesce(p_limit, 20), 30)) as lim,
           auth.uid() as uid
  )
  select p.id,
         p.display_name,
         p.username,
         p.avatar_url,
         p.is_private,
         case
           when f.status = 'accepted' then 'following'
           when f.status = 'pending' then 'requested'
           else 'none'
         end
  from public.profiles p
  cross join input i
  left join public.profile_follows f
    on f.follower_id = i.uid and f.following_id = p.id
  where i.uid is not null
    and length(i.q) >= 2
    and p.id <> i.uid
    and p.profile_setup_completed = true
    and p.username is not null
    and lower(p.username) like i.q || '%'
  order by
    case when lower(p.username) = i.q then 0 else 1 end,
    lower(p.username)
  limit (select lim from input);
$$;

create or replace function public.get_listener_profile(p_username text)
returns table (
  user_id uuid,
  display_name text,
  username text,
  avatar_url text,
  is_private boolean,
  relationship_status text,
  follows_you boolean,
  can_view_content boolean,
  followers_count bigint,
  following_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with target as (
    select p.*
    from public.profiles p
    where lower(p.username) = lower(trim(leading '@' from trim(coalesce(p_username, ''))))
      and p.profile_setup_completed = true
    limit 1
  ), relation as (
    select f.status
    from public.profile_follows f, target t
    where f.follower_id = auth.uid() and f.following_id = t.id
    limit 1
  )
  select t.id,
         t.display_name,
         t.username,
         t.avatar_url,
         t.is_private,
         case
           when t.id = auth.uid() then 'self'
           when (select status from relation) = 'accepted' then 'following'
           when (select status from relation) = 'pending' then 'requested'
           else 'none'
         end,
         exists (
           select 1 from public.profile_follows inbound
           where inbound.follower_id = t.id
             and inbound.following_id = auth.uid()
             and inbound.status = 'accepted'
         ),
         (
           t.id = auth.uid()
           or not t.is_private
           or (select status from relation) = 'accepted'
         ),
         (select count(*) from public.profile_follows f where f.following_id = t.id and f.status = 'accepted'),
         (select count(*) from public.profile_follows f where f.follower_id = t.id and f.status = 'accepted')
  from target t
  where auth.uid() is not null;
$$;

create or replace function public.get_listener_music(p_username text, p_limit int default 12)
returns table (
  section text,
  id uuid,
  item_type text,
  provider text,
  provider_id text,
  spotify_id text,
  apple_id text,
  title text,
  artist_name text,
  artwork_url text,
  release_date text,
  spotify_url text,
  apple_url text,
  done_at timestamptz,
  rating numeric,
  rated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with target as (
    select p.id, p.is_private
    from public.profiles p
    where lower(p.username) = lower(trim(leading '@' from trim(coalesce(p_username, ''))))
      and p.profile_setup_completed = true
    limit 1
  ), permitted as (
    select t.id
    from target t
    where t.id = auth.uid()
       or not t.is_private
       or exists (
         select 1 from public.profile_follows f
         where f.follower_id = auth.uid()
           and f.following_id = t.id
           and f.status = 'accepted'
       )
  ), recent as (
    select 'recent'::text as section,
           l.id, l.item_type::text, l.provider::text, l.provider_id::text,
           l.spotify_id::text, l.apple_id::text,
           l.title, l.artist_name, l.artwork_url, l.release_date::text,
           l.spotify_url, l.apple_url, l.done_at, l.rating, l.rated_at,
           row_number() over (order by l.done_at desc nulls last, l.created_at desc) as rn
    from public.listen_list l
    where l.user_id in (select id from permitted)
      and l.done_at is not null
  ), top_rated as (
    select 'top_rated'::text as section,
           l.id, l.item_type::text, l.provider::text, l.provider_id::text,
           l.spotify_id::text, l.apple_id::text,
           l.title, l.artist_name, l.artwork_url, l.release_date::text,
           l.spotify_url, l.apple_url, l.done_at, l.rating, l.rated_at,
           row_number() over (order by l.rating desc nulls last, l.rated_at desc nulls last, l.done_at desc) as rn
    from public.listen_list l
    where l.user_id in (select id from permitted)
      and l.done_at is not null
      and l.rating is not null
  )
  select r.section, r.id, r.item_type, r.provider, r.provider_id,
         r.spotify_id, r.apple_id, r.title, r.artist_name, r.artwork_url,
         r.release_date, r.spotify_url, r.apple_url, r.done_at, r.rating, r.rated_at
  from recent r
  where r.rn <= greatest(1, least(coalesce(p_limit, 12), 30))
  union all
  select t.section, t.id, t.item_type, t.provider, t.provider_id,
         t.spotify_id, t.apple_id, t.title, t.artist_name, t.artwork_url,
         t.release_date, t.spotify_url, t.apple_url, t.done_at, t.rating, t.rated_at
  from top_rated t
  where t.rn <= greatest(1, least(coalesce(p_limit, 12), 30));
$$;

create or replace function public.follow_listener(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  target_private boolean;
  next_status text;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if p_user_id is null or p_user_id = uid then raise exception 'Invalid listener'; end if;

  select p.is_private into target_private
  from public.profiles p
  where p.id = p_user_id and p.profile_setup_completed = true;

  if target_private is null then raise exception 'Listener not found'; end if;
  next_status := case when target_private then 'pending' else 'accepted' end;

  insert into public.profile_follows as existing_follow (follower_id, following_id, status, updated_at)
  values (uid, p_user_id, next_status, now())
  on conflict (follower_id, following_id)
  do update set status = case
      when existing_follow.status = 'accepted' then 'accepted'
      else excluded.status
    end,
    updated_at = now();

  select f.status into next_status
  from public.profile_follows f
  where f.follower_id = uid and f.following_id = p_user_id;
  return next_status;
end;
$$;

create or replace function public.unfollow_listener(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return false; end if;
  delete from public.profile_follows
  where follower_id = auth.uid() and following_id = p_user_id;
  return found;
end;
$$;

create or replace function public.respond_to_follow_request(p_follower_id uuid, p_accept boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return false; end if;
  if coalesce(p_accept, false) then
    update public.profile_follows
    set status = 'accepted', updated_at = now()
    where follower_id = p_follower_id
      and following_id = auth.uid()
      and status = 'pending';
  else
    delete from public.profile_follows
    where follower_id = p_follower_id
      and following_id = auth.uid()
      and status = 'pending';
  end if;
  return found;
end;
$$;

create or replace function public.list_my_following_profiles()
returns table (
  user_id uuid,
  display_name text,
  username text,
  avatar_url text,
  is_private boolean,
  relationship_status text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.display_name, p.username, p.avatar_url, p.is_private,
         case when f.status = 'accepted' then 'following' else 'requested' end,
         f.created_at
  from public.profile_follows f
  join public.profiles p on p.id = f.following_id
  where f.follower_id = auth.uid()
  order by f.created_at desc;
$$;

create or replace function public.list_my_follow_requests()
returns table (
  user_id uuid,
  display_name text,
  username text,
  avatar_url text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.display_name, p.username, p.avatar_url, f.created_at
  from public.profile_follows f
  join public.profiles p on p.id = f.follower_id
  where f.following_id = auth.uid() and f.status = 'pending'
  order by f.created_at desc;
$$;

create or replace function public.get_following_activity(p_limit int default 60)
returns table (
  id uuid,
  user_id uuid,
  item_type text,
  provider text,
  provider_id text,
  spotify_id text,
  apple_id text,
  title text,
  artist_name text,
  artwork_url text,
  release_date text,
  spotify_url text,
  apple_url text,
  done_at timestamptz,
  rating numeric,
  rated_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select l.id, l.user_id, l.item_type::text, l.provider::text,
         l.provider_id::text, l.spotify_id::text, l.apple_id::text,
         l.title, l.artist_name, l.artwork_url, l.release_date::text,
         l.spotify_url, l.apple_url,
         l.done_at, l.rating, l.rated_at, l.created_at
  from public.listen_list l
  where l.user_id in (
    select f.following_id
    from public.profile_follows f
    where f.follower_id = auth.uid() and f.status = 'accepted'
  )
    and (l.done_at is not null or l.rating is not null)
  order by coalesce(l.rated_at, l.done_at, l.created_at) desc nulls last
  limit greatest(1, least(coalesce(p_limit, 60), 200));
$$;

revoke all on function public.sync_accepted_connection_to_follows() from public, anon, authenticated;
revoke all on function public.check_username_available(text) from public, anon, authenticated;
revoke all on function public.save_my_social_profile(text, text, boolean) from public, anon, authenticated;
revoke all on function public.search_listener_profiles(text, int) from public, anon, authenticated;
revoke all on function public.get_listener_profile(text) from public, anon, authenticated;
revoke all on function public.get_listener_music(text, int) from public, anon, authenticated;
revoke all on function public.follow_listener(uuid) from public, anon, authenticated;
revoke all on function public.unfollow_listener(uuid) from public, anon, authenticated;
revoke all on function public.respond_to_follow_request(uuid, boolean) from public, anon, authenticated;
revoke all on function public.list_my_following_profiles() from public, anon, authenticated;
revoke all on function public.list_my_follow_requests() from public, anon, authenticated;
revoke all on function public.get_following_activity(int) from public, anon, authenticated;

grant execute on function public.check_username_available(text) to authenticated;
grant execute on function public.save_my_social_profile(text, text, boolean) to authenticated;
grant execute on function public.search_listener_profiles(text, int) to authenticated;
grant execute on function public.get_listener_profile(text) to authenticated;
grant execute on function public.get_listener_music(text, int) to authenticated;
grant execute on function public.follow_listener(uuid) to authenticated;
grant execute on function public.unfollow_listener(uuid) to authenticated;
grant execute on function public.respond_to_follow_request(uuid, boolean) to authenticated;
grant execute on function public.list_my_following_profiles() to authenticated;
grant execute on function public.list_my_follow_requests() to authenticated;
grant execute on function public.get_following_activity(int) to authenticated;
