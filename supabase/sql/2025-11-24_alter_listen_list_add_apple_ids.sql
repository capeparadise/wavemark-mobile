-- Add explicit Apple Music ID columns for deterministic deep links
-- Safe to run multiple times (checks existence before adding)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns WHERE table_name='listen_list' AND column_name='apple_track_id'
    ) THEN
        ALTER TABLE public.listen_list ADD COLUMN apple_track_id text NULL;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns WHERE table_name='listen_list' AND column_name='apple_album_id'
    ) THEN
        ALTER TABLE public.listen_list ADD COLUMN apple_album_id text NULL;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns WHERE table_name='listen_list' AND column_name='apple_storefront'
    ) THEN
        ALTER TABLE public.listen_list ADD COLUMN apple_storefront text NULL;
    END IF;
END $$;

-- Optional index for faster resolution lookups
CREATE INDEX IF NOT EXISTS listen_list_apple_track_idx ON public.listen_list (apple_track_id);
CREATE INDEX IF NOT EXISTS listen_list_apple_album_idx ON public.listen_list (apple_album_id);
