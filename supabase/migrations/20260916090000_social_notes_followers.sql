-- Expose optional rating notes to people who can already read following activity,
-- and add owner-scoped follower management helpers.

drop function if exists public.get_following_activity(integer);

create function public.get_following_activity(p_limit int default 60)
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
  review text,
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
         l.done_at, l.rating, l.review, l.rated_at, l.created_at
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

create or replace function public.list_my_followers_profiles()
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
  select p.id,
         p.display_name,
         p.username,
         p.avatar_url,
         p.is_private,
         case
           when outbound.status = 'accepted' then 'following'
           when outbound.status = 'pending' then 'requested'
           else 'none'
         end,
         inbound.created_at
  from public.profile_follows inbound
  join public.profiles p on p.id = inbound.follower_id
  left join public.profile_follows outbound
    on outbound.follower_id = auth.uid()
   and outbound.following_id = inbound.follower_id
  where inbound.following_id = auth.uid()
    and inbound.status = 'accepted'
  order by inbound.created_at desc;
$$;

create or replace function public.remove_my_follower(p_follower_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or p_follower_id is null then
    return false;
  end if;

  delete from public.profile_follows
  where follower_id = p_follower_id
    and following_id = auth.uid()
    and status = 'accepted';

  return found;
end;
$$;

revoke all on function public.get_following_activity(integer) from public, anon, authenticated;
revoke all on function public.list_my_followers_profiles() from public, anon, authenticated;
revoke all on function public.remove_my_follower(uuid) from public, anon, authenticated;

grant execute on function public.get_following_activity(integer) to authenticated;
grant execute on function public.list_my_followers_profiles() to authenticated;
grant execute on function public.remove_my_follower(uuid) to authenticated;
