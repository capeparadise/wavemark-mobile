import { supabase } from './supabase';

export type PublicProfile = {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  public_id: string;
};

function deriveDefaultDisplayName(email?: string | null, fullName?: string | null) {
  const fromName = (fullName || '').trim();
  if (fromName) return fromName;
  const fromEmail = (email || '').split('@')[0]?.trim();
  return fromEmail || 'Listener';
}

export async function ensureMyProfile(): Promise<PublicProfile | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const uid = user.id;
  const fallbackName = deriveDefaultDisplayName(user.email ?? null, (user as any)?.user_metadata?.full_name ?? null);

  const readById = async () => supabase
    .from('profiles')
    .select('*')
    .eq('id', uid)
    .maybeSingle();

  const sel = await readById();
  const existingRaw = sel.data as any;
  const selErr = sel.error as any;

  const existing = !selErr ? normalizeProfile(existingRaw) : null;
  if (existing) {
    const needsPublicId = !existing.public_id || (typeof existing.public_id === 'string' && existing.public_id.trim() === '');
    const needsName = !existing.display_name || (typeof existing.display_name === 'string' && existing.display_name.trim() === '');
    if (needsPublicId || needsName) {
      const displayName = existing.display_name || fallbackName;
      const basePatch: Record<string, any> = { display_name: displayName };

      // Persist a public_id if missing (retry on unlikely collisions).
      if (needsPublicId) {
        for (let i = 0; i < 3; i += 1) {
          const publicId = cryptoSafeId();
          const patch = { ...basePatch, public_id: publicId };
          const up = await supabase
            .from('profiles')
            .update(patch)
            .eq('id', uid)
            .select('*')
            .maybeSingle();
          const normalized = !up.error ? normalizeProfile(up.data as any) : null;
          if (normalized?.public_id) return normalized;
          if (up.error && (up.error as any).code === '23505') continue;
          break;
        }
        const reread = await readById();
        const rereadNorm = !reread.error ? normalizeProfile(reread.data as any) : null;
        return rereadNorm ?? existing;
      }

      const upName = await supabase
        .from('profiles')
        .update(basePatch)
        .eq('id', uid)
        .select('*')
        .maybeSingle();
      const updatedName = !upName.error ? normalizeProfile(upName.data as any) : null;
      return updatedName ?? existing;
    }
    return existing;
  }

  // Create profile row (best-effort). If the DB sets defaults/triggers for public_id, it will be filled even if client omits.
  const publicId = cryptoSafeId();
  const ins = await supabase
    .from('profiles')
    .insert({ id: uid, display_name: fallbackName, avatar_url: null, public_id: publicId })
    .select('*')
    .maybeSingle();
  const inserted = !ins.error ? normalizeProfile(ins.data as any) : null;
  if (inserted) return inserted;

  // If insert failed (e.g. row already exists), re-read to get the current row.
  const reread = await readById();
  const rereadNorm = !reread.error ? normalizeProfile(reread.data as any) : null;
  if (rereadNorm) return rereadNorm;
  return null;
}

export async function getProfileByPublicId(publicId: string): Promise<PublicProfile | null> {
  const pid = (publicId || '').trim();
  if (!pid) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('public_id', pid)
    .maybeSingle();
  if (error) return null;
  return normalizeProfile(data as any);
}

