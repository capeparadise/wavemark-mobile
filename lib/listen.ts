import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking } from 'react-native';
import { debugNS } from './debug';
import { supabase } from './supabase';
import { getMarket } from './spotify';

const debug = debugNS('listen');

export type ListenPlayer = 'apple' | 'spotify';

export type RatingValue = number; // 0.5..5.0 in 0.5 steps

export type ListenRow = {
  id: string;
  item_type: 'track' | 'album';
  provider: ListenPlayer; // source provider saved at insert time
  provider_id: string | null;

  title: string;
  artist_name: string | null;
  release_date?: string | null;
  // NEW:
  upcoming?: boolean | null;

  apple_url: string | null;
  apple_id: string | null;

  spotify_url: string | null;
  spotify_id: string | null;

  done_at: string | null; // ISO string or null
  rating?: RatingValue | null;
  review?: string | null;
  rated_at?: string | null; // ISO string
  created_at?: string | null;
};

export type UpcomingItem = {
  id: string;
  artist_id: string;
  artist_name: string | null;
  title: string;
  release_date: string; // ISO YYYY-MM-DD
  apple_url?: string | null;
  // Source of the upcoming item: 'apple' or 'musicbrainz'
  source?: string | null;
};

export async function fetchUpcomingClient(): Promise<UpcomingItem[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('upcoming_releases')
  .select('id,artist_id,artist_name,title,release_date,apple_url,source')
    .eq('user_id', user.id)
    .order('release_date', { ascending: true });
  if (error || !data) return [];
  return data as any as UpcomingItem[];
}

export async function addUpcomingToListen(item: UpcomingItem): Promise<{ ok: boolean; id?: string; message?: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: 'Not signed in' };
  const { data, error } = await supabase
    .from('listen_list')
    .insert({
      user_id: user.id,
      item_type: 'album',
      provider: 'apple',
      provider_id: item.apple_url ?? item.title,
      title: item.title,
      artist_name: item.artist_name,
      apple_url: item.apple_url ?? null,
      apple_id: null,
      spotify_url: null,
      spotify_id: null,
      release_date: item.release_date,
      upcoming: true,
    })
    .select('id')
    .single();
  if (error) return { ok: false, message: error.message };
  // Link back to upcoming row (best-effort)
  try { await supabase.from('upcoming_releases').update({ resolved_listen_id: data?.id ?? null }).eq('id', item.id); } catch {}
  return { ok: true, id: data?.id as string };
}

// Manual upcoming insertion (when external sources miss a preorder)

// Reconcile: when a row's release_date has passed, mark upcoming=false
export async function reconcileListenUpcoming(): Promise<void> {
  const today = new Date().toISOString().slice(0,10);
  await supabase
    .from('listen_list')
    .update({ upcoming: false })
    .lte('release_date', today)
    .eq('upcoming', true);
}

export type AppleTrack = {
  trackId: number;
  trackName: string;
  artistName: string;
  trackViewUrl?: string;
  artworkUrl?: string;
  artworkUrl100?: string;
};

export type AppleAlbum = {
  collectionId: number;
  collectionName: string;
  artistName: string;
  collectionViewUrl?: string;
  artworkUrl?: string;
  artworkUrl100?: string;
};

const DEFAULT_PLAYER_KEY = 'default_player';

export async function getDefaultPlayer(): Promise<ListenPlayer> {
  try {
    const v = await AsyncStorage.getItem(DEFAULT_PLAYER_KEY);
  debug('pref:get', DEFAULT_PLAYER_KEY, v);
    if (v === 'apple' || v === 'spotify') return v;
  } catch (e) {
  debug('pref:get:error', e);
  }
  return 'apple';
}

export async function setDefaultPlayer(p: ListenPlayer) {
  debug('pref:set', DEFAULT_PLAYER_KEY, p);
  await AsyncStorage.setItem(DEFAULT_PLAYER_KEY, p);
}

