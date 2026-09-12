-- Remove legacy insert policies that allowed a signed-in caller to choose
-- another user's user_id. Existing ownership policies remain in force.

drop policy if exists "Owner insert listen_list (dev)"
on public.listen_list;

drop policy if exists "Listen: authenticated can insert"
on public.listen_list;
