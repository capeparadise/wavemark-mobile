-- Share-card top rated preview for Add Friend screen (public_id deep link)
-- This allows an authenticated viewer to fetch the inviter's top-rated items without relaxing listen_list RLS.

create or replace function public.get_share_card_top_rated(p_public_id text, p_limit int default 3)
returns table (
  id uuid,
  item_type text,
  title text,
  artist_name text,
  artwork_url text,
  spotify_url text,
  apple_url text,
  rating numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user uuid;
  lim int;
begin
  -- Require auth (prevents anonymous scraping)
  if auth.uid() is null then
    return;
  end if;

  select p.id
  into target_user
  from public.profiles p
  where p.public_id = p_public_id
  limit 1;

  if target_user is null then
    return;
  end if;

  lim := greatest(1, least(coalesce(p_limit, 3), 10));

  return query
  select
    l.id,
    l.item_type::text,
    l.title,
    l.artist_name,
    l.artwork_url,
    l.spotify_url,
    l.apple_url,
    l.rating
  from public.listen_list l
  where l.user_id = target_user
    and l.rating is not null
    and l.artwork_url is not null
  order by
    l.rating desc,
    l.rated_at desc nulls last,
    l.done_at desc nulls last,
    l.created_at desc nulls last
  limit lim;
end;
$$;

revoke all on function public.get_share_card_top_rated(text, int) from public;
grant execute on function public.get_share_card_top_rated(text, int) to authenticated;