export async function addToListenList(
  type: 'track' | 'album',
  item: AppleTrack | AppleAlbum
): Promise<{ ok: true; row: ListenRow } | { ok: false; message: string }> {
  // Ensure we have an auth session & user id (RLS requires it)
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData?.session ?? null;
  if (!session) {
    return { ok: false, message: 'Not signed in. Please try again in a moment.' };
  }
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr) return { ok: false, message: userErr.message };
  if (!user) return { ok: false, message: 'Could not determine user. Please try again.' };

  let appleUrl =
    type === 'track'
      ? (item as any).trackViewUrl ?? null
      : (item as any).collectionViewUrl ?? null;

  const appleId =
    type === 'track'
      ? (item as any).trackId != null
        ? String((item as any).trackId)
        : null
      : (item as any).collectionId != null
        ? String((item as any).collectionId)
        : null;

  // If we don't have an Apple deep link yet, fetch it via iTunes Lookup by ID
  if (!appleUrl && appleId) {
    try {
      const res = await fetch(`https://itunes.apple.com/lookup?id=${encodeURIComponent(appleId)}`);
      if (res.ok) {
        const j = (await res.json()) as any;
        const r = j?.results?.[0];
        if (r) {
          // Prefer the correct view URL by type
          appleUrl =
            type === 'track'
              ? (r.trackViewUrl ?? r.collectionViewUrl ?? null)
              : (r.collectionViewUrl ?? r.trackViewUrl ?? null);
        }
      }
    } catch {
      // best-effort; fallback is search later
    }
  }

  const title =
    type === 'track'
      ? (item as any).trackName ?? ''
      : (item as any).collectionName ?? '';

  const artist = (item as any).artistName ?? null;

  // Resolve a Spotify ID/URL via our Supabase Edge Function (best-effort)
  let spotifyId: string | null = null;
  let spotifyUrl: string | null = null;
  try {
    const { data: spot } = await supabase.functions.invoke('spotify-resolve', {
      body: {
        type, // 'track' | 'album'
        title,
        artist: artist ?? undefined,
      },
    });
    if (spot?.id) spotifyId = String(spot.id);
    if (spot?.url) spotifyUrl = String(spot.url);
  } catch {
    // ignore resolver failures; we'll fall back to search later
  }

  const insertPayload = {
    // IMPORTANT for RLS:
    user_id: user.id, // must equal auth.uid() under your policy
    item_type: type,
  provider: 'apple' as ListenPlayer,
    provider_id: appleId,
    title,
    artist_name: artist,
    apple_url: appleUrl,
    apple_id: appleId,
    spotify_id: spotifyId,
    spotify_url: spotifyUrl,
  };

  // Perform insert and handle Supabase’s { error } pattern (no exceptions)
  const { data: inserted, error: insertErr } = await supabase
    .from('listen_list')
    .insert(insertPayload)
    .select(
      'id,item_type,provider,provider_id,title,artist_name,apple_url,apple_id,spotify_url,spotify_id,done_at'
    )
    .single();

  if (insertErr) {
    // Surface the actual DB error message so callers can display it
    debug('add:insertErr', {
      code: (insertErr as any)?.code,
      message: (insertErr as any)?.message,
      details: (insertErr as any)?.details,
      hint: (insertErr as any)?.hint,
      payload: insertPayload,
    });
    // Diagnostic: list any rows under this user that match title/type or IDs
    const cols = 'id,title,item_type,provider,provider_id,apple_id,spotify_id,done_at,created_at';
  const { data: diag1, error: diagErr1 } = await supabase
      .from('listen_list')
      .select(cols)
      .eq('user_id', user.id)
      .eq('item_type', type)
      .eq('title', title);
  debug('add:diag:title', { error: diagErr1?.message, rows: diag1 });

    const orParts: string[] = [];
    if (appleId) orParts.push(`apple_id.eq.${appleId}`);
    if (spotifyId) orParts.push(`spotify_id.eq.${spotifyId}`);
    if (orParts.length) {
      const { data: diag2, error: diagErr2 } = await supabase
        .from('listen_list')
        .select(cols)
        .eq('user_id', user.id)
        .eq('item_type', type)
        .or(orParts.join(','));
  debug('add:diag:ids', { error: diagErr2?.message, rows: diag2 });
    }
    // Return the raw DB error message to the caller
    return { ok: false, message: (insertErr as any)?.message ?? 'Add failed' };
  }

  if (!insertErr && inserted) {
    debug('add:inserted', { id: inserted.id });
    return { ok: true, row: inserted as ListenRow };
  }

  // Duplicate key handling (unique constraint)
  const code = (insertErr as any)?.code ?? '';
  const msg = String((insertErr as any)?.message ?? '');
  if (code === '23505' || /duplicate key value/i.test(msg)) {
    const columns =
      'id,item_type,provider,provider_id,title,artist_name,apple_url,apple_id,spotify_url,spotify_id,done_at';

    // Build an OR filter using available identifiers
    const ors: string[] = [];
    if (appleId) {
      ors.push(`apple_id.eq.${appleId}`);
      // If your unique constraint is on provider_id for Apple
      ors.push(`provider_id.eq.${appleId}`);
    }
    if (spotifyId) {
      ors.push(`spotify_id.eq.${spotifyId}`);
      ors.push(`provider_id.eq.${spotifyId}`);
    }
    // Fallback by normalized title (best-effort)
    const normTitle = title.replace(/\s+/g, ' ').trim();
    ors.push(`title.eq.${normTitle}`);

    // Try ID-based lookup first (with OR), then fallback to title+type if needed
    let existing = null as any;
    if (ors.length > 0) {
      const { data: byIds } = await supabase
        .from('listen_list')
        .select(columns)
        .eq('user_id', user.id)
        .eq('item_type', type)
        .or(ors.join(','))
        .maybeSingle();
      existing = byIds ?? null;
    }

    if (!existing) {
      const { data: byTitle } = await supabase
        .from('listen_list')
        .select(columns)
        .eq('user_id', user.id)
        .eq('item_type', type)
        .eq('title', normTitle)
        .maybeSingle();
      existing = byTitle ?? null;
    }

  if (existing) {
      // If the item already exists but is missing Spotify fields,
      // and our resolver returned them, patch the row once.
      if ((existing && (!existing.spotify_url || !existing.spotify_id)) && (spotifyUrl || spotifyId)) {
        const patch: Partial<ListenRow> = {};
        if (!existing.spotify_url && spotifyUrl) patch.spotify_url = spotifyUrl;
        if (!existing.spotify_id && spotifyId) patch.spotify_id = spotifyId;
        if (Object.keys(patch).length) {
          const { data: updated } = await supabase
            .from('listen_list')
            .update(patch)
            .eq('id', existing.id)
            .select(
              'id,item_type,provider,provider_id,title,artist_name,apple_url,apple_id,spotify_url,spotify_id,done_at'
            )
            .single();
          if (updated) existing = updated;
        }
      }
  debug('add:duplicate:return', { id: existing.id });
      return { ok: true, row: existing as ListenRow };
    }

    return { ok: false, message: 'Item already exists in your list.' };
  }

 debug('add:failed', insertErr);
 return { ok: false, message: msg || 'Failed to add item' };
}