export async function uploadMyAvatar(input: { uri: string; contentType?: string | null }): Promise<{ ok: boolean; url?: string; message?: string }> {
  const uri = (input.uri || '').trim();
  if (!uri) return { ok: false, message: 'Missing image' };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: 'Not signed in' };

  await ensureMyProfile();

  const ext = (() => {
    const m = uri.split('?')[0].match(/\.([a-zA-Z0-9]+)$/);
    return (m?.[1] || 'jpg').toLowerCase();
  })();
  const contentType = input.contentType || (ext === 'png' ? 'image/png' : 'image/jpeg');
  const path = `${user.id}/${Date.now()}.${ext}`;

  let blob: Blob;
  try {
    blob = await (await fetch(uri)).blob();
  } catch {
    return { ok: false, message: 'Could not read image' };
  }

  const { error: upErr } = await supabase
    .storage
    .from('avatars')
    .upload(path, blob as any, { upsert: true, contentType });
  if (upErr) return { ok: false, message: upErr.message };

  const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
  const url = (pub as any)?.publicUrl as string | undefined;
  if (!url) return { ok: false, message: 'Could not get avatar URL' };

  const { error: profErr } = await supabase
    .from('profiles')
    .upsert({ id: user.id, avatar_url: url }, { onConflict: 'id' });
  if (profErr) return { ok: false, message: profErr.message };

  return { ok: true, url };
}

export type FriendRequestRow = {
  id: string;
  requester_id: string;
  recipient_id: string;
  status: 'pending' | 'accepted' | 'declined';
  created_at: string;
};

export async function getRelationshipWith(userId: string): Promise<{
  kind: 'self' | 'none' | 'pending' | 'friends';
  pendingRequestId?: string | null;
}> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { kind: 'none' };
  if (userId === user.id) return { kind: 'self' };

  const { data, error } = await supabase
    .from('friend_requests')
    .select('id,requester_id,recipient_id,status,created_at')
    .or(
      `and(requester_id.eq.${user.id},recipient_id.eq.${userId}),and(requester_id.eq.${userId},recipient_id.eq.${user.id})`,
    )
    .order('created_at', { ascending: false })
    .limit(5);

  if (error || !Array.isArray(data) || data.length === 0) return { kind: 'none' };
  const rows = data as FriendRequestRow[];
  const accepted = rows.find((r) => r.status === 'accepted');
  if (accepted) return { kind: 'friends' };
  const pending = rows.find((r) => r.status === 'pending');
  if (pending) return { kind: 'pending', pendingRequestId: pending.id };
  return { kind: 'none' };
}

export async function sendFriendRequestTo(inviterId: string): Promise<{ ok: boolean; message?: string; alreadyFriends?: boolean; pending?: boolean }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: 'Not signed in' };
  const targetId = (inviterId || '').trim();
  const requesterId = user.id;
  if (!targetId) return { ok: false, message: 'Invalid user' };
  if (targetId === requesterId) return { ok: false, message: 'This is you' };

  const rel = await getRelationshipWith(targetId);
  if (rel.kind === 'friends') return { ok: true, alreadyFriends: true };
  if (rel.kind === 'pending') return { ok: true, pending: true };

  const { data: existing, error: existingErr } = await supabase
    .from('friend_requests')
    .select('id,status')
    .eq('requester_id', requesterId)
    .eq('recipient_id', targetId)
    .limit(1)
    .maybeSingle();
  if (existingErr) return { ok: false, message: existingErr.message };

  if (existing?.id) {
    if (existing.status === 'accepted') return { ok: true, alreadyFriends: true };
    if (existing.status === 'pending') return { ok: true, pending: true };
    const up = await supabase
      .from('friend_requests')
      .update({ status: 'pending' })
      .eq('id', existing.id);
    if (up.error) return { ok: false, message: up.error.message };
    return { ok: true, pending: true };
  }

  const ins = await supabase
    .from('friend_requests')
    .insert({ requester_id: requesterId, recipient_id: targetId, status: 'pending' });
  if (ins.error) {
    if ((ins.error as any).code === '23505') return { ok: true, pending: true };
    return { ok: false, message: ins.error.message };
  }
  return { ok: true, pending: true };
}

