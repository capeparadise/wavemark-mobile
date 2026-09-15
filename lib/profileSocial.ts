import { supabase } from './supabase';
import { spotifyLookup, spotifySearch } from './spotify';

export type PublicProfile = {
  user_id: string;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  public_id: string;
  is_private: boolean;
  profile_setup_completed: boolean;
};

export type FollowRelationshipStatus = 'none' | 'requested' | 'following' | 'self';

export type ListenerSearchResult = Pick<PublicProfile, 'user_id' | 'display_name' | 'username' | 'avatar_url' | 'is_private'> & {
  relationship_status: Exclude<FollowRelationshipStatus, 'self'>;
};

export type ListenerProfile = Pick<PublicProfile, 'user_id' | 'display_name' | 'username' | 'avatar_url' | 'is_private'> & {
  relationship_status: FollowRelationshipStatus;
  follows_you: boolean;
  can_view_content: boolean;
  followers_count: number;
  following_count: number;
};

export type ListenerMusicItem = {
  section: 'recent' | 'top_rated';
  id: string;
  item_type: 'album' | 'track' | 'single';
  provider: 'spotify' | 'apple' | null;
  provider_id: string | null;
  spotify_id: string | null;
  apple_id: string | null;
  title: string;
  artist_name: string | null;
  artwork_url: string | null;
  release_date: string | null;
  spotify_url: string | null;
  apple_url: string | null;
  done_at: string | null;
  rating: number | null;
  rated_at: string | null;
};

const listenerArtworkRequests = new Map<string, Promise<string | null>>();

type ArtworkResolvableItem = Pick<
  ListenerMusicItem,
  'item_type' | 'provider' | 'provider_id' | 'spotify_id' | 'apple_id' | 'spotify_url' | 'apple_url' | 'artwork_url' | 'title' | 'artist_name'
>;