export async function fetchListenList(): Promise<ListenRow[]> {
  const { data, error } = await supabase
    .from('listen_list')
    // add created_at to the projection if present in your table
    .select(
  'id,item_type,provider,provider_id,title,artist_name,apple_url,apple_id,spotify_url,spotify_id,done_at,rating,rated_at,created_at'
    )
    .order('done_at', { ascending: true, nullsFirst: true })
    .order('id', { ascending: false });

  if (error || !data) return [];
  return data as ListenRow[];
}

export async function fetchHistory(): Promise<{ ok: true; rows: ListenRow[] } | { ok: false; message: string }> {
  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr) return { ok: false, message: userErr.message };
  if (!user) return { ok: false, message: 'Not signed in' };

  const { data, error } = await supabase
    .from('listen_list')
    .select('id,item_type,provider,provider_id,title,artist_name,apple_url,apple_id,spotify_url,spotify_id,done_at,rating,rated_at,created_at')
    .eq('user_id', user.id)
    .not('done_at', 'is', null)
    .order('rated_at', { ascending: false, nullsFirst: false })
    .order('done_at', { ascending: false, nullsFirst: false });

  if (error) return { ok: false, message: error.message };
  return { ok: true, rows: (data ?? []) as ListenRow[] };
}

export async function fetchUpcoming(): Promise<{ ok: true; rows: ListenRow[] } | { ok: false; message: string }> {
  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr) return { ok: false, message: userErr.message };
  if (!user) return { ok: false, message: 'Not signed in' };

  const { data, error } = await supabase
    .from('listen_list')
    .select('id,item_type,title,artist_name,release_date,upcoming,apple_url,spotify_url,created_at')
    .eq('user_id', user.id)
    .eq('upcoming', true)
    .order('release_date', { ascending: true, nullsFirst: false });

  if (error) return { ok: false, message: error.message };
  return { ok: true, rows: (data ?? []) as ListenRow[] };
}

