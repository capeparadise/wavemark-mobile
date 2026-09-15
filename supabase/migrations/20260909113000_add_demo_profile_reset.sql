-- Internal demo support: clear the signed-in listener's product data while
-- preserving their authentication account. The development UI takes a local
-- snapshot before invoking this function.

create or replace function public.reset_my_demo_profile()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  listen_count integer := 0;
  artist_follow_count integer := 0;
  listener_follow_count integer := 0;
begin
  if uid is null then
    raise exception using message = 'Not signed in', errcode = '28000';
  end if;

  delete from public.listen_list where user_id = uid;
  get diagnostics listen_count = row_count;

  delete from public.upcoming_releases where user_id = uid;

  delete from public.followed_artists where user_id = uid;
  get diagnostics artist_follow_count = row_count;

  delete from public.profile_follows
  where follower_id = uid or following_id = uid;
  get diagnostics listener_follow_count = row_count;

  delete from public.friend_requests
  where requester_id = uid or recipient_id = uid;

  delete from public.connection_invites where inviter_id = uid;
  update public.connection_invites set accepted_by = null where accepted_by = uid;

  update public.profiles
  set display_name = 'Listener',
      username = null,
      avatar_url = null,
      is_private = true,
      profile_setup_completed = false,
      advanced_ratings_enabled = false,
      updated_at = now()
  where id = uid;

  if not found then
    insert into public.profiles (
      id, display_name, username, avatar_url, is_private,
      profile_setup_completed, advanced_ratings_enabled, updated_at
    ) values (
      uid, 'Listener', null, null, true, false, false, now()
    );
  end if;

  return jsonb_build_object(
    'listening_items', listen_count,
    'artist_follows', artist_follow_count,
    'listener_connections', listener_follow_count
  );
end;
$$;

revoke all on function public.reset_my_demo_profile() from public, anon, authenticated;
grant execute on function public.reset_my_demo_profile() to authenticated;
