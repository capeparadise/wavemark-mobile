import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, AppState, FlatList, Image, Pressable, Text, TextInput, View } from 'react-native';
import FollowButton from '../../components/FollowButton';
import { H } from '../../components/haptics';
import Screen from '../../components/Screen';
import { formatDate } from '../../lib/date';
import { fetchFeed, type FeedItem } from '../../lib/follow';
import { addToListFromSearch } from '../../lib/listen';
import { getNewReleases } from '../../lib/recommend';
import { getMarket, parseSpotifyUrlOrId, spotifyLookup, spotifySearch, type SpotifyResult } from '../../lib/spotify';
import { artistAlbums, artistSearch, artistTopTracks } from '../../lib/spotifyArtist';

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

  // Loader
  const load = useCallback(async () => {
    const DAYS = 28;
    try {
      const [nr] = await Promise.all([
        getNewReleases(DAYS),
      ]);
      setNewReleases(nr);
      // Fallback: if new releases empty (e.g., rate limit), show followed feed
      if ((!nr || nr.length === 0)) {
        try { setFallbackFeed((await fetchFeed()).slice(0, 20)); } catch {}
      } else {
        setFallbackFeed([]);
      }
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
  // Always navigate to Listen (upcoming removed)
  router.navigate('/(tabs)/listen');
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
  router.navigate('/(tabs)/listen');
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
      return (
        <Pressable
          onPress={() => onAddNew(item)}
          style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eee' }}
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
            <Text style={{ color: '#0a7', fontWeight: '600' }}>Save</Text>
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
        disabled={r.type === 'artist'}
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
          {r.type !== 'artist' && <Text style={{ color: '#0a7', fontWeight: '600' }}>Save</Text>}
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
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Text style={{ fontSize: 18, fontWeight: '800' }}>Latest</Text>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <Pressable onPress={() => router.push('/new-releases-all')}>
                    <Text style={{ color: '#2563eb', fontWeight: '700' }}>See all</Text>
                  </Pressable>
                </View>
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
                      onPress={async () => {
                        const res = await addToListFromSearch({
                          type: 'album',
                          title: item.title,
                          artist: item.artist,
                          releaseDate: item.releaseDate ?? null,
                          spotifyUrl: item.spotifyUrl ?? null,
                          appleUrl: null,
                        });
                        if (res.ok) { H.success(); } else { H.error(); Alert.alert(res.message || 'Could not save'); }
                      }}
                      style={{ marginTop: 6 }}
                    >
                      <Text style={{ fontWeight: '700' }}>Add to Listen</Text>
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
                      onPress={async () => {
                        const res = await addToListFromSearch({
                          type: 'album',
                          title: item.title,
                          artist: item.artist_name || '',
                          releaseDate: item.release_date,
                          spotifyUrl: item.spotify_url,
                          appleUrl: null,
                        });
                        if (res.ok) { H.success(); } else { H.error(); Alert.alert(res.message || 'Could not save'); }
                      }}
                      style={{ marginTop: 6 }}
                    >
                      <Text style={{ fontWeight: '700' }}>Add to Listen</Text>
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
      <Text style={{ color: '#9ca3af', fontSize: 11, marginTop: 4 }}>
        {(() => {
          const base = (process.env.EXPO_PUBLIC_FN_BASE || 'https://jvojjtjklqtmdtmeqqyy.functions.supabase.co');
          const on = base.includes('functions.supabase.co');
          const n = newReleases.length;
          return `fn:${on ? 'on' : 'off'}  market:${getMarket()}  new:${n}`;
        })()}
      </Text>
  <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 6, alignItems: 'center' }}>
        <Pressable onPress={onRefresh} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#e5e7eb' }}>
          <Text style={{ fontWeight: '700', color: '#111827' }}>Refresh</Text>
        </Pressable>
      </View>
      {/* Quick link to full new releases list */}
      <View style={{ flexDirection: 'row', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
        <Pressable onPress={() => router.push('/new-releases-all')}>
          <Text style={{ color: '#2563eb', fontWeight: '700' }}>See all</Text>
        </Pressable>
      </View>
      <View style={{ marginTop: 8, marginBottom: 8, flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search music: artists, albums, tracks"
          onSubmitEditing={onSearch}
          style={{ flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 }}
        />
        <Pressable onPress={onSearch} disabled={busy} style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
          <Text style={{ color: 'white', fontWeight: '700' }}>Search</Text>
        </Pressable>
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
  {/* Filter chips removed (upcoming feature deprecated) */}
      <Text style={{ color: '#6b7280', marginBottom: 8 }}>
        Tip: paste a Spotify album/track URL for unreleased items that don’t appear in text search.
      </Text>
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
