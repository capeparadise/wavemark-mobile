-- Private bookmarks, deliberately separate from artist follows/listening history.
CREATE TABLE public.saved_artists (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('spotify','apple')),
  artist_id text NOT NULL CHECK (length(artist_id) BETWEEN 1 AND 64),
  artist_name text NOT NULL CHECK (length(artist_name) BETWEEN 1 AND 300),
  image_url text CHECK (image_url IS NULL OR image_url LIKE 'https://%'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider, artist_id)
);
ALTER TABLE public.saved_artists ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.saved_artists FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_artists TO authenticated;
CREATE POLICY saved_artists_owner ON public.saved_artists FOR ALL TO authenticated
USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