export async function listIncomingFriendRequests(): Promise<{ req: FriendRequestRow; requester: PublicProfile | null }[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('friend_requests')
    .select('id,requester_id,recipient_id,status,created_at')
    .eq('recipient_id', user.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error || !Array.isArray(data)) return [];

  const reqs = data as FriendRequestRow[];
  const requesterIds = Array.from(new Set(reqs.map((r) => r.requester_id)));
  const { data: profs, error: profErr } = await supabase
    .from('profiles')
    .select('*')
    .in('id', requesterIds);

  const byId = new Map<string, PublicProfile>();
  (profErr ? [] : (profs || [])).forEach((p: any) => {
    const normalized = normalizeProfile(p);
    if (normalized?.user_id) byId.set(normalized.user_id, normalized);
  });
  return reqs.map((req) => ({ req, requester: byId.get(req.requester_id) ?? null }));
}

export async function listAcceptedRelationships(): Promise<{ req: FriendRequestRow; connection: PublicProfile | null; connectionId: string }[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('friend_requests')
    .select('id,requester_id,recipient_id,status,created_at')
    .eq('status', 'accepted')
    .or(`requester_id.eq.${user.id},recipient_id.eq.${user.id}`)
    .order('created_at', { ascending: false });
  if (error || !Array.isArray(data)) return [];

  const rows = data as FriendRequestRow[];
  const connectionIds = Array.from(new Set(rows.map((r) => (r.requester_id === user.id ? r.recipient_id : r.requester_id))));
  const { data: profs, error: profErr } = await supabase
    .from('profiles')
    .select('*')
    .in('id', connectionIds);

  const byId = new Map<string, PublicProfile>();
  (profErr ? [] : (profs || [])).forEach((p: any) => {
    const normalized = normalizeProfile(p);
    if (normalized?.user_id) byId.set(normalized.user_id, normalized);
  });

  return rows.map((req) => {
    const connectionId = req.requester_id === user.id ? req.recipient_id : req.requester_id;
    return { req, connectionId, connection: byId.get(connectionId) ?? null };
  });
}

export async function countIncomingPendingRequests(): Promise<number> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;
  const { count, error } = await supabase
    .from('friend_requests')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_id', user.id)
    .eq('status', 'pending');
  if (error) return 0;
  return count ?? 0;
}

