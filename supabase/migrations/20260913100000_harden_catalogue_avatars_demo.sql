-- Harden catalogue writes, avatar storage and demo reset access.
REVOKE INSERT, UPDATE, DELETE ON public.artists, public.releases FROM anon, authenticated;

-- Public image delivery stays enabled; listing metadata is owner-only.
DROP POLICY IF EXISTS avatars_select_public ON storage.objects;
CREATE POLICY avatars_select_own_folder ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY avatars_listing_guard ON storage.objects AS RESTRICTIVE FOR SELECT TO public
USING (bucket_id <> 'avatars' OR (storage.foldername(name))[1] = auth.uid()::text);
UPDATE storage.buckets SET file_size_limit = 10485760,
allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif']
WHERE id = 'avatars';

-- Only trusted administrators can edit auth.users.raw_app_meta_data.
-- No real account is opted in by this migration.
ALTER FUNCTION public.reset_my_demo_profile() RENAME TO reset_demo_profile_internal;
REVOKE ALL ON FUNCTION public.reset_demo_profile_internal() FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.reset_my_demo_profile() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = auth.uid()
    AND raw_app_meta_data @> '{"rppl_demo_reset_allowed":true}'::jsonb) THEN
    RAISE EXCEPTION 'Demo reset is available only for approved demo accounts' USING ERRCODE='42501';
  END IF;
  RETURN public.reset_demo_profile_internal();
END;
$$;
REVOKE ALL ON FUNCTION public.reset_my_demo_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_my_demo_profile() TO authenticated;