export async function reconcileReleased(): Promise<void> {
  const res = await fetchUpcoming();
  if (!('ok' in res) || !res.ok) return;
  const today = new Date().toISOString().slice(0,10);
  const toRelease = res.rows.filter(r => r.release_date && r.release_date <= today);
  for (const r of toRelease) {
    await supabase.from('listen_list').update({ upcoming: false }).eq('id', r.id);
  }
}

export async function addToListFromSearch(input: {
  type: 'track' | 'album',
  title: string,
  artist?: string | null,
  releaseDate?: string | null,
  appleUrl?: string | null,
  spotifyUrl?: string | null,
}): Promise<{ ok: boolean; id?: string; upcoming?: boolean; message?: string }> {
  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr) return { ok: false, message: userErr.message };
  if (!user) return { ok: false, message: 'Not signed in' };

  const today = new Date().toISOString().slice(0,10);
  const upcoming = !!(input.releaseDate && input.releaseDate > today);

  // Derive provider + provider_id to satisfy NOT NULL constraint
  const extractSpotifyId = (url?: string | null): string | null => {
    if (!url) return null;
    try {
      const m = url.match(/open\.spotify\.com\/(track|album)\/([A-Za-z0-9]+)/);
      return m?.[2] ?? null;
    } catch { return null; }
  };
  const extractAppleId = (url?: string | null): string | null => {
    if (!url) return null;
    try {
      const u = new URL(url);
      const qId = u.searchParams.get('i');
      if (qId) return qId;
      const m = u.pathname.match(/\/album\/[^/]+\/(\d+)/);
      if (m?.[1]) return m[1];
      return null;
    } catch { return null; }
  };

  const spotifyId = extractSpotifyId(input.spotifyUrl);
  const appleId = extractAppleId(input.appleUrl);
  const provider: 'spotify' | 'apple' = spotifyId ? 'spotify' : 'apple';
  // Fallback provider_id to a stable string if we couldn't parse an ID
  const provider_id = (spotifyId || appleId || input.appleUrl || input.title).toString();

  const { data, error } = await supabase
    .from('listen_list')
    .insert({
      user_id: user.id,
      item_type: input.type,
      provider,
      provider_id,
      title: input.title,
      artist_name: input.artist ?? null,
      apple_url: input.appleUrl ?? null,
      apple_id: appleId ?? null,
      spotify_url: input.spotifyUrl ?? null,
      spotify_id: spotifyId ?? null,
      release_date: input.releaseDate ?? null,
      upcoming,
    })
    .select('id, upcoming')
    .single();

  if (error) return { ok: false, message: error.message };
  return { ok: true, id: (data as any)?.id, upcoming: (data as any)?.upcoming ?? upcoming };
}

export async function markDone(
  id: string,
  makeDone: boolean
): Promise<{ ok: boolean; message?: string }> {
  const patch = { done_at: makeDone ? new Date().toISOString() : null };

  const { error } = await supabase
    .from('listen_list')
    .update(patch)
    .eq('id', id);

  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function removeListen(
  id: string
): Promise<{ ok: boolean; message?: string }> {
  const { error } = await supabase.from('listen_list').delete().eq('id', id);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}



function buildAppleSearchUrl(title: string, artist?: string | null) {
  const q = encodeURIComponent([title, artist].filter(Boolean).join(' '));
  return `https://music.apple.com/us/search?term=${q}`;
}

function buildSpotifySearchUrl(title: string, artist?: string | null) {
  const q = encodeURIComponent([title, artist].filter(Boolean).join(' '));
  return `https://open.spotify.com/search/${q}`;
}

function slugifyApple(s?: string | null) {
  const t = (s || '').toString().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-');
  return t || 'music';
}

function normalizeToMusicApple(url?: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = 'music.apple.com';
    if (u.hostname === host) return url; // already universal
    if (!/itunes\.apple\.com|music\.apple\.com/.test(u.hostname)) return url; // leave other domains
    u.hostname = host;
    return u.toString();
  } catch { return url ?? null; }
}

function buildAppleUniversalLinkFromIds(
  itemType: ListenRow['item_type'],
  ids: { trackId?: string | null; albumId?: string | null },
  country?: string | null
) {
  const cc = (country || '').toLowerCase() || 'us';
  if (itemType === 'track' && ids.trackId && ids.albumId) {
    // Canonical track deep link pattern
    return `https://music.apple.com/${cc}/album/${ids.albumId}?i=${ids.trackId}`;
  }
  if (itemType === 'album' && ids.albumId) {
    return `https://music.apple.com/${cc}/album/${ids.albumId}`;
  }
  return null;
}

