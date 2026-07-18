-- Single-use shared invite flow for mutual RPPL connections.

create extension if not exists "pgcrypto";

create table if not exists public.connection_invites (
  id uuid primary key default gen_random_uuid(),
  inviter_id uuid not null references public.profiles(id) on delete cascade,
  token_hash bytea not null unique,
  accepted_by uuid references public.profiles(id) on delete set null,
  accepted_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now()
);

create index if not exists connection_invites_inviter_created_idx
on public.connection_invites(inviter_id, created_at desc);

create index if not exists connection_invites_available_idx
on public.connection_invites(token_hash)
where accepted_at is null;

alter table public.connection_invites enable row level security;

drop policy if exists "connection_invites_select_inviter" on public.connection_invites;
drop policy if exists "connection_invites_insert_self" on public.connection_invites;

revoke all on table public.connection_invites from anon;
revoke all on table public.connection_invites from authenticated;

create or replace function public.users_are_connected(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.friend_requests fr
    where fr.status = 'accepted'
      and (
        (fr.requester_id = p_a and fr.recipient_id = p_b)
        or (fr.requester_id = p_b and fr.recipient_id = p_a)
      )
  );
$$;

create or replace function public.create_connection_invite()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
  token text;
begin
  uid := auth.uid();
  if uid is null then
    raise exception 'Not signed in';
  end if;

  if not exists (select 1 from public.profiles p where p.id = uid) then
    raise exception 'Profile required';
  end if;

  token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.connection_invites(inviter_id, token_hash)
  values (uid, extensions.digest(token, 'sha256'));

  return token;
end;
$$;

create or replace function public.get_connection_invite_preview(p_token text)
returns table (
  status text,
  inviter_id uuid,
  display_name text,
  avatar_url text,
  public_id text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
  invite record;
begin
  uid := auth.uid();
  if uid is null then
    return query select 'invalid'::text, null::uuid, null::text, null::text, null::text;
    return;
  end if;

  select ci.*
  into invite
  from public.connection_invites ci
  where ci.token_hash = extensions.digest(coalesce(p_token, ''), 'sha256')
  limit 1;

  if invite.id is null
    or invite.accepted_at is not null
    or invite.expires_at <= now()
    or invite.inviter_id = uid then
    return query select 'invalid'::text, null::uuid, null::text, null::text, null::text;
    return;
  end if;

  if public.users_are_connected(uid, invite.inviter_id) then
    return query
    select 'connected'::text, p.id, p.display_name, p.avatar_url, p.public_id
    from public.profiles p
    where p.id = invite.inviter_id;
    return;
  end if;

  return query
  select 'valid'::text, p.id, p.display_name, p.avatar_url, p.public_id
  from public.profiles p
  where p.id = invite.inviter_id;
end;
$$;

create or replace function public.accept_connection_invite(p_token text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
  invite record;
  low_id uuid;
  high_id uuid;
  existing_relationship_id uuid;
begin
  uid := auth.uid();
  if uid is null then
    return 'invalid';
  end if;

  select ci.*
  into invite
  from public.connection_invites ci
  where ci.token_hash = extensions.digest(coalesce(p_token, ''), 'sha256')
  for update;

  if invite.id is null
    or invite.accepted_at is not null
    or invite.expires_at <= now()
    or invite.inviter_id = uid then
    return 'invalid';
  end if;

  if not exists (select 1 from public.profiles p where p.id = uid) then
    return 'invalid';
  end if;

  low_id := least(uid, invite.inviter_id);
  high_id := greatest(uid, invite.inviter_id);
  perform pg_advisory_xact_lock(hashtext(low_id::text || ':' || high_id::text));

  if public.users_are_connected(uid, invite.inviter_id) then
    return 'already_connected';
  end if;

  select fr.id
  into existing_relationship_id
  from public.friend_requests fr
  where (
    (fr.requester_id = uid and fr.recipient_id = invite.inviter_id)
    or (fr.requester_id = invite.inviter_id and fr.recipient_id = uid)
  )
  order by fr.created_at asc
  limit 1;

  if existing_relationship_id is not null then
    update public.friend_requests
    set status = 'accepted'
    where id = existing_relationship_id;

    delete from public.friend_requests fr
    where fr.id <> existing_relationship_id
      and fr.status <> 'accepted'
      and (
        (fr.requester_id = uid and fr.recipient_id = invite.inviter_id)
        or (fr.requester_id = invite.inviter_id and fr.recipient_id = uid)
      );
  else
    insert into public.friend_requests(requester_id, recipient_id, status)
    values (invite.inviter_id, uid, 'accepted')
    on conflict (requester_id, recipient_id)
    do update set status = 'accepted';
  end if;

  update public.connection_invites
  set accepted_by = uid,
      accepted_at = now()
  where id = invite.id;

  return 'merged';
end;
$$;

revoke all on function public.users_are_connected(uuid, uuid) from anon, authenticated, public;
revoke all on function public.create_connection_invite() from anon, authenticated, public;
revoke all on function public.get_connection_invite_preview(text) from anon, authenticated, public;
revoke all on function public.accept_connection_invite(text) from anon, authenticated, public;

grant execute on function public.create_connection_invite() to authenticated;
grant execute on function public.get_connection_invite_preview(text) to authenticated;
grant execute on function public.accept_connection_invite(text) to authenticated;
