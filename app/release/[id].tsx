import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import GlassCard from '../../components/GlassCard';
import Screen from '../../components/StackScreen';
import { formatDate } from '../../lib/date';
import { addToListFromSearch, getDefaultPlayer, openByDefaultPlayer, type ListenPlayer, type ListenRow } from '../../lib/listen';
import { getMoreLikeThisForRelease, type SimpleAlbum } from '../../lib/recommend';
import { parseSpotifyUrlOrId, spotifyLookup } from '../../lib/spotify';
import { buildAlbumUrl, buildTrackUrl, fetchCollectionById, fetchTrackById } from '../../lib/apple';
import { supabase } from '../../lib/supabase';
import { openArtist } from '../../lib/openArtist';
import { useTheme } from '../../theme/useTheme';
import { goToRelease } from '../../lib/navigation';

export const options = { title: 'Release' };

type ReleaseDetails = {
  id: string;
  provider: 'spotify' | 'apple' | 'unknown';
  providerId?: string | null;
  title: string;
  artistName?: string | null;
  artistId?: string | null;
  releaseDate?: string | null;
  releaseType?: 'album' | 'single' | 'ep' | 'track' | 'compilation' | null;
  artworkUrl?: string | null;
  spotifyUrl?: string | null;
  spotifyId?: string | null;
  appleUrl?: string | null;
  appleId?: string | null;
  itemType?: 'album' | 'track';
};

const isUuid = (s?: string | null) => !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab]{1}[0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);

const extractAppleId = (value: string): number | null => {
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value);
  try {
    const u = new URL(value);
    const qId = u.searchParams.get('i');
    if (qId && /^\d+$/.test(qId)) return Number(qId);
    const album = u.pathname.match(/\/album\/[^/]+\/(\d+)/);
    if (album?.[1]) return Number(album[1]);
    const song = u.pathname.match(/\/song\/[^/]+\/(\d+)/);
    if (song?.[1]) return Number(song[1]);
  } catch {}
  return null;
};

