import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useLocalSearchParams } from 'expo-router';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import GlassCard from '../../../components/GlassCard';
import Screen from '../../../components/Screen';
import { H } from '../../../components/haptics';
import { addToListFromSearch } from '../../../lib/listen';
import { formatDate } from '../../../lib/date';
import { getMarket, spotifyLookup, spotifySearch } from '../../../lib/spotify';
import { artistAlbums, artistSearch, fetchArtistDetails } from '../../../lib/spotifyArtist';
import { supabase } from '../../../lib/supabase';
import { useTheme } from '../../../theme/useTheme';

export default function ArtistMiniScreen() {
  const { colors } = useTheme();
  const { id, name, highlight } = useLocalSearchParams<{ id: string; name?: string; highlight?: string }>();
  let artistId = (id as string) || '';
  const displayName = (name || '').toString();
  const highlightId = (highlight || '').toString();
  const [loading, setLoading] = useState(true);
  const [albums, setAlbums] = useState<Awaited<ReturnType<typeof artistAlbums>>>([]);
  // no separate tracks list now; focusing on latest releases
  const [heroUrl, setHeroUrl] = useState<string | null>(null);
  const [resolvedName, setResolvedName] = useState<string>('');
  const [artistMeta, setArtistMeta] = useState<{ followers?: number; genres?: string[] } | null>(null);
  // Track items added during this session for visual feedback
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [listenStatus, setListenStatus] = useState<Record<string, { done?: boolean; rating?: number | null }>>({});
  // Only store confirmed artist profile images. V2 adds a kind flag to avoid album art leaks.
  const IMAGE_CACHE_KEY_V2 = 'artistImagesCacheV2';
  const IMAGE_CACHE_KEY_V1 = 'artistImagesCacheV1';
  const [filter, setFilter] = useState<'all' | 'single' | 'album'>('all');
  const fadeIn = useRef(new Animated.Value(0)).current;
  const scrollY = useRef(new Animated.Value(0)).current;

  const nameShown = useMemo(() => (displayName || resolvedName || 'Artist').toString(), [displayName, resolvedName]);

  const followersLabel = (n?: number) => {
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null;
    const fmt = (v: number) => {
      if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
      if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
      if (v >= 1_000) return `${(v / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
      return String(Math.round(v));
    };
    return `${fmt(n)} followers`;
  };

  // Simple shimmer for hero while image resolves
  const Shimmer = () => {
    const anim = useRef(new Animated.Value(0)).current;
    useEffect(() => {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(anim, { toValue: 1, duration: 900, useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0, duration: 900, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => { loop.stop(); };
    }, [anim]);
    const opacity = anim.interpolate({ inputRange: [0,1], outputRange: [0.35, 0.85] });
    return <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 240, backgroundColor: colors.bg.muted, opacity }} />;
  };

  const spotifyKey = (id?: string | null, url?: string | null) => {
    const parse = (v?: string | null) => {
      if (!v) return null;
      if (v.includes('open.spotify.com/')) {
        const m = v.match(/open\.spotify\.com\/(?:track|album)\/([A-Za-z0-9]+)/);
        return m?.[1] ?? null;
      }
      return v;
    };
    return parse(id) || parse(url) || id || null;
  };

  const refreshListenStatus = async () => {
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) { setListenStatus({}); return; }
      const { data, error } = await supabase
        .from('listen_list')
        .select('spotify_id, provider_id, done_at, rating');
      if (error || !data) return;
      const map: Record<string, { done?: boolean; rating?: number | null }> = {};
      (data || []).forEach((row: any) => {
        const key = row.spotify_id || row.provider_id;
        if (!key) return;
        map[key] = { done: !!row.done_at, rating: row.rating ?? null };
      });
      setListenStatus(map);
      const added = new Set<string>(addedIds);
      Object.keys(map).forEach(k => added.add(k));
      setAddedIds(added);
    } catch {}
  };

  useEffect(() => { refreshListenStatus(); }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
  // Avoid showing a stale hero image while navigating between artists
  setHeroUrl(null);
  setArtistMeta(null);
  setResolvedName('');
  setFilter('all');
      try {
  // Resolve artistId from name if needed (handle punctuation like trailing '..')
        const isSpotifyId = /^[A-Za-z0-9]{22}$/i.test(artistId);
        const clean = (s: string) => s
          .replace(/[.·•]+$/g, '') // drop trailing dot-like punctuation
          .replace(/\s{2,}/g, ' ')
          .trim();
        if (!isSpotifyId) {
    const candidates = [displayName, artistId, clean(displayName), clean(artistId)]
            .filter(Boolean)
            .map(String)
            .filter((v, i, a) => a.indexOf(v) === i);
          let resolved: string | null = null;
    const mk = getMarket();
    for (const mode of ['precise', 'loose'] as const) {
            if (resolved) break;
            for (const q of candidates) {
              if (!q) continue;
              try {
    const found = await artistSearch(q, mk, mode);
                if (found.length) { resolved = found[0].id; break; }
              } catch {}
            }
          }
          // Final fallback: general spotifySearch then pick first artist type
          if (!resolved) {
            for (const q of candidates) {
              try {
                const r = await spotifySearch(q);
                const firstArtist = r.find(x => x.type === 'artist');
                if (firstArtist) { resolved = firstArtist.id; break; }
              } catch {}
            }
          }
          if (resolved) artistId = resolved;
        }
        // Still not a valid spotify id? Abort gracefully
  if (!/^[A-Za-z0-9]{22}$/i.test(artistId)) throw new Error('Artist not found');

  // Keep artistId fixed (do not override with highlight's primary artist); we will only inject highlights that match this artist
        // Use cached hero image first (24h TTL)
        try {
          // Try V2 first, then V1 (but only accept entries clearly marked as artist images)
          const DAY_MS = 24*60*60*1000;
          const maybeLoad = async (key: string) => {
            try {
              const raw = await AsyncStorage.getItem(key);
              if (!raw) return null as string | null;
              const store = JSON.parse(raw);
              const v = store?.[artistId];
              if (!v) return null;
              const tsOk = typeof v.ts === 'number' && (Date.now() - v.ts) < DAY_MS;
              const kindOk = (v.k === 'artist') || key === IMAGE_CACHE_KEY_V1; // V1 had no kind flag; treat as unknown and avoid unless no V2
              if (v.url && tsOk && kindOk) return String(v.url);
              return null;
            } catch { return null; }
          };
          const v2 = await maybeLoad(IMAGE_CACHE_KEY_V2);
          if (v2) setHeroUrl((prev) => prev || v2);
          else {
            const v1 = await maybeLoad(IMAGE_CACHE_KEY_V1);
            if (v1) setHeroUrl((prev) => prev || v1);
          }
        } catch {}
        // Fetch albums with market fallbacks (device, GB, US)
        const mkList = Array.from(new Set([getMarket(), 'GB', 'US'].filter(Boolean)));
        let albs: Awaited<ReturnType<typeof artistAlbums>> = [];
        for (const mk of mkList) {
          try {
            const res = await artistAlbums(artistId, mk);
            albs = res;
            if (albs.length > 0) break;
          } catch {}
        }
        // Fallback: album-only via full-text search, strictly filtered by this artistId
        if (!albs.length) {
          try {
            const q = displayName || '';
            if (q) {
              const results = await spotifySearch(`artist:"${q}"`);
              const onlyAlbums = results.filter((x) => x.type === 'album' && (x.artistId ? x.artistId === artistId : true));
              const seen = new Set<string>();
              albs = onlyAlbums
                .filter((a) => (a.albumType !== 'compilation'))
                .filter((a) => (a.id && !seen.has(a.id) ? (seen.add(a.id), true) : false))
                .map((a) => ({
                  id: a.id,
                  title: a.title,
                  artist: a.artist || (displayName || ''),
                  releaseDate: a.releaseDate ?? null,
                  spotifyUrl: a.spotifyUrl ?? null,
                  imageUrl: a.imageUrl ?? null,
                  type: (a.albumType === 'single' ? 'single' : 'album') as any,
                }));
            }
          } catch {}
        }
        // Fetch artist details (non-fatal) then a precise artist search to obtain the canonical profile image (search view expected by user)
        let det: Awaited<ReturnType<typeof fetchArtistDetails>> = null;
        try { det = await fetchArtistDetails(artistId); } catch {}
        if (det?.name) setResolvedName(det.name);
        setArtistMeta({ followers: det?.followers, genres: det?.genres ?? [] });
        let preciseSearchImg: string | null = null;
        try {
          const qName = displayName || det?.name || '';
          if (qName) {
            const precise = await artistSearch(qName, 'GB', 'precise');
            const matched = precise.find(p => p.id === artistId);
            preciseSearchImg = matched?.imageUrl ?? null;
          }
        } catch {}
  const highlightIdLocal = (highlightId || '').trim();
        // If a highlight id is provided but not present, fetch it directly and include
        try {
          const hid = highlightIdLocal;
          if (hid && !albs.some(a => a.id === hid)) {
            try {
              const lookedAlbum = await spotifyLookup(hid, 'album');
              const a = lookedAlbum?.[0];
              if (a && a.id && (!a.artistId || a.artistId === artistId)) {
                albs.push({
                  id: a.id,
                  title: a.title,
                  artist: a.artist || (det?.name ?? displayName) || '',
                  releaseDate: a.releaseDate ?? null,
                  spotifyUrl: a.spotifyUrl ?? null,
                  imageUrl: a.imageUrl ?? null,
                  type: 'album',
                  albumGroup: 'album',
                } as any);
              } else {
                const lookedTrack = await spotifyLookup(hid, 'track');
                const t = lookedTrack?.[0];
                if (t && t.id && (!t.artistId || t.artistId === artistId)) {
                  albs.push({
                    id: t.id,
                    title: t.title,
                    artist: t.artist || (det?.name ?? displayName) || '',
                    releaseDate: t.releaseDate ?? null,
                    spotifyUrl: t.spotifyUrl ?? null,
                    imageUrl: t.imageUrl ?? null,
                    type: 'single',
                    albumGroup: 'single',
                  } as any);
                }
              }
            } catch {}
          }
        } catch {}

        // Sort newest first (normalize YYYY / YYYY-MM for stability across JS engines)
        const normalizeDate = (s?: string | null): string | null => {
          if (!s) return null;
          let x = String(s);
          if (/^\d{4}$/.test(x)) x = `${x}-07-01`;
          else if (/^\d{4}-\d{2}$/.test(x)) x = `${x}-15`;
          return x;
        };
        albs.sort((a,b) => {
          const ta = Date.parse(normalizeDate(a.releaseDate) ?? '1970-01-01');
          const tb = Date.parse(normalizeDate(b.releaseDate) ?? '1970-01-01');
          return tb - ta;
        });
        setAlbums(albs.slice(0, 24));
        const finalImg = preciseSearchImg || det?.imageUrl || null;
        if (finalImg) {
          setHeroUrl(finalImg);
          // Persist hero to V2 cache (kind=artist, src indicates chosen source), but do not downgrade a 'search' image to 'details'
          try {
            const rawPrev = await AsyncStorage.getItem(IMAGE_CACHE_KEY_V2);
            const obj = rawPrev ? JSON.parse(rawPrev) : {};
            const existing = obj[artistId];
            const src = preciseSearchImg ? 'search' : 'details';
            const shouldWrite = !existing || existing.src !== 'search' || src === 'search';
            if (shouldWrite) {
              obj[artistId] = { url: finalImg, ts: Date.now(), k: 'artist', src };
              await AsyncStorage.setItem(IMAGE_CACHE_KEY_V2, JSON.stringify(obj));
            }
            // Remove any legacy V1 entry for this artist to avoid future fallbacks
            try {
              const rawV1 = await AsyncStorage.getItem(IMAGE_CACHE_KEY_V1);
              if (rawV1) {
                const v1 = JSON.parse(rawV1);
                if (v1 && v1[artistId]) {
                  delete v1[artistId];
                  await AsyncStorage.setItem(IMAGE_CACHE_KEY_V1, JSON.stringify(v1));
                }
              }
            } catch {}
          } catch {}
        }
      } catch (e) {
        Alert.alert('Could not load artist');
      } finally {
        setLoading(false);
      }
    })();
  }, [id, name]);

  useEffect(() => {
    fadeIn.setValue(0);
    Animated.timing(fadeIn, { toValue: 1, duration: 260, useNativeDriver: true }).start();
  }, [id, fadeIn]);

  if (loading) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.text.muted} />
        </View>
      </Screen>
    );
  }

  // Render only this artist's albums/singles (no per-track rows)
  const merged: Array<{ kind: 'album'|'track'; id: string; title: string; artist: string; imageUrl?: string | null; releaseDate?: string | null; spotifyUrl?: string | null; albumGroup?: string | null; badge?: 'single'|'album'|'ep'|'feature' }> = [];
  const normDate = (s?: string | null) => {
    if (!s) return '1970-01-01';
    let x = String(s);
    if (/^\d{4}$/.test(x)) x = `${x}-07-01`;
    else if (/^\d{4}-\d{2}$/.test(x)) x = `${x}-15`;
    return x;
  };
  const normTitle = (s?: string | null) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const pickWeight = (badge?: string) => {
    if (badge === 'album') return 30;
    if (badge === 'ep') return 20;
    if (badge === 'single') return 10;
    if (badge === 'feature') return 5;
    return 0;
  };
  const bestByKey = new Map<string, any>();
  for (const a of albums) {
    const albumGroup = (a as any)?.albumGroup ?? null;
    const type = (a as any)?.type ?? null;
    const isFeature = String(albumGroup || '').toLowerCase() === 'appears_on';
    const badge: any =
      isFeature ? 'feature' :
      (String(type).toLowerCase() === 'ep' ? 'ep' :
        ((String(albumGroup).toLowerCase() === 'single' || String(type).toLowerCase() === 'single') ? 'single' : 'album'));
    const kind: 'album' | 'track' = badge === 'single' ? 'track' : 'album';
    const item = { kind, id: a.id, title: a.title, artist: a.artist, imageUrl: a.imageUrl, releaseDate: a.releaseDate, spotifyUrl: a.spotifyUrl, albumGroup, badge };
    const gk = `${normTitle(item.title)}__${normDate(item.releaseDate)}`;
    const score = Date.parse(normDate(item.releaseDate)) + pickWeight(item.badge);
    const prev = bestByKey.get(gk);
    if (!prev || score > prev._score) bestByKey.set(gk, { ...item, _score: score });
  }
  const deduped = Array.from(bestByKey.values());
  deduped.sort((a, b) => Date.parse(normDate(b.releaseDate)) - Date.parse(normDate(a.releaseDate)));
  deduped.slice(0, 24).forEach((it) => merged.push(it));
  merged.sort((a,b) => Date.parse(normDate(b.releaseDate)) - Date.parse(normDate(a.releaseDate)));

  const tagLabel = (stat: { done?: boolean; rating?: number | null } | undefined, isAdded: boolean) => {
    if (stat?.done) return 'Listened';
    return isAdded ? 'Added' : 'Save';
  };

  const ratingBadge = (stat?: { rating?: number | null }) => {
    if (!stat || typeof stat.rating !== 'number' || Number.isNaN(stat.rating)) return null;
    return (
      <View style={{ marginTop: 6, alignSelf: 'flex-start', backgroundColor: `${colors.accent.primary}22`, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 }}>
        <Text style={{ fontWeight: '800', color: colors.accent.primary, fontSize: 12 }}>★ {Number(stat.rating).toFixed(1)}</Text>
      </View>
    );
  };

  const latestReleaseDate = merged.find((m) => !!m.releaseDate)?.releaseDate ?? null;
  const genreLabel = (artistMeta?.genres || []).find(Boolean) || 'Artist';
  const followersText = followersLabel(artistMeta?.followers);

  const filtered = merged.filter((m) => {
    if (filter === 'single') return m.kind === 'track';
    if (filter === 'album') return m.kind === 'album';
    return true;
  });

  return (
    <Screen>
      <Animated.ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        scrollEventThrottle={16}
      >
        <View style={{ marginTop: 8, borderRadius: 24, overflow: 'hidden', backgroundColor: colors.bg.elevated }}>
          <Animated.View
            style={[
              StyleSheet.absoluteFillObject,
              {
                transform: [
                  {
                    translateY: scrollY.interpolate({
                      inputRange: [-40, 0, 240],
                      outputRange: [10, 0, -28],
                      extrapolate: 'clamp',
                    }),
                  },
                ],
              },
            ]}
          >
            {heroUrl ? (
              <Image source={{ uri: heroUrl }} style={{ width: '100%', height: 260, opacity: 0.9 }} />
            ) : (
              <Shimmer />
            )}
          </Animated.View>

          <LinearGradient
            pointerEvents="none"
            colors={['rgba(0,0,0,0.05)', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0.78)']}
            locations={[0, 0.55, 1]}
            style={{ height: 240 }}
          />

          <Pressable
            onPress={() => router.back()}
            hitSlop={14}
            style={({ pressed }) => ({
              position: 'absolute',
              top: 10,
              left: 10,
              paddingHorizontal: 12,
              paddingVertical: 10,
              borderRadius: 999,
              backgroundColor: 'rgba(0,0,0,0.28)',
              opacity: pressed ? 0.9 : 1,
            })}
          >
            <Text style={{ fontWeight: '800', color: colors.text.inverted }}>{'‹'} Back</Text>
          </Pressable>

          <View style={{ position: 'absolute', left: 12, right: 12, bottom: 12 }}>
            <BlurView intensity={28} tint="dark" style={{ borderRadius: 18, overflow: 'hidden' }}>
              <View style={{ paddingHorizontal: 12, paddingVertical: 10, backgroundColor: 'rgba(0,0,0,0.22)' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent.primary }} />
                  <Text style={{ fontSize: 22, fontWeight: '800', letterSpacing: 0.3, color: colors.text.inverted }} numberOfLines={1}>
                    {nameShown}
                  </Text>
                </View>
              </View>
            </BlurView>
          </View>
        </View>

        <Animated.View style={{ opacity: fadeIn }}>
          <GlassCard style={{ marginTop: 12, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 18 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', rowGap: 8, columnGap: 10 }}>
              {followersText ? (
                <Text style={{ color: colors.text.secondary, fontWeight: '700', fontSize: 12 }}>{followersText}</Text>
              ) : null}
              <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: `${colors.accent.primary}22`, borderWidth: 1, borderColor: `${colors.accent.primary}33` }}>
                <Text style={{ color: colors.accent.primary, fontWeight: '800', fontSize: 11, letterSpacing: 0.4 }}>
                  {String(genreLabel).toUpperCase().slice(0, 18)}
                </Text>
              </View>
              {latestReleaseDate ? (
                <Text style={{ color: colors.text.muted, fontWeight: '700', fontSize: 12 }}>
                  Last release: {formatDate(latestReleaseDate)}
                </Text>
              ) : null}
            </View>
          </GlassCard>

          <View style={{ marginTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text.secondary }}>Latest releases</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {([
                { key: 'all' as const, label: 'All' },
                { key: 'single' as const, label: 'Singles' },
                { key: 'album' as const, label: 'Albums' },
              ]).map((opt) => {
                const selected = filter === opt.key;
                return (
                  <Pressable
                    key={opt.key}
                    onPress={() => setFilter(opt.key)}
                    hitSlop={8}
                    style={({ pressed }) => ({
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: selected ? colors.accent.primary : colors.border.subtle,
                      backgroundColor: selected ? `${colors.accent.primary}22` : colors.bg.secondary,
                      opacity: pressed ? 0.9 : 1,
                    })}
                  >
                    <Text style={{ color: selected ? colors.accent.primary : colors.text.secondary, fontWeight: '800', fontSize: 12 }}>
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={{ marginTop: 12, gap: 10 }}>
            {filtered.map(item => {
            const key = spotifyKey(item.id, item.spotifyUrl);
            const stat = key ? listenStatus[key] : undefined;
            const isAdded = (key && addedIds.has(key)) || addedIds.has(item.id) || !!stat;
            const label = tagLabel(stat, isAdded);
            const badgeLabel =
              item.badge === 'feature' ? 'FEATURE' :
              item.badge === 'ep' ? 'EP' :
              item.kind === 'track' ? 'SINGLE' : 'ALBUM';
            const canSave = label === 'Save';
            const actionBg = stat?.done
              ? `${colors.accent.success}22`
              : (isAdded ? colors.bg.muted : `${colors.bg.muted}cc`);
            const actionFg = stat?.done ? colors.accent.success : (isAdded ? colors.text.secondary : colors.text.secondary);
            const iconName =
              stat?.done ? 'checkmark-circle' :
              isAdded ? 'checkmark' :
              'bookmark-outline';
            return (
              <GlassCard key={item.id} asChild style={{ paddingVertical: 12, paddingHorizontal: 12, borderRadius: 18 }}>
                <Pressable
                  onPress={() => {
                    const url = item.spotifyUrl || null;
                    if (url) Linking.openURL(url).catch(() => {});
                  }}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    opacity: pressed ? 0.92 : 1,
                    transform: [{ scale: pressed ? 0.995 : 1 }],
                  })}
                >
                  <View style={{ width: 68, height: 68, borderRadius: 14, backgroundColor: colors.bg.muted, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    {item.imageUrl ? (
                      <Image source={{ uri: item.imageUrl }} style={{ width: 68, height: 68 }} />
                    ) : heroUrl ? (
                      <Image source={{ uri: heroUrl }} style={{ width: 68, height: 68 }} />
                    ) : (
                      <Text style={{ fontSize: 28, fontWeight: '800', color: colors.text.muted }}>{item.kind === 'track' ? '♪' : 'Ⓐ'}</Text>
                    )}
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ fontWeight: '800', color: colors.text.secondary, flexShrink: 1 }} numberOfLines={1}>
                        {item.title}
                      </Text>
                      <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: `${colors.text.secondary}14`, borderWidth: 1, borderColor: `${colors.text.secondary}22` }}>
                        <Text style={{ color: colors.text.secondary, fontWeight: '900', fontSize: 10, letterSpacing: 0.5 }}>
                          {badgeLabel}
                        </Text>
                      </View>
                    </View>
                    <Text style={{ color: colors.text.muted, marginTop: 4 }} numberOfLines={1}>
                      {item.artist}
                    </Text>
                    {!!item.releaseDate && (
                      <Text style={{ color: `${colors.text.muted}cc`, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                        {formatDate(item.releaseDate)}
                      </Text>
                    )}
                    {ratingBadge(stat)}
                  </View>
                  <Pressable
                    disabled={!canSave}
                    onPress={async () => {
                      if (!canSave) return;
                      const res = await addToListFromSearch({
                        type: item.kind,
                        title: item.title,
                        artist: item.artist,
                        releaseDate: item.releaseDate ?? null,
                        spotifyUrl: item.spotifyUrl ?? null,
                        appleUrl: null,
                        artworkUrl: item.imageUrl ?? null,
                        providerId: key ?? item.id,
                      });
                      if (res.ok) {
                        H.success();
                        const next = new Set(addedIds);
                        if (key) next.add(key);
                        next.add(item.id);
                        setAddedIds(next);
                        refreshListenStatus();
                      } else {
                        H.error();
                        Alert.alert(res.message || 'Could not save');
                      }
                    }}
                    hitSlop={10}
                    style={({ pressed }) => ({
                      width: 40,
                      height: 40,
                      borderRadius: 20,
                      backgroundColor: actionBg,
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: pressed ? 0.9 : 1,
                      borderWidth: 1,
                      borderColor: `${colors.border.subtle}66`,
                    })}
                  >
                    <Ionicons name={iconName as any} size={18} color={actionFg} />
                  </Pressable>
                </Pressable>
              </GlassCard>
            );
          })}
          </View>
        </Animated.View>
      </Animated.ScrollView>
    </Screen>
  );
}
