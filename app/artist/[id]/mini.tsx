import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Image, Pressable, SafeAreaView, ScrollView, Text, View } from 'react-native';
import { H } from '../../../components/haptics';
import { addToListFromSearch } from '../../../lib/listen';
import { getMarket, spotifyLookup, spotifySearch } from '../../../lib/spotify';
import { artistAlbums, artistSearch, fetchArtistDetails } from '../../../lib/spotifyArtist';

export default function ArtistMiniScreen() {
  const { id, name, highlight } = useLocalSearchParams<{ id: string; name?: string; highlight?: string }>();
  let artistId = (id as string) || '';
  const displayName = (name || '').toString();
  const highlightId = (highlight || '').toString();
  const [loading, setLoading] = useState(true);
  const [albums, setAlbums] = useState<Awaited<ReturnType<typeof artistAlbums>>>([]);
  // no separate tracks list now; focusing on latest releases
  const [heroUrl, setHeroUrl] = useState<string | null>(null);
  // Only store confirmed artist profile images. V2 adds a kind flag to avoid album art leaks.
  const IMAGE_CACHE_KEY_V2 = 'artistImagesCacheV2';
  const IMAGE_CACHE_KEY_V1 = 'artistImagesCacheV1';

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
    return <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 240, backgroundColor: '#e5e7eb', opacity }} />;
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
  // Avoid showing a stale hero image while navigating between artists
  setHeroUrl(null);
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
        setAlbums(albs.slice(0, 10));
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

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: 'white', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  // Render only this artist's albums/singles (no per-track rows)
  const merged: Array<{ kind: 'album'|'track'; id: string; title: string; artist: string; imageUrl?: string | null; releaseDate?: string | null; spotifyUrl?: string | null; albumGroup?: string | null } > = [];
  for (const a of albums.slice(0,10)) {
    const kind: 'album' | 'track' = 'album';
    merged.push({ kind, id: a.id, title: a.title, artist: a.artist, imageUrl: a.imageUrl, releaseDate: a.releaseDate, spotifyUrl: a.spotifyUrl, albumGroup: (a as any)?.albumGroup ?? null });
  }
  const normDate = (s?: string | null) => {
    if (!s) return '1970-01-01';
    let x = String(s);
    if (/^\d{4}$/.test(x)) x = `${x}-07-01`;
    else if (/^\d{4}-\d{2}$/.test(x)) x = `${x}-15`;
    return x;
  };
  merged.sort((a,b) => Date.parse(normDate(b.releaseDate)) - Date.parse(normDate(a.releaseDate)));
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: 'white' }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={{ position: 'relative', height: 200, backgroundColor: '#111', overflow: 'hidden' }}>
          {heroUrl ? (
            <Image source={{ uri: heroUrl }} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 240, opacity: 0.6 }} />
          ) : (
            <Shimmer />
          )}
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.2)' }} />
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 }}>
            <Text style={{ fontSize: 30, fontWeight: '800', color: 'white' }} numberOfLines={1}>{displayName || 'Artist'}</Text>
          </View>
          <Pressable onPress={() => router.back()} hitSlop={10} style={{ position: 'absolute', top: 14, left: 16 }}>
            <Text style={{ fontWeight: '700', color: 'white' }}>{'‹'} Back</Text>
          </Pressable>
        </View>
        <View style={{ paddingHorizontal: 16, marginTop: 20 }}>
          <Text style={{ fontSize: 20, fontWeight: '700', marginBottom: 12 }}>Latest releases</Text>
          {merged.map(item => (
            <View key={item.id} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
              <View style={{ width: 64, height: 64, borderRadius: 8, backgroundColor: '#e5e7eb', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                {item.imageUrl ? (
                  <Image source={{ uri: item.imageUrl }} style={{ width: 64, height: 64 }} />
                ) : heroUrl ? (
                  <Image source={{ uri: heroUrl }} style={{ width: 64, height: 64 }} />
                ) : (
                  <Text style={{ fontSize: 28, fontWeight: '800', color: '#999' }}>{item.kind === 'track' ? '♪' : 'Ⓐ'}</Text>
                )}
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={{ fontWeight: '600' }} numberOfLines={1}>{item.title}</Text>
                <Text style={{ color: '#666', fontSize: 12 }} numberOfLines={1}>{item.artist}</Text>
                {/* highlight const previously leaked here; removed */}
                {!!item.releaseDate && (
                  <Text style={{ color: '#6b7280', fontSize: 12, marginTop: 2 }}>{item.releaseDate}</Text>
                )}
                {item.albumGroup === 'appears_on' && (
                  <View style={{ marginTop: 6, alignSelf: 'flex-start', backgroundColor: '#EEF2FF', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                    <Text style={{ color: '#3730A3', fontSize: 10, fontWeight: '700' }}>FEATURE</Text>
                  </View>
                )}
              </View>
              <Pressable
                onPress={async () => {
                  const res = await addToListFromSearch({
                    type: item.kind,
                    title: item.title,
                    artist: item.artist,
                    releaseDate: item.releaseDate ?? null,
                    spotifyUrl: item.spotifyUrl ?? null,
                    appleUrl: null,
                  });
                  if (res.ok) { H.success(); } else { H.error(); Alert.alert(res.message || 'Could not save'); }
                }}
                style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: '#0a7' }}
              >
                <Text style={{ fontWeight: '700', color: 'white', fontSize: 12 }}>Add</Text>
              </Pressable>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}