async function itunesLookupById(id: string, country?: string | null): Promise<any | null> {
  try {
    const cc = (country || 'US').toUpperCase();
    const url = `https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}&country=${cc}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const j = (await res.json()) as any;
    const r = (j && Array.isArray(j.results)) ? j.results[0] : null;
    return r ?? null;
  } catch { return null; }
}

async function tryOpen(url: string | null | undefined) {
  if (!url) return false;
  try {
    const can = await Linking.canOpenURL(url);
    if (!can) return false;
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

async function tryApple(item: ListenRow) {
  debug('tryApple', 'url=', item.apple_url, 'id=', item.apple_id);
  // 1) Try stored deep link first
  if (await tryOpen(item.apple_url)) return true;

  // 2) If we have an Apple ID, do a direct iTunes lookup to get precise URLs and album id
  const market = getMarket() || 'US';
  if (item.apple_id) {
    const lu = await itunesLookupById(item.apple_id, market);
    if (lu) {
      const trackId = lu.trackId ? String(lu.trackId) : null;
      const albumId = lu.collectionId ? String(lu.collectionId) : null;
      const trackView = lu.trackViewUrl ?? null;
      const collView = lu.collectionViewUrl ?? null;
      const artistSlug = slugifyApple(lu.artistName);
      const albumSlug = slugifyApple(lu.collectionName);

      // Try Music universal link constructed from IDs first
      const deep = buildAppleUniversalLinkFromIds(item.item_type, { trackId, albumId }, market)
        || (albumId ? `https://music.apple.com/${(market||'US').toLowerCase()}/album/${albumSlug}/${albumId}` : null)
        || (trackId && albumId ? `https://music.apple.com/${(market||'US').toLowerCase()}/album/${albumSlug}/${albumId}?i=${trackId}` : null);
      if (deep) {
        debug('tryApple:universalFromLookup', deep);
        if (await tryOpen(deep)) return true;
      }
      // Then try the view URLs returned by lookup
      if (item.item_type === 'track' && (await tryOpen(normalizeToMusicApple(trackView)))) return true;
      if (item.item_type === 'album' && (await tryOpen(normalizeToMusicApple(collView)))) return true;
      // As a last attempt from lookup, try whichever exists
      if (await tryOpen(normalizeToMusicApple(trackView || collView))) return true;
    }
  }

  // 3) Resolve via iTunes Search API to get a proper view URL when IDs are missing
  try {
    const cc = (market || 'US').toUpperCase();
    const term = encodeURIComponent([item.title, item.artist_name].filter(Boolean).join(' '));
    const entity = item.item_type === 'track' ? 'musicTrack' : 'album';
    const url = `https://itunes.apple.com/search?term=${term}&country=${cc}&entity=${entity}&limit=5`;
    debug('tryApple:itunesSearch', url);
    const res = await fetch(url);
    if (res.ok) {
      const j = (await res.json()) as any;
      const norm = (s: string | null | undefined) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const wantTitle = norm(item.title);
      const wantArtist = norm(item.artist_name || '');
      const candidates = Array.isArray(j?.results) ? j.results : [];
      // Strict: prefer exact normalized title and artist
      let best = candidates.find((r: any) => {
        const t = norm(item.item_type === 'track' ? r.trackName : r.collectionName);
        const a = norm(r.artistName);
        return t === wantTitle && (!!wantArtist ? a === wantArtist : true);
      });
      // Fallback: partial match on title
      if (!best) {
        best = candidates.find((r: any) => {
          const t = norm(item.item_type === 'track' ? r.trackName : r.collectionName);
          return t === wantTitle || t.includes(wantTitle);
        });
      }
      const view = best ? (item.item_type === 'track' ? best.trackViewUrl : best.collectionViewUrl) : null;
      if (await tryOpen(view)) return true;
    }
  } catch (e) {
    debug('tryApple:itunesSearch:error', e);
  }

  // 4) Final fallback: web search (may open Safari or app homepage)
  const search = buildAppleSearchUrl(item.title, item.artist_name);
  debug('tryApple:fallbackSearch', search);
  return await tryOpen(search);
}

