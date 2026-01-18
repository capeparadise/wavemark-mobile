-- Add apple_confidence column to track quality of resolved Apple links
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns WHERE table_name='listen_list' AND column_name='apple_confidence'
    ) THEN
        ALTER TABLE public.listen_list ADD COLUMN apple_confidence numeric NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS listen_list_apple_confidence_idx ON public.listen_list (apple_confidence);
