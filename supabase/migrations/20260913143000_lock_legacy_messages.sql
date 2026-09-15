-- The legacy messages table is not used by the current client. Preserve its
-- rows, but remove direct access until a purpose-built private API exists.
DROP POLICY IF EXISTS "Public can read messages" ON public.messages;

REVOKE ALL ON TABLE public.messages FROM PUBLIC, anon, authenticated;