export async function respondToFriendRequest(requestId: string, next: 'accepted' | 'declined'): Promise<{ ok: boolean; message?: string }> {
  const id = (requestId || '').trim();
  if (!id) return { ok: false, message: 'Invalid request' };
  const { error } = await supabase
    .from('friend_requests')
    .update({ status: next })
    .eq('id', id);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function unmergeRippleWith(userId: string): Promise<{ ok: boolean; message?: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: 'Not signed in' };
  const a = (userId || '').trim();
  const b = user.id;
  if (!a) return { ok: false, message: 'Invalid user' };
  if (a === b) return { ok: false, message: 'This is you' };

  const { error } = await supabase
    .from('friend_requests')
    .delete()
    .eq('status', 'accepted')
    .or(`and(requester_id.eq.${a},recipient_id.eq.${b}),and(requester_id.eq.${b},recipient_id.eq.${a})`);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function listFriendIds(): Promise<string[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('friend_requests')
    .select('requester_id,recipient_id')
    .eq('status', 'accepted')
    .or(`requester_id.eq.${user.id},recipient_id.eq.${user.id}`)
    .limit(500);
  if (error || !Array.isArray(data)) return [];
  const out = new Set<string>();
  for (const r of data as any[]) {
    const requester = r.requester_id as string;
    const recipient = r.recipient_id as string;
    if (requester && requester !== user.id) out.add(requester);
    if (recipient && recipient !== user.id) out.add(recipient);
  }
  return Array.from(out);
}

export type SocialActivityItem = {
  id: string;
  kind: 'listened' | 'rated' | 'marked_listened';
  actorId: string;
  actorName: string;
  actorAvatarUrl: string | null;
  createdAt: string;
  title: string;
  artistName?: string | null;
  rating?: number | null;
  spotifyUrl?: string | null;
  appleUrl?: string | null;
  artworkUrl?: string | null;
  itemType?: 'album' | 'track' | null;
};

export type ShareCardTopRatedItem = {
  id: string;
  title: string;
  artistName: string | null;
  artworkUrl: string | null;
  spotifyUrl: string | null;
  appleUrl: string | null;
  rating: number | null;
  itemType: 'album' | 'track' | 'single' | null;
};

export async function fetchShareCardTopRated(publicId: string, limit = 3): Promise<ShareCardTopRatedItem[]> {
  const pid = (publicId || '').trim();
  if (!pid) return [];
  const lim = Number.isFinite(limit) ? Math.max(1, Math.min(10, Math.floor(limit))) : 3;

  const { data, error } = await supabase.rpc('get_share_card_top_rated', { p_public_id: pid, p_limit: lim });
  if (error || !Array.isArray(data)) return [];

  return (data as any[]).map((r) => ({
    id: String(r.id),
    title: String(r.title || ''),
    artistName: r.artist_name ?? null,
    artworkUrl: r.artwork_url ?? null,
    spotifyUrl: r.spotify_url ?? null,
    appleUrl: r.apple_url ?? null,
    rating: typeof r.rating === 'number' ? r.rating : (r.rating != null ? Number(r.rating) : null),
    itemType: r.item_type === 'album' ? 'album' : r.item_type === 'track' ? 'track' : r.item_type === 'single' ? 'single' : null,
  }));
}

export async function fetchSocialActivity(): Promise<SocialActivityItem[]> {
  const { data: listRows, error } = await supabase.rpc('get_social_activity', { p_limit: 60 });
  if (error) {
    if (__DEV__) console.log('[social] get_social_activity failed', error);
    throw new Error(error.message || 'Social activity failed');
  }
  if (!Array.isArray(listRows) || listRows.length === 0) return [];

  const actorIds = Array.from(new Set((listRows as any[]).map((r) => String(r.user_id || '')).filter(Boolean)));
  if (!actorIds.length) return [];

  const { data: profs, error: profErr } = await supabase
    .from('profiles')
    .select('*')
    .in('id', actorIds);
  const byId = new Map<string, PublicProfile>();
  (profErr ? [] : (profs || [])).forEach((p: any) => {
    const normalized = normalizeProfile(p);
    if (normalized?.user_id) byId.set(normalized.user_id, normalized);
  });

  const rows = listRows as any[];
  const items: SocialActivityItem[] = rows.map((r) => {
    const profile = byId.get(r.user_id as string);
    const actorName = profile?.display_name || 'Listener';
    const actorAvatarUrl = profile?.avatar_url ?? null;
    const rating = typeof r.rating === 'number' ? r.rating : null;
    const doneAt = r.done_at ? String(r.done_at) : null;
    const ratedAt = r.rated_at ? String(r.rated_at) : null;
    const createdAt = ratedAt || doneAt || (r.created_at ? String(r.created_at) : new Date().toISOString());

    const kind: SocialActivityItem['kind'] =
      rating != null ? 'rated' : doneAt ? 'marked_listened' : 'listened';

    return {
      id: String(r.id),
      kind,
      actorId: String(r.user_id),
      actorName,
      actorAvatarUrl,
      createdAt,
      title: String(r.title || ''),
      artistName: r.artist_name ?? null,
      rating: rating ?? null,
      spotifyUrl: r.spotify_url ?? null,
      appleUrl: r.apple_url ?? null,
      artworkUrl: r.artwork_url ?? null,
      itemType: r.item_type === 'album' ? 'album' : 'track',
    };
  });

  return items;
}

function cryptoSafeId() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = new Uint8Array(16);
  try {
    if (!globalThis.crypto?.getRandomValues) throw new Error('missing crypto.getRandomValues');
    globalThis.crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function normalizeProfile(row: any): PublicProfile | null {
  if (!row || typeof row !== 'object') return null;
  const userId = (row.user_id || row.id) as string | undefined;
  if (!userId) return null;
  return {
    user_id: String(userId),
    display_name: String(row.display_name || 'Listener'),
    avatar_url: row.avatar_url ?? null,
    public_id: String(row.public_id || ''),
  };
}
