-- Social feed activity for accepted friends
-- Returns lightweight listen/rate activity without exposing full listen_list rows to other users.

create or replace function public.get_social_activity(p_limit int default 60)
returns table (
  id uuid,
  user_id uuid,
  item_type text,
  title text,
  artist_name text,
  artwork_url text,
  spotify_url text,
  apple_url text,
  done_at timestamptz,
  rating numeric,
  rated_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
  lim int;
begin
  uid := auth.uid();
  if uid is null then
    return;
  end if;

  lim := greatest(1, least(coalesce(p_limit, 60), 200));

  return query
  with friends as (
    select
      case
        when fr.requester_id = uid then fr.recipient_id
        else fr.requester_id
      end as friend_id
    from public.friend_requests fr
    where fr.status = 'accepted'
      and (fr.requester_id = uid or fr.recipient_id = uid)
  )
  select
    l.id,
    l.user_id,
    l.item_type::text,
    l.title,
    l.artist_name,
    l.artwork_url,
    l.spotify_url,
    l.apple_url,
    l.done_at,
    l.rating,
    l.rated_at,
    l.created_at
  from public.listen_list l
  where l.user_id in (select friend_id from friends)
  order by l.created_at desc nulls last
  limit lim;
end;
$$;

revoke all on function public.get_social_activity(int) from public;
grant execute on function public.get_social_activity(int) to authenticated;

