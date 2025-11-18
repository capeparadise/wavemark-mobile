import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, AppState, FlatList, Image, Pressable, Text, TextInput, View } from 'react-native';
import FollowButton from '../../components/FollowButton';
import { H } from '../../components/haptics';
import Screen from '../../components/Screen';
import { formatDate } from '../../lib/date';
import { fetchFeed, listFollowedArtists, type FeedItem } from '../../lib/follow';
import { addToListFromSearch } from '../../lib/listen';
import { getNewReleases } from '../../lib/recommend';
import { getMarket, parseSpotifyUrlOrId, spotifyLookup, spotifySearch, type SpotifyResult } from '../../lib/spotify';
import { artistAlbums, artistSearch, artistTopTracks, fetchArtistDetails } from '../../lib/spotifyArtist';

type Row = { kind: 'section-title'; title: string }
  | { kind: 'new'; id: string; title: string; artist: string; releaseDate?: string | null; spotifyUrl?: string | null; imageUrl?: string | null; type?: 'album' | 'single' | 'ep' }
  | { kind: 'search'; r: SpotifyResult };

export default function DiscoverTab() {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [searchRows, setSearchRows] = useState<SpotifyResult[]>([]);
  // Upcoming removed
  const [artist, setArtist] = useState<{ id: string; name: string } | null>(null);
  const [artistAlbumsRows, setArtistAlbumsRows] = useState<Awaited<ReturnType<typeof artistAlbums>>>([]);
  const [artistTracksRows, setArtistTracksRows] = useState<Awaited<ReturnType<typeof artistTopTracks>>>([]);
  const [newReleases, setNewReleases] = useState<Awaited<ReturnType<typeof getNewReleases>>>([]);
  // Removed upcoming list
  // Genres removed from Discover
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<{ id: string; name: string; imageUrl?: string | null }[]>([]);
  const [debounceTimer, setDebounceTimer] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [fallbackFeed, setFallbackFeed] = useState<FeedItem[]>([]);
  const [picked, setPicked] = useState<Array<{ id: string; artistId: string; title: string; artist: string; releaseDate?: string | null; spotifyUrl?: string | null; imageUrl?: string | null; type?: 'album' | 'single' | 'ep' }>>([]);
  const [pickedLoading, setPickedLoading] = useState(false);
  // Track items saved during this session to show a ✓ instead of Save/Add
  const [addedIds, setAddedIds] = useState<Record<string, true>>({});
  // Clean-bubble data: details (name/photo) and latest recent release per followed artist
  const [followedDetails, setFollowedDetails] = useState<Record<string, { name: string; imageUrl?: string | null }>>({});
  const [recentByArtist, setRecentByArtist] = useState<Record<string, { latestId?: string; latestDate?: string | null }>>({});
  // Cache for artist profile images used in the "picked for you" lane
  const [artistImageMap, setArtistImageMap] = useState<Record<string, string>>({});
  const [artistNameMap, setArtistNameMap] = useState<Record<string, string>>({});
  const artistImgPending = useRef<Set<string>>(new Set());
  // Artist profile image cache (V2 adds kind to avoid album art contamination). We'll read V1 as legacy fallback.
  const IMAGE_CACHE_KEY_V2 = 'artistImagesCacheV2';
  const IMAGE_CACHE_KEY_V1 = 'artistImagesCacheV1';
  const PICKED_CACHE_KEY = 'pickedCacheV1';
  const [pickedDebug, setPickedDebug] = useState<{ followed: number; feedRecents: number; albumRecents: number; trackRecents: number; final: number; missing: number } | null>(null);
  // Known canonical IDs to disambiguate same-name artists (minimal, surgical fix)
  const CANONICAL_BY_NAME: Record<string, string> = useMemo(() => ({
    // use lowercase keys
    'dave': '2wY79sveU1sp5g7SokKOiI', // UK rapper (Santandave)
  }), []);
  const canonicalize = useCallback((name: string, id: string | null | undefined) => {
    const key = (name || '').toString().trim().toLowerCase();
    const target = CANONICAL_BY_NAME[key];
    return target ? target : (id || '');
  }, [CANONICAL_BY_NAME]);

  // Load persistent cache (24h TTL)
  useEffect(() => {
    (async () => {
      try {
        const DAY_MS = 24*60*60*1000; const now = Date.now();
        const loadKey = async (key: string) => {
          try {
            const raw = await AsyncStorage.getItem(key);
            if (!raw) return {} as Record<string, string>;
            const parsed = JSON.parse(raw);
            const out: Record<string, string> = {};
            Object.entries(parsed || {}).forEach(([id, v]: any) => {
              const tsOk = typeof v?.ts === 'number' && (now - v.ts) < DAY_MS;
              const kindOk = key === IMAGE_CACHE_KEY_V2 ? (v?.k === 'artist') : true;
              if (v && v.url && tsOk && kindOk) out[id] = v.url;
            });
            return out;
          } catch { return {} as Record<string, string>; }
        };
        const v2 = await loadKey(IMAGE_CACHE_KEY_V2);
        const v1 = await loadKey(IMAGE_CACHE_KEY_V1);
        const merged = { ...v1, ...v2 };
        if (Object.keys(merged).length) setArtistImageMap(merged);
      } catch {}
    })();
  }, []);

  // One-time: clear any stale alias storage introduced previously
  useEffect(() => {
    (async () => {
      try { await AsyncStorage.removeItem('artistIdAliasV1'); } catch {}
    })();
  }, []);

  // Hydrate cached picked-for-you so UI shows immediately while refreshing
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(PICKED_CACHE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        let arr = Array.isArray(parsed?.items) ? parsed.items : [];
        // Drop entries missing valid artistId to avoid broken navigation
        arr = arr.filter((it: any) => typeof it?.artistId === 'string' && /^[A-Za-z0-9]{22}$/.test(it.artistId));
        const ts = typeof parsed?.ts === 'number' ? parsed.ts : 0;
        const DAY_MS = 24*60*60*1000;
        if (!arr.length) return;
        // Use cache if within 24h; otherwise still use but will be replaced after load
        setPicked(arr);
      } catch {}
    })();
  }, []);

  // Shimmer component for loading avatars
  const Shimmer = ({ size = 80, borderRadius = 40 }: { size?: number; borderRadius?: number }) => {
    const anim = useRef(new Animated.Value(0)).current;
    useEffect(() => {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(anim, { toValue: 1, duration: 800, useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0, duration: 800, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => { loop.stop(); };
    }, [anim]);
    const opacity = anim.interpolate({ inputRange: [0,1], outputRange: [0.45, 0.9] });
    return (
      <Animated.View style={{ position: 'absolute', top: 0, left: 0, width: size, height: size, borderRadius, backgroundColor: '#e5e7eb', opacity }} />
    );
  };

  // Loader
  const load = useCallback(async () => {
    const DAYS = 28;
  const thisRun = Symbol('load');
  const ACTIVE_KEY = '__discover_active_load';
    try {
      const [nr] = await Promise.all([
        getNewReleases(DAYS),
      ]);
  setNewReleases(nr);
      if (!nr || nr.length === 0) {
        try {
          const feed = await fetchFeed();
          setFallbackFeed(feed.slice(0, 20));
        } catch {
          setFallbackFeed([]);
        }
      } else {
        setFallbackFeed([]);
      }

      // Build clean bubbles from followed artists only
      try {
        setPickedLoading(true);
        const followed = await listFollowedArtists();
        if (!followed || followed.length === 0) {
          setFollowedDetails({});
          setRecentByArtist({});
        } else {
          const market = getMarket();
          const cutoffTs = Date.now() - DAYS * 24 * 60 * 60 * 1000;
          const normalizeDate = (s?: string | null): string | null => {
            if (!s) return null;
            let x = String(s);
            if (/^\d{4}$/.test(x)) x = `${x}-07-01`;
            else if (/^\d{4}-\d{2}$/.test(x)) x = `${x}-15`;
            return x;
          };
          const isRecent = (s?: string | null) => {
            const n = normalizeDate(s);
            if (!n) return false;
            const t = Date.parse(n);
            return !Number.isNaN(t) && t >= cutoffTs;
          };
          const details: Record<string, { name: string; imageUrl?: string | null }> = {};
          const recents: Record<string, { latestId?: string; latestDate?: string | null }> = {};
          await Promise.all(followed.map(async (fa) => {
            const id = fa.id;
            // details (name/photo)
            try {
              const det = await fetchArtistDetails(id);
              if (det) details[id] = { name: det.name || fa.name, imageUrl: det.imageUrl ?? null };
              else details[id] = { name: fa.name, imageUrl: null };
            } catch { details[id] = { name: fa.name, imageUrl: null }; }
            // albums and recent pick
            try {
              const tryMk = Array.from(new Set([market, 'GB', 'US'].filter(Boolean)));
              let albs: Awaited<ReturnType<typeof artistAlbums>> = [];
              for (const mk of tryMk) {
                try { albs = await artistAlbums(id, mk); if (albs?.length) break; } catch {}
              }
              const recent = (albs || []).filter(a => isRecent(a.releaseDate));
              if (recent.length) {
                recent.sort((a,b) => Date.parse(normalizeDate(b.releaseDate) ?? '1970-01-01') - Date.parse(normalizeDate(a.releaseDate) ?? '1970-01-01'));
                recents[id] = { latestId: recent[0].id, latestDate: recent[0].releaseDate ?? null };
              }
            } catch {}
          }));
          setFollowedDetails(details);
          setRecentByArtist(recents);
        }
      } catch {}
      finally { setPickedLoading(false); }
    } catch {}
  }, []);

  // Initial load
  useEffect(() => { load(); }, [load]);

  // No genre management in simplified view

  // Refresh upcoming when tab refocuses (e.g., after adding presaves elsewhere)
  useFocusEffect(useCallback(() => {
    load();
  }, []));

  // Also refresh when app returns to foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') load(); });
    return () => sub.remove();
  }, [load]);

  // No extra image fetching; bubbles use details fetched during load()

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // Debounced suggestions when typing
  useEffect(() => {
    const term = q.trim();
    if (debounceTimer) clearTimeout(debounceTimer);
    if (term.length < 2) { setSuggestions([]); setSuggesting(false); return; }

    const t = setTimeout(async () => {
      setSuggesting(true);
      try {
        const list = await artistSearch(term, 'GB', 'loose');
        const top10 = list.slice(0, 10).map(a => ({ id: a.id, name: a.name, imageUrl: a.imageUrl ?? null }));
        setSuggestions(top10);
        // Prefetch images (fire-and-forget)
        top10.forEach(s => { if (s.imageUrl) Image.prefetch(s.imageUrl).catch(() => {}); });
      } finally {
        setSuggesting(false);
      }
    }, 250);

    setDebounceTimer(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const onSearch = async () => {
    const term = q.trim();
    if (!term) { setSearchRows([]); setArtist(null); setArtistAlbumsRows([]); setArtistTracksRows([]); return; }
    setBusy(true);
    try {
      const direct = parseSpotifyUrlOrId(term);
      if (direct) {
        const one = await spotifyLookup(direct.id, direct.lookupType);
        setArtist(null); setArtistAlbumsRows([]); setArtistTracksRows([]); setSearchRows(one);
        return;
      }
      // artist-first
      const artists = await artistSearch(term);
      if (artists.length > 0) {
        const top = artists[0];
        setArtist({ id: top.id, name: top.name });
        const [albs, tops] = await Promise.all([artistAlbums(top.id), artistTopTracks(top.id)]);
        const todayIso = new Date().toISOString().slice(0,10);
        albs.sort((a,b) => {
          const ua = !!(a.releaseDate && a.releaseDate > todayIso);
          const ub = !!(b.releaseDate && b.releaseDate > todayIso);
          if (ua !== ub) return ua ? -1 : 1;
          const ta = a.releaseDate ? Date.parse(a.releaseDate) : 0;
          const tb = b.releaseDate ? Date.parse(b.releaseDate) : 0;
          return tb - ta;
        });
        setArtistAlbumsRows(albs);
        setArtistTracksRows(tops);
      } else {
        setArtist(null); setArtistAlbumsRows([]); setArtistTracksRows([]);
      }

      // also run general search as a fallback/noise
      const r = await spotifySearch(term);
      setSearchRows(r);
    } finally {
      setBusy(false);
    }
  };

  const onAddNew = async (a: { id: string; title: string; artist: string; releaseDate?: string | null; spotifyUrl?: string | null }) => {
    const res = await addToListFromSearch({
      type: 'album',
      title: a.title,
      artist: a.artist,
      releaseDate: a.releaseDate ?? null,
      spotifyUrl: a.spotifyUrl ?? null,
      appleUrl: null,
    });
  if (!res.ok) { H.error(); Alert.alert(res.message || 'Could not save'); return; }
  H.success();
  setAddedIds(prev => ({ ...prev, [a.id]: true }));
  };

  const onSaveSearch = async (r: SpotifyResult) => {
    if (r.type === 'artist') { Alert.alert('Pick a track or album to save'); return; }
    const res = await addToListFromSearch({
      type: r.type === 'album' ? 'album' : 'track',
      title: r.title,
      artist: r.artist ?? null,
      releaseDate: r.releaseDate ?? null,
      spotifyUrl: r.spotifyUrl ?? null,
      appleUrl: null,
    });
  if (!res.ok) { H.error(); Alert.alert(res.message || 'Could not save'); return; }
  H.success();
  setAddedIds(prev => ({ ...prev, [r.id]: true }));
  };

  // Build rows: carousel (Latest) shows first N; list shows remainder labeled 'More new releases'
  const rows: Row[] = [];
  if (newReleases.length) {
    const PREVIEW_COUNT = 14;
    const remainder = newReleases.slice(PREVIEW_COUNT);
  if (remainder.length) {
  rows.push({ kind: 'section-title', title: 'More new releases' });
      for (const a of remainder) {
  rows.push({ kind: 'new', id: a.id, title: a.title, artist: a.artist, releaseDate: a.releaseDate ?? null, spotifyUrl: a.spotifyUrl ?? null, imageUrl: (a as any).imageUrl ?? null, type: (a as any).type });
      }
    }
  }
  // Upcoming removed
  // Artist header with Follow action
  const artistHeader = artist ? (
    <View style={{ marginTop: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#eee', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <Text style={{ fontSize: 18, fontWeight: '800' }}>By {artist.name}</Text>
      <FollowButton artistId={artist.id} artistName={artist.name} />
    </View>
  ) : null;
  if (artist) {
    rows.push({ kind: 'section-title', title: `By ${artist.name} — Albums & Singles` });
    for (const a of artistAlbumsRows) rows.push({ kind: 'new', id: a.id, title: a.title, artist: a.artist, releaseDate: a.releaseDate ?? null, spotifyUrl: a.spotifyUrl ?? null });
    if (artistTracksRows.length) {
      rows.push({ kind: 'section-title', title: `Top tracks by ${artist.name}` });
      for (const t of artistTracksRows) rows.push({ kind: 'search', r: {
        id: t.id, providerId: t.id, provider: 'spotify', type: 'track',
        title: t.title, artist: t.artist, releaseDate: t.releaseDate ?? null, spotifyUrl: t.spotifyUrl ?? null,
      } as any });
    }
  }
  const today = new Date().toISOString().slice(0, 10);
  // Derived, upcoming-first search results with optional filter
  const visibleSearch = useMemo(() => {
    return [...searchRows].sort((a: any, b: any) => {
      const ta = a.releaseDate ? Date.parse(a.releaseDate) : 0;
      const tb = b.releaseDate ? Date.parse(b.releaseDate) : 0;
      return tb - ta;
    }) as SpotifyResult[];
  }, [searchRows, today]);

  if (visibleSearch.length) {
  rows.push({ kind: 'section-title', title: 'Search results' });
    for (const r of visibleSearch) rows.push({ kind: 'search', r });
  }

  

  const renderItem = ({ item }: { item: Row }) => {
    if (item.kind === 'section-title') {
      return (
        <Text style={{ fontSize: 18, fontWeight: '600', marginTop: 16, marginBottom: 8 }}>{item.title}</Text>
      );
    }
    if (item.kind === 'new') {
    const presave = !!(item.releaseDate && item.releaseDate > today);
    const isAdded = !!addedIds[item.id];
      return (
        <Pressable
      onPress={() => onAddNew(item)}
      disabled={isAdded}
      style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eee', opacity: isAdded ? 0.7 : 1 }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Image source={{ uri: item.imageUrl ?? undefined }} style={{ width: 60, height: 60, borderRadius: 6, backgroundColor: '#e5e7eb' }} />
            <View style={{ flex: 1, paddingRight: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontSize: 16, fontWeight: '500', flexShrink: 1 }} numberOfLines={1}>{item.title}</Text>
                {!!item.type && (
                  <Text style={{ fontSize: 10, fontWeight: '800', color: '#3730a3', backgroundColor: '#eef2ff', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                    {item.type.toUpperCase()}
                  </Text>
                )}
              </View>
              <Text style={{ color: '#666', marginTop: 2 }} numberOfLines={1}>{item.artist}</Text>
              {!!item.releaseDate && (
                <Text style={{ color: presave ? '#0a7' : '#666', marginTop: 2 }}>
                  {presave ? `Presave · ${formatDate(item.releaseDate)}` : `Released · ${formatDate(item.releaseDate)}`}
                </Text>
              )}
            </View>
            <Text style={{ color: isAdded ? '#16a34a' : '#0a7', fontWeight: '600' }}>
              {isAdded ? '✓ Added' : 'Save'}
            </Text>
          </View>
        </Pressable>
      );
    }
  // Upcoming removed
    // search result
    const r = item.r;
    const presave = !!(r.releaseDate && r.releaseDate > today);
    const typeLabel = r.type === 'album' ? 'Album' : r.type === 'track' ? 'Track' : 'Artist';
    return (
      <Pressable
        onPress={() => onSaveSearch(r)}
        disabled={r.type === 'artist' || !!addedIds[r.id]}
        style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eee', opacity: r.type === 'artist' ? 0.6 : 1 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {r.imageUrl ? (
            <Image source={{ uri: r.imageUrl }} style={{ width: 60, height: 60, borderRadius: 6, backgroundColor: '#e5e7eb' }} />
          ) : (
            <View style={{ width: 60, height: 60, borderRadius: 6, backgroundColor: '#e5e7eb' }} />
          )}
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={{ fontSize: 16, fontWeight: '500' }} numberOfLines={1}>{r.title}</Text>
            <Text style={{ color: '#666', marginTop: 2 }} numberOfLines={1}>{r.artist ?? typeLabel}</Text>
            {!!r.releaseDate && (
              <Text style={{ color: presave ? '#0a7' : '#666', marginTop: 2 }}>
                {presave ? `Presave · ${formatDate(r.releaseDate)}` : `Released · ${formatDate(r.releaseDate)}`}
              </Text>
            )}
          </View>
          {r.type !== 'artist' && (
            <Text style={{ color: addedIds[r.id] ? '#16a34a' : '#0a7', fontWeight: '600' }}>
              {addedIds[r.id] ? '✓ Added' : 'Save'}
            </Text>
          )}
        </View>
      </Pressable>
    );
  };

  const keyExtractor = (item: Row, index: number) => {
    switch (item.kind) {
      case 'section-title': return `section-${item.title}-${index}`;
      case 'new': return `new-${item.id}-${index}`;
  // upcoming removed
      case 'search': return `srch-${item.r.id}-${index}`;
    }
  };

  const ReleasesHeader = (
    <View style={{ marginTop: 8 }}>
      {/* Picked for you lane */}
      {(() => {
        if (pickedLoading) {
          const skeletons = Array.from({ length: 6 }).map((_, i) => ({ key: `sk-${i}` }));
          return (
            <View style={{ marginBottom: 16 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Text style={{ fontSize: 18, fontWeight: '800' }}>New releases picked for you</Text>
              </View>
              <FlatList
                data={skeletons}
                keyExtractor={(it) => it.key}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 16, paddingRight: 12 }}
                renderItem={() => (
                  <View style={{ width: 100, alignItems: 'center' }}>
                    <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: '#e5e7eb' }} />
                    <View style={{ width: 70, height: 12, backgroundColor: '#f3f4f6', borderRadius: 6, marginTop: 6 }} />
                  </View>
                )}
              />
            </View>
          );
        }
        // Build clean lane from followedDetails + recentByArtist
        const items = Object.keys(recentByArtist || {}).map((id) => {
          const det = followedDetails[id] || { name: 'Unknown', imageUrl: null };
          const rec = recentByArtist[id] || {} as { latestId?: string; latestDate?: string | null };
          return { id, name: det.name, imageUrl: det.imageUrl ?? null, latestId: rec.latestId, latestDate: rec.latestDate ?? null };
        })
        .filter(it => it.latestId && /^[A-Za-z0-9]{22}$/.test(it.id));

        items.sort((a,b) => {
          const ta = a.latestDate ? Date.parse(a.latestDate) : 0;
          const tb = b.latestDate ? Date.parse(b.latestDate) : 0;
          return tb - ta;
        });

        if (items.length === 0) {
          // No recent releases from followed artists – show informative header
          return (
            <View style={{ marginBottom: 16 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <Text style={{ fontSize: 18, fontWeight: '800' }}>New releases picked for you</Text>
              </View>
              <Text style={{ color: '#6b7280', fontSize: 12 }}>No new releases from artists you follow in the last few weeks.</Text>
            </View>
          );
        }

        return (
          <View style={{ marginBottom: 16 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Text style={{ fontSize: 18, fontWeight: '800' }}>New releases picked for you</Text>
            </View>
            <FlatList
              data={items.slice(0, 16)}
              keyExtractor={(it) => `pfy-${it.id}`}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 16, paddingRight: 12 }}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => {
                    const path = `/artist/${encodeURIComponent(item.id)}/mini?name=${encodeURIComponent(item.name)}${item.latestId ? `&highlight=${encodeURIComponent(item.latestId)}` : ''}`;
                    router.navigate(path as any);
                  }}
                  style={{ width: 100, alignItems: 'center' }}
                >
                  <View style={{ width: 80, height: 80 }}>
                    {item.imageUrl ? (
                      <Image source={{ uri: item.imageUrl }} style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: '#e5e7eb' }} />
                    ) : (
                      <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: '#e5e7eb', alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ fontWeight: '800', color: '#6b7280', fontSize: 20 }}>
                          {(item.name || '?').slice(0,1).toUpperCase()}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={{ fontWeight: '600', marginTop: 6, fontSize: 12 }} numberOfLines={1}>{item.name}</Text>
                </Pressable>
              )}
            />
          </View>
        );
      })()}
      {(() => {
        if (newReleases.length) {
          // Keep server/client computed order (popularity-first with recency lift)
      // Build preview (popularity-first) but ensure some diversity of types (albums/EPs) if available
      const PREVIEW_COUNT = 14;
      let preview = newReleases.slice(0, PREVIEW_COUNT);
      const haveNonSingle = preview.filter(p => p.type && p.type !== 'single');
      if (haveNonSingle.length < 3) {
        const remainder = newReleases.slice(PREVIEW_COUNT).filter(p => p.type && p.type !== 'single');
        // Replace tail singles with albums/EPs to reach diversity target
        let needed = Math.min(3 - haveNonSingle.length, remainder.length);
        if (needed > 0) {
          const replacements = remainder.slice(0, needed);
          // Work from end of preview replacing singles
          const out = [...preview];
          let ri = 0;
          for (let i = out.length - 1; i >= 0 && ri < replacements.length; i--) {
            if (out[i].type === 'single') {
              out[i] = replacements[ri++];
            }
          }
          preview = out;
        }
      }
          return (
            <View style={{ marginBottom: 16 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'flex-start', alignItems: 'center', marginBottom: 8 }}>
    <Text style={{ fontSize: 18, fontWeight: '800' }}>Latest</Text>
      </View>
              <FlatList
                data={preview}
                keyExtractor={(a) => `nr-${a.id}`}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 12, paddingRight: 8 }}
                renderItem={({ item }) => (
                  <View style={{ width: 140 }}>
                    <Image source={{ uri: item.imageUrl ?? undefined }} style={{ width: 140, height: 140, borderRadius: 8, backgroundColor: '#e5e7eb' }} />
                    <Text style={{ fontWeight: '700', marginTop: 6 }} numberOfLines={1}>{item.title}</Text>
                    <Text style={{ color: '#666' }} numberOfLines={1}>{item.artist}</Text>
                    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                      {!!item.type && (
                        <Text style={{ color: '#3730a3', fontSize: 10, fontWeight: '800' }}>{String(item.type).toUpperCase()}</Text>
                      )}
                      {!!item.releaseDate && <Text style={{ color: '#6b7280' }}>{formatDate(item.releaseDate)}</Text>}
                    </View>
                    <Pressable
                      onPress={() => onAddNew({ id: item.id, title: item.title, artist: item.artist, releaseDate: item.releaseDate ?? null, spotifyUrl: item.spotifyUrl ?? null })}
                      disabled={!!addedIds[item.id]}
                      style={{ marginTop: 6, opacity: addedIds[item.id] ? 0.6 : 1 }}
                    >
                      <Text style={{ fontWeight: '700', color: addedIds[item.id] ? '#16a34a' : undefined }}>
                        {addedIds[item.id] ? '✓ Added' : 'Save'}
                      </Text>
                    </Pressable>
                  </View>
                )}
              />
            </View>
          );
        }
        if (!newReleases.length && fallbackFeed.length) {
          const preview = fallbackFeed.slice(0, 14);
          return (
            <View style={{ marginBottom: 16 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Text style={{ fontSize: 18, fontWeight: '800' }}>From artists you follow</Text>
              </View>
              <FlatList
                data={preview}
                keyExtractor={(a) => `fd-${a.id}`}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 12, paddingRight: 8 }}
                renderItem={({ item }) => (
                  <View style={{ width: 140 }}>
                    <Image source={{ uri: item.image_url ?? undefined }} style={{ width: 140, height: 140, borderRadius: 8, backgroundColor: '#e5e7eb' }} />
                    <Text style={{ fontWeight: '700', marginTop: 6 }} numberOfLines={1}>{item.title}</Text>
                    {!!item.artist_name && <Text style={{ color: '#666' }} numberOfLines={1}>{item.artist_name}</Text>}
                    {!!item.release_date && <Text style={{ color: '#6b7280' }}>{formatDate(item.release_date)}</Text>}
                    <Pressable
                      onPress={() => onAddNew({ id: item.id, title: item.title, artist: item.artist_name || '', releaseDate: item.release_date, spotifyUrl: item.spotify_url ?? null })}
                      disabled={!!addedIds[item.id]}
                      style={{ marginTop: 6, opacity: addedIds[item.id] ? 0.6 : 1 }}
                    >
                      <Text style={{ fontWeight: '700', color: addedIds[item.id] ? '#16a34a' : undefined }}>
                        {addedIds[item.id] ? '✓ Added' : 'Save'}
                      </Text>
                    </Pressable>
                  </View>
                )}
              />
            </View>
          );
        }
        return null;
      })()}
    </View>
  );

  return (
    <Screen>
      <View style={{ marginTop: 8, marginBottom: 8, flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search music: artists, albums, tracks"
          onSubmitEditing={onSearch}
          style={{ flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 }}
        />
      </View>
  {/* Suggestions panel */}
      {(suggestions.length > 0 || suggesting) && (
        <View style={{
          marginTop: 6, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10,
          backgroundColor: 'white', overflow: 'hidden'
        }}>
          <View style={{ paddingVertical: 8, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' }}>
            <Text style={{ fontWeight: '700' }}>
              {suggesting ? 'Searching artists…' : 'Artists'}
            </Text>
          </View>
          {suggestions.map(a => (
            <View
              key={a.id}
              style={{
                paddingVertical: 10,
                paddingHorizontal: 12,
                borderBottomWidth: 1,
                borderBottomColor: '#f3f4f6',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              {/* Left: avatar + name (tap to select artist) */}
              <Pressable
                onPress={async () => {
                  setArtist({ id: a.id, name: a.name });
                  setSearchRows([]);
                  setSuggestions([]);
                  setQ(a.name);
                  setBusy(true);
                  try {
                    const [albs, tops] = await Promise.all([artistAlbums(a.id), artistTopTracks(a.id)]);
                    const today = new Date().toISOString().slice(0,10);
                    albs.sort((x,y) => {
                      const ux = !!(x.releaseDate && x.releaseDate > today);
                      const uy = !!(y.releaseDate && y.releaseDate > today);
                      if (ux !== uy) return ux ? -1 : 1;
                      const tx = x.releaseDate ? Date.parse(x.releaseDate) : 0;
                      const ty = y.releaseDate ? Date.parse(y.releaseDate) : 0;
                      return ty - tx;
                    });
                    setArtistAlbumsRows(albs);
                    setArtistTracksRows(tops);
                  } finally {
                    setBusy(false);
                  }
                }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, paddingRight: 12 }}
              >
                {/* Avatar */}
                {a.imageUrl ? (
                  <Image
                    source={{ uri: a.imageUrl }}
                    style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#e5e7eb' }}
                  />
                ) : (
                  <View
                    style={{
                      width: 40, height: 40, borderRadius: 20,
                      backgroundColor: '#e5e7eb', alignItems: 'center', justifyContent: 'center'
                    }}
                  >
                    <Text style={{ fontWeight: '800', color: '#6b7280' }}>
                      {a.name.slice(0,1).toUpperCase()}
                    </Text>
                  </View>
                )}

                <Text style={{ fontWeight: '600' }} numberOfLines={1}>
                  {a.name}
                </Text>
              </Pressable>

              {/* Right: Follow button */}
              <FollowButton artistId={a.id} artistName={a.name} />
            </View>
          ))}
        </View>
      )}
  {/* Tip removed */}
      {busy && (
        <View style={{ paddingVertical: 8 }}>
          <ActivityIndicator />
        </View>
      )}
  {artistHeader}
      <FlatList
        data={rows}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={ReleasesHeader}
        ListEmptyComponent={<Text style={{ marginTop: 16, color: '#6b7280' }}>No results yet. Try Refresh or search for an artist/album.</Text>}
        refreshing={refreshing}
        onRefresh={onRefresh}
        keyboardShouldPersistTaps="handled"
      />
    </Screen>
  );
}