export default function ReleaseScreen() {
  const { colors } = useTheme();
  const params = useLocalSearchParams<{
    id?: string;
    spotifyId?: string;
    spotifyUrl?: string;
    title?: string;
    artistName?: string;
    imageUrl?: string;
    type?: string;
    artistId?: string;
    releaseDate?: string;
  }>();
  const getParam = (v: string | string[] | undefined) => Array.isArray(v) ? v[0] : v;
  const releaseId = String(getParam(params.id) || '').trim();
  const spotifyIdParam = String(getParam(params.spotifyId) || '').trim();
  const artistIdParam = String(getParam(params.artistId) || '').trim();
  const spotifyUrlParam = String(getParam(params.spotifyUrl) || '').trim();
  const titleParam = String(getParam(params.title) || '').trim();
  const artistNameParam = String(getParam(params.artistName) || '').trim();
  const imageUrlParam = String(getParam(params.imageUrl) || '').trim();
  const typeParam = String(getParam(params.type) || '').trim();
  const releaseDateParam = String(getParam(params.releaseDate) || '').trim();
  const paramKey = [
    releaseId,
    spotifyIdParam,
    spotifyUrlParam,
    titleParam,
    artistNameParam,
    imageUrlParam,
    typeParam,
    artistIdParam,
    releaseDateParam,
  ].join('|');
  const lastParamKeyRef = React.useRef<string>('');
  const paramDetail = useMemo<ReleaseDetails | null>(() => {
    const spotifyUrl = spotifyUrlParam || null;
    const spotifyId = spotifyIdParam || null;
    const title = titleParam || null;
    const artistName = artistNameParam || null;
    const imageUrl = imageUrlParam || null;
    const type = (typeParam || '').toLowerCase();
    const artistId = artistIdParam || null;
    const releaseDate = releaseDateParam || null;
    if (!spotifyUrl && !spotifyId && !title && !artistName && !imageUrl) return null;
    const isTrack = type === 'track';
    const releaseType = isTrack ? 'single' : (type ? (type as any) : null);
    return {
      id: releaseId || String(spotifyId || ''),
      provider: 'spotify',
      providerId: spotifyId || releaseId || null,
      title: title || 'Release',
      artistName,
      artistId,
      releaseDate,
      releaseType,
      artworkUrl: imageUrl,
      spotifyUrl,
      spotifyId: spotifyId || null,
      appleUrl: null,
      appleId: null,
      itemType: isTrack ? 'track' : 'album',
    };
  }, [
    releaseId,
    spotifyIdParam,
    spotifyUrlParam,
    titleParam,
    artistNameParam,
    imageUrlParam,
    typeParam,
    artistIdParam,
    releaseDateParam,
  ]);

  const [release, setRelease] = useState<ReleaseDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [preferredPlayer, setPreferredPlayer] = useState<ListenPlayer>('spotify');
  const [moreLike, setMoreLike] = useState<SimpleAlbum[]>([]);
  const [moreLikeLabel, setMoreLikeLabel] = useState<'More like this' | 'New releases' | 'Similar releases'>('Similar releases');
  const [moreLikeLoading, setMoreLikeLoading] = useState(false);
  const skeletonTiles = useMemo(() => Array.from({ length: 6 }, (_, i) => i), []);
  const lastMoreKeyRef = React.useRef<string>('');

  const releaseKey = String(release?.spotifyId || release?.providerId || spotifyIdParam || releaseId || '').trim();
  const artistKey = String(release?.artistId || artistIdParam || '').trim();
  const moreKey = releaseKey ? `${releaseKey}:${artistKey}` : '';

  const sameIds = useCallback((a: SimpleAlbum[], b: SimpleAlbum[]) => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      const ak = String(a[i]?.id || a[i]?.spotifyUrl || a[i]?.title || '');
      const bk = String(b[i]?.id || b[i]?.spotifyUrl || b[i]?.title || '');
      if (ak !== bk) return false;
    }
    return true;
  }, []);

  useEffect(() => {
    getDefaultPlayer().then(setPreferredPlayer).catch(() => {});
  }, []);

  useEffect(() => {
    const urls = moreLike.map((it) => it.imageUrl).filter(Boolean) as string[];
    urls.slice(0, 6).forEach((url) => {
      Image.prefetch(url).catch(() => {});
    });
  }, [moreLike]);

  useEffect(() => {
    if (!paramDetail) return;
    if (lastParamKeyRef.current === paramKey) return;
    lastParamKeyRef.current = paramKey;
    setRelease(paramDetail);
    setLoading(false);
  }, [paramDetail, paramKey]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!paramDetail) setLoading(true);
      setError(null);
      setAdded(false);
      if (!releaseId) {
        setError('Missing release id');
        if (!paramDetail) setLoading(false);
        return;
      }

      let detail: ReleaseDetails | null = paramDetail ? { ...paramDetail } : null;

      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user ?? null;

      const mapListenRow = (row: any): ReleaseDetails => {
        const provider: 'spotify' | 'apple' = row.provider === 'apple' || (!!row.apple_url && !row.spotify_url) ? 'apple' : 'spotify';
        const itemType = row.item_type === 'album' ? 'album' : 'track';
        return {
          id: String(row.id || releaseId),
          provider,
          providerId: row.provider_id ?? row.spotify_id ?? row.apple_id ?? releaseId,
          title: row.title || 'Untitled',
          artistName: row.artist_name ?? null,
          artistId: row.artist_id ?? null,
          releaseDate: row.release_date ?? null,
          releaseType: row.item_type === 'album' ? 'album' : 'single',
          artworkUrl: row.artwork_url ?? null,
          spotifyUrl: row.spotify_url ?? null,
          spotifyId: row.spotify_id ?? null,
          appleUrl: row.apple_url ?? null,
          appleId: row.apple_id ?? null,
          itemType,
        };
      };

      try {
        if (user) {
          if (isUuid(releaseId)) {
            const { data, error: rowErr } = await supabase
              .from('listen_list')
              .select('*')
              .eq('user_id', user.id)
              .eq('id', releaseId)
              .maybeSingle();
            if (!rowErr && data) {
              detail = mapListenRow(data);
              if (active) setAdded(true);
            }
          }

          if (!detail) {
            const { data, error: rowErr } = await supabase
              .from('listen_list')
              .select('*')
              .eq('user_id', user.id)
              .or(`provider_id.eq.${releaseId},spotify_id.eq.${releaseId},apple_id.eq.${releaseId}`)
              .maybeSingle();
            if (!rowErr && data) {
              detail = mapListenRow(data);
              if (active) setAdded(true);
            }
          }
        }
      } catch {}

      if (!detail) {
        const parsed = parseSpotifyUrlOrId(paramDetail?.spotifyUrl || paramDetail?.spotifyId || releaseId);
        if (parsed) {
          try {
            let results = await spotifyLookup(parsed.id, parsed.lookupType);
            if (!results?.length && parsed.lookupType === 'album') {
              results = await spotifyLookup(parsed.id, 'track');
            }
            const r = results?.[0];
            if (r) {
              detail = {
                id: releaseId,
                provider: 'spotify',
                providerId: r.id,
                title: r.title || 'Untitled',
                artistName: r.artist ?? null,
                artistId: r.artistId ?? null,
                releaseDate: r.releaseDate ?? null,
                releaseType: r.albumType ?? (r.type === 'track' ? 'single' : 'album'),
                artworkUrl: r.imageUrl ?? null,
                spotifyUrl: r.spotifyUrl ?? null,
                spotifyId: r.id,
                appleUrl: null,
                appleId: null,
                itemType: r.type === 'track' ? 'track' : 'album',
              };
            }
          } catch {}
        }
      }

      if (!detail) {
        const appleId = extractAppleId(releaseId);
        if (appleId) {
          try {
            const album = await fetchCollectionById(appleId);
            if (album) {
              detail = {
                id: releaseId,
                provider: 'apple',
                providerId: String(album.collectionId),
                title: album.collectionName || 'Untitled',
                artistName: album.artistName ?? null,
                artistId: String(album.artistId),
                releaseDate: album.releaseDate ?? null,
                releaseType: 'album',
                artworkUrl: album.artworkUrl ?? null,
                spotifyUrl: null,
                spotifyId: null,
                appleUrl: buildAlbumUrl(album.collectionId, album.collectionName),
                appleId: String(album.collectionId),
                itemType: 'album',
              };
            }
            if (!detail) {
              const track = await fetchTrackById(appleId);
              if (track) {
                detail = {
                  id: releaseId,
                  provider: 'apple',
                  providerId: String(track.trackId),
                  title: track.trackName || 'Untitled',
                  artistName: track.artistName ?? null,
                  artistId: String(track.artistId),
                  releaseDate: track.releaseDate ?? null,
                  releaseType: 'single',
                  artworkUrl: track.artworkUrl ?? null,
                  spotifyUrl: null,
                  spotifyId: null,
                  appleUrl: buildTrackUrl(track.trackId, track.trackName),
                  appleId: String(track.trackId),
                  itemType: 'track',
                };
              }
            }
          } catch {}
        }
      }

      if (!detail && paramDetail) {
        detail = paramDetail;
      }

      if (!detail) {
        detail = {
          id: releaseId,
          provider: 'unknown',
          title: 'Release',
          artistName: null,
          releaseDate: null,
          releaseType: null,
          artworkUrl: null,
          spotifyUrl: null,
          spotifyId: null,
          appleUrl: null,
          appleId: null,
          itemType: 'album',
        };
      }

      if (!active) return;
      setRelease(detail);
      if (!paramDetail) setLoading(false);
    };

    load();

    return () => {
      active = false;
    };
  }, [releaseId]);

  const loadMore = useCallback(async () => {
    if (!releaseKey) return;
    setMoreLikeLoading(true);
    setMoreLikeLabel('Similar releases');
    const cacheKey = `more_like_this:${releaseKey}`;
    try {
      const cachedRaw = await AsyncStorage.getItem(cacheKey);
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw);
        if (cached && Array.isArray(cached.items)) {
          const nextItems = cached.items as SimpleAlbum[];
          setMoreLike((prev) => (sameIds(prev, nextItems) ? prev : nextItems));
          const nextLabel =
            cached.label === 'New releases'
              ? 'New releases'
              : cached.label === 'Similar releases'
                ? 'Similar releases'
                : 'More like this';
          setMoreLikeLabel((prev) => (prev === nextLabel ? prev : nextLabel));
        }
      }
    } catch {}

    try {
      const res = await getMoreLikeThisForRelease({
        artistId: artistKey || null,
        releaseId: releaseId || releaseKey,
        days: 180,
        strict: false,
        mode: 'release_similar_strict',
      });
      const nextItems = res.items || [];
      setMoreLike((prev) => (sameIds(prev, nextItems) ? prev : nextItems));
      setMoreLikeLabel((prev) => (prev === res.label ? prev : res.label));
      try {
        await AsyncStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), label: res.label, items: res.items }));
      } catch {}
    } catch {
      setMoreLike((prev) => (prev.length ? prev : []));
    } finally {
      setMoreLikeLoading(false);
    }
  }, [artistKey, releaseId, releaseKey, sameIds]);

  useEffect(() => {
    if (!moreKey) return;
    if (lastMoreKeyRef.current === moreKey) return;
    lastMoreKeyRef.current = moreKey;
    loadMore();
  }, [moreKey, loadMore]);

  const metaLine = useMemo(() => {
    if (!release) return null;
    const type = release.releaseType === 'track' ? 'single' : release.releaseType;
    const typeLabel = type ? String(type).toUpperCase() : null;
    const year = release.releaseDate ? String(release.releaseDate).slice(0, 4) : null;
    const parts = [typeLabel, year].filter(Boolean);
    return parts.length ? parts.join(' · ') : null;
  }, [release]);

  const onAdd = useCallback(async () => {
    if (!release || adding || added) return;
    setAdding(true);
    try {
      const type = release.itemType === 'album' ? 'album' : 'single';
      const res = await addToListFromSearch({
        type,
        title: release.title,
        artist: release.artistName ?? null,
        releaseDate: release.releaseDate ?? null,
        spotifyUrl: release.spotifyUrl ?? null,
        appleUrl: release.appleUrl ?? null,
        imageUrl: release.artworkUrl ?? null,
        providerId: release.providerId ?? null,
      });
      if (res.ok) {
        setAdded(true);
      } else {
        Alert.alert('Could not add', res.message || 'Please try again.');
      }
    } finally {
      setAdding(false);
    }
  }, [adding, added, release]);

  const onOpenExternal = useCallback(async () => {
    if (!release) return;
    if (preferredPlayer === 'spotify' && release.spotifyUrl) {
      try {
        await Linking.openURL(release.spotifyUrl);
        return;
      } catch {}
    }
    if (preferredPlayer === 'apple' && release.appleUrl) {
      try {
        await Linking.openURL(release.appleUrl);
        return;
      } catch {}
    }
    const row: ListenRow = {
      id: release.id,
      item_type: release.itemType === 'album' ? 'album' : 'track',
      provider: release.provider === 'apple' ? 'apple' : 'spotify',
      provider_id: release.providerId ?? null,
      title: release.title,
      artist_name: release.artistName ?? null,
      artwork_url: release.artworkUrl ?? null,
      release_date: release.releaseDate ?? null,
      apple_url: release.appleUrl ?? null,
      apple_id: release.appleId ?? null,
      spotify_url: release.spotifyUrl ?? null,
      spotify_id: release.spotifyId ?? null,
      done_at: null,
    };
    const ok = await openByDefaultPlayer(row);
    if (!ok) {
      Alert.alert('Could not open', 'Try switching your default player in Settings.');
    }
  }, [release, preferredPlayer]);

  const onOpenArtist = useCallback(async () => {
    if (!release) return;
    const artistId = String(release.artistId || '').trim();
    if (artistId) {
      if (/^[A-Za-z0-9]{22}$/.test(artistId)) {
        openArtist(artistId, { name: release.artistName ?? null });
        return;
      }
      if (/^\d+$/.test(artistId)) {
        router.push({
          pathname: '/artist/[id]',
          params: { id: artistId, name: release.artistName ?? undefined },
        });
        return;
      }
    }

    if (release.provider === 'spotify') {
      const candidate = release.spotifyId || release.providerId || '';
      if (/^[A-Za-z0-9]{22}$/.test(candidate)) {
        try {
          let results = await spotifyLookup(candidate, 'album');
          if (!results?.length) results = await spotifyLookup(candidate, 'track');
          const resolved = results?.[0]?.artistId ?? null;
          if (resolved) {
            openArtist(resolved, { name: release.artistName ?? null });
            return;
          }
        } catch {}
      }
    }

    if (release.provider === 'apple') {
      const candidate = release.appleId || release.providerId || '';
      const appleId = extractAppleId(String(candidate));
      if (appleId) {
        try {
          const album = await fetchCollectionById(appleId);
          if (album?.artistId) {
            router.push({
              pathname: '/artist/[id]',
              params: { id: String(album.artistId), name: release.artistName ?? undefined },
            });
            return;
          }
          const track = await fetchTrackById(appleId);
          if (track?.artistId) {
            router.push({
              pathname: '/artist/[id]',
              params: { id: String(track.artistId), name: release.artistName ?? undefined },
            });
            return;
          }
        } catch {}
      }
    }

    Alert.alert('Artist unavailable', 'Could not resolve an artist profile for this release.');
  }, [release]);

  const openLabel = preferredPlayer === 'apple' ? 'Open in Apple Music' : 'Open in Spotify';

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
          <Pressable onPress={() => router.back()} hitSlop={8} style={{ paddingVertical: 6, paddingHorizontal: 8, marginLeft: -6 }}>
            <Text style={{ color: colors.text.secondary, fontWeight: '800', fontSize: 16 }}>{'<'}</Text>
          </Pressable>
          <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text.secondary, marginLeft: 8 }}>Release</Text>
        </View>

        {loading && !release ? (
          <View style={{ paddingVertical: 24, alignItems: 'center' }}>
            <ActivityIndicator />
          </View>
        ) : (
          <>
            {error ? (
              <Text style={{ color: colors.text.muted }}>{error}</Text>
            ) : null}

            <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
              <View style={{ width: 120, height: 120, borderRadius: 16, overflow: 'hidden', backgroundColor: colors.bg.muted }}>
                {release?.artworkUrl ? (
                  <Image source={{ uri: release.artworkUrl }} style={{ width: 120, height: 120 }} />
                ) : (
                  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: colors.text.muted, fontWeight: '900', fontSize: 24 }}>{(release?.title || 'R').slice(0, 1)}</Text>
                  </View>
                )}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 20, fontWeight: '900', color: colors.text.secondary }} numberOfLines={2}>
                  {release?.title || 'Release'}
                </Text>
                {release?.artistName ? (
                  <Pressable onPress={onOpenArtist} disabled={!release?.artistName} hitSlop={6}>
                    <Text style={{ color: colors.accent.primary, fontWeight: '700', marginTop: 6 }} numberOfLines={1}>
                      {release.artistName}
                    </Text>
                  </Pressable>
                ) : null}
                {metaLine ? (
                  <Text style={{ color: colors.text.muted, marginTop: 6, fontWeight: '700', fontSize: 12 }}>
                    {metaLine}
                  </Text>
                ) : null}
                {!!release?.releaseDate ? (
                  <Text style={{ color: colors.text.muted, marginTop: 4, fontSize: 12 }}>
                    {formatDate(release.releaseDate)}
                  </Text>
                ) : null}
              </View>
            </View>

            <Pressable
              onPress={onAdd}
              disabled={adding || added}
              style={({ pressed }) => ({
                marginTop: 18,
                paddingVertical: 14,
                borderRadius: 14,
                backgroundColor: added ? colors.bg.muted : colors.accent.primary,
                borderWidth: 1,
                borderColor: added ? colors.border.subtle : colors.accent.primary,
                opacity: pressed ? 0.9 : 1,
              })}
            >
              <Text style={{ textAlign: 'center', fontWeight: '800', color: added ? colors.text.secondary : colors.text.inverted }}>
                {added ? 'Added to Listen list' : adding ? 'Adding...' : 'Add to Listen list'}
              </Text>
            </Pressable>

            <Pressable
              onPress={onOpenExternal}
              style={({ pressed }) => ({
                marginTop: 10,
                paddingVertical: 12,
                borderRadius: 12,
                backgroundColor: colors.bg.secondary,
                borderWidth: 1,
                borderColor: colors.border.subtle,
                opacity: pressed ? 0.92 : 1,
              })}
            >
              <Text style={{ textAlign: 'center', fontWeight: '700', color: colors.text.secondary }}>{openLabel}</Text>
            </Pressable>

            <View style={{ marginTop: 24 }}>
              <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text.secondary, marginBottom: 10 }}>
                {moreLikeLabel}
              </Text>
              {moreLikeLoading && moreLike.length === 0 ? (
                <FlatList
                  data={skeletonTiles}
                  keyExtractor={(item) => `skeleton-${item}`}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  ItemSeparatorComponent={() => <View style={{ width: 12 }} />}
                  renderItem={() => (
                    <View style={{ width: 140, padding: 10 }}>
                      <View style={{ width: 120, height: 120, borderRadius: 12, backgroundColor: colors.bg.muted }} />
                      <View style={{ height: 12, backgroundColor: colors.bg.muted, borderRadius: 6, marginTop: 10, width: 100 }} />
                      <View style={{ height: 10, backgroundColor: colors.bg.muted, borderRadius: 6, marginTop: 6, width: 70 }} />
                    </View>
                  )}
                />
              ) : moreLike.length === 0 ? (
                <Text style={{ color: colors.text.muted }}>No similar releases yet.</Text>
              ) : (
                <FlatList
                  data={moreLike}
                  keyExtractor={(item) => item.id}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  ItemSeparatorComponent={() => <View style={{ width: 12 }} />}
                  renderItem={({ item }) => (
                    <GlassCard asChild style={{ padding: 0, borderRadius: 16 }}>
                      <Pressable
                        onPress={() => goToRelease(item.id)}
                        style={({ pressed }) => ({
                          width: 140,
                          padding: 10,
                          borderRadius: 16,
                          opacity: pressed ? 0.9 : 1,
                        })}
                      >
                        <View style={{ width: 120, height: 120, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.bg.muted }}>
                          {item.imageUrl ? (
                            <Image source={{ uri: item.imageUrl }} style={{ width: 120, height: 120 }} />
                          ) : (
                            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                              <Text style={{ color: colors.text.muted, fontWeight: '900' }}>{(item.title || '?').slice(0, 1)}</Text>
                            </View>
                          )}
                        </View>
                        <Text style={{ marginTop: 8, fontWeight: '700', color: colors.text.secondary }} numberOfLines={1}>
                          {item.title}
                        </Text>
                        <Text style={{ color: colors.text.muted, fontSize: 12 }} numberOfLines={1}>
                          {item.artist}
                        </Text>
                      </Pressable>
                    </GlassCard>
                  )}
                />
              )}
            </View>

            <View style={{ marginTop: 18 }}>
              <Text style={{ color: colors.text.muted, fontSize: 12 }}>Release ID: {releaseId}</Text>
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
