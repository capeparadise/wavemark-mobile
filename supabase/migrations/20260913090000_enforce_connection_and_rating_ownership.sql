-- Enforce connection participant integrity and rating ownership.
CREATE OR REPLACE FUNCTION public.guard_friend_request_update()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.requester_id IS DISTINCT FROM OLD.requester_id
     OR NEW.recipient_id IS DISTINCT FROM OLD.recipient_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Connection participants cannot be changed' USING ERRCODE = '42501';
  END IF;
  IF auth.uid() IS NOT NULL AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'pending' AND NEW.status IN ('accepted', 'declined')
       AND auth.uid() = OLD.recipient_id)
      OR (OLD.status = 'declined' AND NEW.status = 'pending'
          AND auth.uid() = OLD.requester_id)
    ) THEN
      RAISE EXCEPTION 'Connection transition not permitted' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_friend_request_update() FROM PUBLIC;
DROP TRIGGER IF EXISTS guard_friend_request_update ON public.friend_requests;
CREATE TRIGGER guard_friend_request_update BEFORE UPDATE ON public.friend_requests
FOR EACH ROW EXECUTE FUNCTION public.guard_friend_request_update();

DROP POLICY IF EXISTS "Owner insert ratings (dev)" ON public.ratings;
DROP POLICY IF EXISTS "Owner insert ratings" ON public.ratings;
CREATE POLICY "Owner insert ratings" ON public.ratings FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());
-- Restrictive guard also prevents another permissive policy widening inserts.
DROP POLICY IF EXISTS ratings_insert_owner_guard ON public.ratings;
CREATE POLICY ratings_insert_owner_guard ON public.ratings AS RESTRICTIVE
FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
