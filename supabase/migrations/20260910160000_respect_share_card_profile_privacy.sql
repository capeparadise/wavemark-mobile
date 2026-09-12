-- Share identifiers are not permission to read a private profile's ratings.
CREATE OR REPLACE FUNCTION public.get_share_card_top_rated(p_public_id text, p_limit integer DEFAULT 3)
RETURNS TABLE(id uuid, item_type text, title text, artist_name text, artwork_url text, spotify_url text, apple_url text, rating numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  target_user uuid;
  lim integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  SELECT p.id INTO target_user
  FROM public.profiles p
  WHERE p.public_id = p_public_id
    AND (
      p.id = auth.uid()
      OR p.is_private = false
      OR EXISTS (
        SELECT 1 FROM public.profile_follows f
        WHERE f.follower_id = auth.uid()
          AND f.following_id = p.id
          AND f.status = 'accepted'
      )
    )
  LIMIT 1;

  IF target_user IS NULL THEN
    RETURN;
  END IF;

  lim := greatest(1, least(coalesce(p_limit, 3), 10));
  RETURN QUERY
  SELECT l.id, l.item_type::text, l.title, l.artist_name, l.artwork_url,
         l.spotify_url, l.apple_url, l.rating
  FROM public.listen_list l
  WHERE l.user_id = target_user
    AND l.rating IS NOT NULL
    AND l.artwork_url IS NOT NULL
  ORDER BY l.rating DESC, l.rated_at DESC NULLS LAST,
           l.done_at DESC NULLS LAST, l.created_at DESC NULLS LAST
  LIMIT lim;
END;
$function$;
