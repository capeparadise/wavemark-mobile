-- Restrict connection invite RPC execution to the authenticated role.

revoke all on function public.users_are_connected(uuid, uuid) from anon, authenticated, public;
revoke all on function public.create_connection_invite() from anon, authenticated, public;
revoke all on function public.get_connection_invite_preview(text) from anon, authenticated, public;
revoke all on function public.accept_connection_invite(text) from anon, authenticated, public;

grant execute on function public.create_connection_invite() to authenticated;
grant execute on function public.get_connection_invite_preview(text) to authenticated;
grant execute on function public.accept_connection_invite(text) to authenticated;