async function trySpotify(item: ListenRow) {
  debug('trySpotify', 'url=', item.spotify_url, 'id=', item.spotify_id);

  // If there's a stored spotify_url, try to open it directly (best-effort)
  if (item.spotify_url) {
    try {
      await Linking.openURL(item.spotify_url);
      debug('trySpotify:opened', item.spotify_url);
      return true;
    } catch (e) {
      debug('trySpotify:failedDeep', e);
    }
  }

  // 2) Deep link by ID if present
  if (item.spotify_id) {
    const path = item.item_type === 'track' ? 'track' : 'album';
    const deep = `https://open.spotify.com/${path}/${item.spotify_id}`;
  debug('trySpotify:idDeep', deep);
    if (await tryOpen(deep)) return true;
  }

  // Build query once
  const q = [item.title, item.artist_name].filter(Boolean).join(' ');

  // 3) Preferred iOS app-scheme search (most reliable)
  const appSearchQ = `spotify://search?q=${encodeURIComponent(q)}`;
  debug('trySpotify:appSearch', appSearchQ);
  if (await tryOpen(appSearchQ)) return true;

  // 4) Legacy scheme fallback
  const legacySearch = `spotify:search:${encodeURIComponent(q)}`;
  debug('trySpotify:legacySearch', legacySearch);
  if (await tryOpen(legacySearch)) return true;

  // 5) Web universal link (may still route into app)
  const webSearch = buildSpotifySearchUrl(item.title, item.artist_name);
  debug('trySpotify:webSearch', webSearch);
  return await tryOpen(webSearch);
}

export async function openByDefaultPlayer(
  item: ListenRow,
  preferredOverride?: ListenPlayer
): Promise<boolean> {
  const preferred = preferredOverride ?? (await getDefaultPlayer());

  // DEBUG START
  debug('openByDefaultPlayer', 'preferred =', preferred, 'title =', item.title);
  // DEBUG END

  if (preferred === 'apple') {
    const a = await tryApple(item);
  debug('openByDefaultPlayer:apple', { success: a });
    if (a) return true;
  const s = await trySpotify(item);
  debug('openByDefaultPlayer:fallbackSpotify', { success: s });
    return s;
  } else {
  const s = await trySpotify(item);
  debug('openByDefaultPlayer:spotify', { success: s });
    if (s) return true;
  const a = await tryApple(item);
  debug('openByDefaultPlayer:fallbackApple', { success: a });
    return a;
  }
}

// Compatibility wrappers for older callers expecting these names
export async function openInAppleMusic(item: ListenRow): Promise<boolean> {
  return await tryApple(item);
}

export async function openInSpotify(item: ListenRow): Promise<boolean> {
  return await trySpotify(item);
}

function normalizeRating(r: number): RatingValue {
  // Clamp 0.5..5.0 and snap to nearest 0.5
  const snapped = Math.round(r * 2) / 2;
  const clamped = Math.min(5, Math.max(0.5, snapped));
  return clamped as RatingValue;
}

export async function setRating(id: string, rating: number, review?: string) {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user;
    if (!user) return { ok: false, message: 'Not signed in' };

    const r = normalizeRating(rating);
    const payload = {
      rating: r,
      review: review ?? null,
      rated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('listen_list')
      .update(payload)
      .eq('id', id)
      .eq('user_id', user.id)
      .select('id, rating, review, rated_at')
      .maybeSingle();

    if (error) {
      debug('rate:set:error', error);
      return { ok: false, message: 'Could not save rating', error };
    }
    debug('rate:set:ok', data);
    return { ok: true, row: data };
  } catch (e) {
    debug('rate:set:catch', e);
    return { ok: false, message: 'Unexpected error', error: e };
  }
}

export async function clearRating(id: string) {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user;
    if (!user) return { ok: false, message: 'Not signed in' };

    const { data, error } = await supabase
      .from('listen_list')
      .update({ rating: null, review: null, rated_at: null })
      .eq('id', id)
      .eq('user_id', user.id)
      .select('id, rating, review, rated_at')
      .maybeSingle();

    if (error) {
      debug('rate:clear:error', error);
      return { ok: false, message: 'Could not clear rating', error };
    }
    debug('rate:clear:ok', data);
    return { ok: true, row: data };
  } catch (e) {
    debug('rate:clear:catch', e);
    return { ok: false, message: 'Unexpected error', error: e };
  }
}

export async function fetchRatedHistory(limit = 50, offset = 0) {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return { ok: false, message: 'Not signed in' };

  const { data, error } = await supabase
    .from('listen_list')
    .select('*')
    .eq('user_id', user.id)
    .not('rating', 'is', null)
    .order('rated_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return { ok: false, message: 'Fetch failed', error };
  return { ok: true, rows: data };
}