function normalizeArtworkText(value?: string | null) {
  return (value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function spotifyCatalogId(item: ArtworkResolvableItem) {
  if (item.spotify_id) return item.spotify_id;
  if (item.provider === 'spotify' && item.provider_id) return item.provider_id;
  if (!item.spotify_url) return null;
  try {
    const url = new URL(item.spotify_url);
    return url.pathname.match(/\/(?:album|track)\/([A-Za-z0-9]+)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

function appleCatalogId(item: ArtworkResolvableItem) {
  if (item.apple_id) return item.apple_id;
  if (item.provider === 'apple' && item.provider_id) return item.provider_id;
  if (!item.apple_url) return null;
  try {
    const url = new URL(item.apple_url);
    const trackId = url.searchParams.get('i');
    if (trackId && /^\d+$/.test(trackId)) return trackId;
    return url.pathname.match(/\/(?:album|song)\/[^/]+\/(\d+)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function resolveListenerArtwork(item: ArtworkResolvableItem) {
  if (item.artwork_url) return item.artwork_url;

  const spotifyId = spotifyCatalogId(item);
  const appleId = appleCatalogId(item);
  const cacheKey = spotifyId
    ? `spotify:${item.item_type === 'album' ? 'album' : 'track'}:${spotifyId}`
    : appleId
      ? `apple:${appleId}`
      : item.title && item.artist_name
        ? `search:${item.item_type}:${normalizeArtworkText(item.title)}:${normalizeArtworkText(item.artist_name)}`
        : null;
  if (!cacheKey) return null;

  const cached = listenerArtworkRequests.get(cacheKey);
  if (cached) return cached;

  const request = (async () => {
    if (spotifyId) {
      try {
        const result = await spotifyLookup(spotifyId, item.item_type === 'album' ? 'album' : 'track');
        const artwork = result?.[0]?.imageUrl;
        if (artwork) return artwork;
      } catch {
        // Fall through to Apple when both catalog identities are available.
      }
    }

    if (appleId) {
      try {
        const response = await fetch(`https://itunes.apple.com/lookup?id=${encodeURIComponent(appleId)}`);
        if (response.ok) {
          const data: any = await response.json();
          const artwork = data?.results?.[0]?.artworkUrl100 || data?.results?.[0]?.artworkUrl;
          if (artwork) return String(artwork).replace(/\d+x\d+bb/, '512x512bb');
        }
      } catch {
        // A placeholder remains the final fallback when neither catalog resolves.
      }
    }

    if (item.title && item.artist_name) {
      try {
        const title = normalizeArtworkText(item.title);
        const artist = normalizeArtworkText(item.artist_name);
        const type = item.item_type === 'album' ? 'album' : 'track';
        const results = await spotifySearch(`${item.title} ${item.artist_name}`, type);
        const exact = results.find((result) => (
          normalizeArtworkText(result.title) === title
          && [result.artist, ...(result.artistNames || [])]
            .some((name) => normalizeArtworkText(name) === artist)
          && !!result.imageUrl
        ));
        if (exact?.imageUrl) return exact.imageUrl;
      } catch {
        // The placeholder remains when the title-and-artist search cannot resolve safely.
      }
    }
    return null;
  })();

  listenerArtworkRequests.set(cacheKey, request);
  return request;
}

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

function cleanUsername(value: string) {
  return (value || '').trim().replace(/^@+/, '').toLowerCase();
}

export function isValidUsername(value: string) {
  return /^[a-z0-9][a-z0-9._]{1,18}[a-z0-9]$/.test(cleanUsername(value));
}

export async function checkUsernameAvailable(value: string): Promise<boolean> {
  const username = cleanUsername(value);
  if (!isValidUsername(username)) return false;
  const { data, error } = await supabase.rpc('check_username_available', { p_username: username });
  if (error) throw new Error(error.message || 'Could not check username');
  return data === true;
}

export async function saveMySocialProfile(input: {
  username: string;
  displayName?: string | null;
  isPrivate: boolean;
}): Promise<{ ok: true; profile: PublicProfile } | { ok: false; message: string }> {
  const username = cleanUsername(input.username);
  if (!isValidUsername(username)) {
    return { ok: false, message: 'Use 3–20 letters, numbers, dots or underscores.' };
  }
  const { data, error } = await supabase.rpc('save_my_social_profile', {
    p_username: username,
    p_display_name: input.displayName?.trim() || null,
    p_is_private: input.isPrivate,
  });
  if (error) {
    const raw = String(error.message || 'Could not save profile');
    const message = /taken|unique|duplicate/i.test(raw)
      ? 'That username is already taken.'
      : /function .* does not exist|schema cache/i.test(raw)
        ? 'Username setup is not available yet.'
        : raw;
    return { ok: false, message };
  }
  const row = Array.isArray(data) ? data[0] : data;
  const profile = normalizeProfile(row as any);
  if (!profile?.username) return { ok: false, message: 'Could not save profile.' };
  return { ok: true, profile };
}

export async function searchListenerProfiles(query: string, limit = 20): Promise<ListenerSearchResult[]> {
  const q = cleanUsername(query);
  if (q.length < 2) return [];
  const { data, error } = await supabase.rpc('search_listener_profiles', { p_query: q, p_limit: limit });
  if (error) throw new Error(error.message || 'Could not search listeners');
  if (!Array.isArray(data)) return [];
  return data.map((row: any) => ({
    user_id: String(row.user_id),
    display_name: String(row.display_name || 'Listener'),
    username: row.username ? String(row.username) : null,
    avatar_url: row.avatar_url ?? null,
    is_private: row.is_private !== false,
    relationship_status: row.relationship_status === 'following'
      ? 'following'
      : row.relationship_status === 'requested'
        ? 'requested'
        : 'none',
  }));
}

export async function getListenerProfile(username: string): Promise<ListenerProfile | null> {
  const clean = cleanUsername(username);
  if (!clean) return null;
  const { data, error } = await supabase.rpc('get_listener_profile', { p_username: clean });
  if (error) throw new Error(error.message || 'Could not load listener');
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.user_id) return null;
  const relationshipStatus: FollowRelationshipStatus = row.relationship_status === 'self'
    ? 'self'
    : row.relationship_status === 'following'
      ? 'following'
      : row.relationship_status === 'requested'
        ? 'requested'
        : 'none';
  return {
    user_id: String(row.user_id),
    display_name: String(row.display_name || 'Listener'),
    username: row.username ? String(row.username) : null,
    avatar_url: row.avatar_url ?? null,
    is_private: row.is_private !== false,
    relationship_status: relationshipStatus,
    follows_you: row.follows_you === true,
    can_view_content: row.can_view_content === true,
    followers_count: Number(row.followers_count || 0),
    following_count: Number(row.following_count || 0),
  };
}

export async function getListenerMusic(username: string, limit = 12): Promise<ListenerMusicItem[]> {
  const clean = cleanUsername(username);
  if (!clean) return [];
  const { data, error } = await supabase.rpc('get_listener_music', { p_username: clean, p_limit: limit });
  if (error) throw new Error(error.message || 'Could not load listener music');
  if (!Array.isArray(data)) return [];
  const rows: ListenerMusicItem[] = data.map((row: any) => ({
    section: row.section === 'top_rated' ? 'top_rated' : 'recent',
    id: String(row.id),
    item_type: row.item_type === 'album' ? 'album' : row.item_type === 'single' ? 'single' : 'track',
    provider: row.provider === 'apple' ? 'apple' : row.provider === 'spotify' ? 'spotify' : null,
    provider_id: row.provider_id != null ? String(row.provider_id) : null,
    spotify_id: row.spotify_id != null ? String(row.spotify_id) : null,
    apple_id: row.apple_id != null ? String(row.apple_id) : null,
    title: String(row.title || 'Untitled'),
    artist_name: row.artist_name ?? null,
    artwork_url: row.artwork_url ?? null,
    release_date: row.release_date ?? null,
    spotify_url: row.spotify_url ?? null,
    apple_url: row.apple_url ?? null,
    done_at: row.done_at ?? null,
    rating: typeof row.rating === 'number' ? row.rating : row.rating != null ? Number(row.rating) : null,
    rated_at: row.rated_at ?? null,
  }));
  if (rows.every((item) => !!item.artwork_url)) return rows;

  return Promise.all(rows.map(async (item) => {
    if (item.artwork_url) return item;
    const artworkUrl = await resolveListenerArtwork(item);
    return artworkUrl ? { ...item, artwork_url: artworkUrl } : item;
  }));
}

export async function followListener(userId: string): Promise<{ ok: boolean; status?: 'requested' | 'following'; message?: string }> {
  const { data, error } = await supabase.rpc('follow_listener', { p_user_id: userId });
  if (error) return { ok: false, message: error.message || 'Could not follow listener' };
  const status = data === 'accepted' ? 'following' : data === 'pending' ? 'requested' : null;
  return status ? { ok: true, status } : { ok: false, message: 'Could not follow listener' };
}

export async function unfollowListener(userId: string): Promise<{ ok: boolean; message?: string }> {
  const { data, error } = await supabase.rpc('unfollow_listener', { p_user_id: userId });
  if (error) return { ok: false, message: error.message || 'Could not unfollow listener' };
  return { ok: data === true };
}

export type FollowingProfile = Omit<ListenerSearchResult, 'relationship_status'> & {
  relationship_status: 'following' | 'requested';
  created_at: string | null;
};

export async function listMyFollowingProfiles(): Promise<FollowingProfile[]> {
  const { data, error } = await supabase.rpc('list_my_following_profiles');
  if (error) throw new Error(error.message || 'Could not load following');
  if (!Array.isArray(data)) return [];
  return data.map((row: any) => ({
    user_id: String(row.user_id),
    display_name: String(row.display_name || 'Listener'),
    username: row.username ? String(row.username) : null,
    avatar_url: row.avatar_url ?? null,
    is_private: row.is_private !== false,
    relationship_status: row.relationship_status === 'following' ? 'following' : 'requested',
    created_at: row.created_at ?? null,
  }));
}

export type IncomingFollowRequest = Pick<PublicProfile, 'user_id' | 'display_name' | 'username' | 'avatar_url'> & {
  created_at: string | null;
};

export async function listMyFollowRequests(): Promise<IncomingFollowRequest[]> {
  const { data, error } = await supabase.rpc('list_my_follow_requests');
  if (error) throw new Error(error.message || 'Could not load follow requests');
  if (!Array.isArray(data)) return [];
  return data.map((row: any) => ({
    user_id: String(row.user_id),
    display_name: String(row.display_name || 'Listener'),
    username: row.username ? String(row.username) : null,
    avatar_url: row.avatar_url ?? null,
    created_at: row.created_at ?? null,
  }));
}

export async function respondToFollowRequest(followerId: string, accept: boolean): Promise<{ ok: boolean; message?: string }> {
  const { data, error } = await supabase.rpc('respond_to_follow_request', { p_follower_id: followerId, p_accept: accept });
  if (error) return { ok: false, message: error.message || 'Could not update request' };
  return { ok: data === true };
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
  if (!['image/jpeg','image/png','image/webp','image/heic','image/heif'].includes(contentType)) {
    return { ok: false, message: 'Choose a JPEG, PNG, WebP or HEIC photo.' };
  }
  const path = `${user.id}/${Date.now()}.${ext}`;

  let body: ArrayBuffer;
  try {
    body = await (await fetch(uri)).arrayBuffer();
  } catch {
    return { ok: false, message: 'Could not read image' };
  }
  if (body.byteLength > 10 * 1024 * 1024) return { ok: false, message: 'Choose a photo smaller than 10 MB.' };

  const { error: upErr } = await supabase
    .storage
    .from('avatars')
    .upload(path, body, { upsert: true, contentType });
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

export type ConnectionInvitePreview = {
  status: 'valid' | 'connected' | 'invalid';
  inviter: PublicProfile | null;
};

export async function createConnectionInvite(): Promise<{ ok: boolean; token?: string; message?: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: 'Not signed in' };
  await ensureMyProfile();

  const { data, error } = await supabase.rpc('create_connection_invite');
  if (error) return { ok: false, message: error.message };
  const token = typeof data === 'string' ? data.trim() : '';
  if (!token) return { ok: false, message: 'Invite unavailable' };
  return { ok: true, token };
}

export async function getConnectionInvitePreview(token: string): Promise<ConnectionInvitePreview> {
  const clean = (token || '').trim();
  if (!clean) return { status: 'invalid', inviter: null };

  const { data, error } = await supabase.rpc('get_connection_invite_preview', { p_token: clean });
  if (error || !Array.isArray(data) || data.length === 0) return { status: 'invalid', inviter: null };
  const row = data[0] as any;
  const status = row.status === 'connected' ? 'connected' : row.status === 'valid' ? 'valid' : 'invalid';
  const inviter = normalizeProfile({
    id: row.inviter_id,
    display_name: row.display_name,
    avatar_url: row.avatar_url,
    public_id: row.public_id,
  });
  return { status, inviter };
}

export async function acceptConnectionInvite(token: string): Promise<{ ok: boolean; status: 'merged' | 'connected' | 'invalid'; message?: string }> {
  const clean = (token || '').trim();
  if (!clean) return { ok: false, status: 'invalid', message: 'Invite no longer available' };

  const { data, error } = await supabase.rpc('accept_connection_invite', { p_token: clean });
  if (error) return { ok: false, status: 'invalid', message: error.message };
  const status = typeof data === 'string' ? data : '';
  if (status === 'merged') return { ok: true, status: 'merged' };
  if (status === 'already_connected') return { ok: true, status: 'connected' };
  return { ok: false, status: 'invalid', message: 'Invite no longer available' };
}

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
  const modern = await supabase.rpc('list_my_follow_requests');
  if (!modern.error && Array.isArray(modern.data)) return modern.data.length;
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
  actorUsername: string | null;
  actorAvatarUrl: string | null;
  createdAt: string;
  title: string;
  artistName?: string | null;
  rating?: number | null;
  spotifyUrl?: string | null;
  appleUrl?: string | null;
  artworkUrl?: string | null;
  itemType?: 'album' | 'track' | null;
  provider?: 'spotify' | 'apple' | null;
  providerId?: string | null;
  spotifyId?: string | null;
  appleId?: string | null;
  releaseDate?: string | null;
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
  let { data: listRows, error } = await supabase.rpc('get_following_activity', { p_limit: 60 });
  if (error && /function .* does not exist|schema cache/i.test(String(error.message || ''))) {
    const legacy = await supabase.rpc('get_social_activity', { p_limit: 60 });
    listRows = legacy.data;
    error = legacy.error;
  }
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
    const actorUsername = profile?.username ?? null;
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
      actorUsername,
      actorAvatarUrl,
      createdAt,
      title: String(r.title || ''),
      artistName: r.artist_name ?? null,
      rating: rating ?? null,
      spotifyUrl: r.spotify_url ?? null,
      appleUrl: r.apple_url ?? null,
      artworkUrl: r.artwork_url ?? null,
      itemType: r.item_type === 'album' ? 'album' : 'track',
      provider: r.provider === 'apple' ? 'apple' : r.provider === 'spotify' ? 'spotify' : null,
      providerId: r.provider_id != null ? String(r.provider_id) : null,
      spotifyId: r.spotify_id != null ? String(r.spotify_id) : null,
      appleId: r.apple_id != null ? String(r.apple_id) : null,
      releaseDate: r.release_date ?? null,
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
    username: row.username ? String(row.username) : null,
    avatar_url: row.avatar_url ?? null,
    public_id: String(row.public_id || ''),
    is_private: row.is_private !== false,
    profile_setup_completed: row.profile_setup_completed === true,
  };
}
