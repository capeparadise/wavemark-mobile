import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, AppState, Dimensions, FlatList, Image, Linking, Pressable, SectionList, Text, TextInput, View, Modal } from 'react-native';
import FollowButton from '../../components/FollowButton';
import { H } from '../../components/haptics';
import Screen from '../../components/Screen';
import StatusMenu from '../../components/StatusMenu';
import GlassCard from '../../components/GlassCard';
import Chip from '../../components/Chip';
import HeroReleaseCard from '../../components/discover/HeroReleaseCard';
import { formatDate } from '../../lib/date';
import { fetchFeed, fetchFeedForArtists, listFollowedArtists, type FeedItem } from '../../lib/follow';
import { off, on } from '../../lib/events';
import { addToListFromSearch, markDoneByProvider } from '../../lib/listen';
import { openArtist } from '../../lib/openArtist';
import { getNewReleases } from '../../lib/recommend';
import { getMarket, parseSpotifyUrlOrId, spotifyLookup, spotifySearch, type SpotifyResult } from '../../lib/spotify';
import { artistAlbums, artistTopTracks, fetchArtistDetails } from '../../lib/spotifyArtist';
import { supabase } from '../../lib/supabase';
import { useOffline } from '../../components/useOffline';
import { useTheme } from '../../theme/useTheme';
import Ionicons from '@expo/vector-icons/Ionicons';
import { filterReleasesByGenres, loadIncludedGenres, saveIncludedGenres, mapToCanonicalGenres, getArtistGenresCached, type CanonicalGenre } from '../../lib/styleFilters';
import { RELEASE_LONG_PRESS_MS } from '../../hooks/useReleaseActions';

type Row = { kind: 'section-title'; title: string }
  | { kind: 'new'; id: string; title: string; artist: string; releaseDate?: string | null; spotifyUrl?: string | null; imageUrl?: string | null; type?: 'album' | 'single' | 'ep' }
  | { kind: 'search'; r: SpotifyResult };

const SCREEN_WIDTH = Dimensions.get('window').width;
type DiscoverViewMode = 'mixed' | 'pills';
const DISCOVER_VIEW_MODE_KEY = 'discover.viewMode';

function spotifyKey(id?: string | null, spotifyUrl?: string | null) {
  const parse = (v?: string | null) => {
    if (!v) return null;
    if (v.includes('open.spotify.com/')) {
      const m = v.match(/open\.spotify\.com\/(?:track|album)\/([A-Za-z0-9]+)/);
      return m?.[1] ?? null;
    }
    return v;
  };
  return parse(id) || parse(spotifyUrl) || id || null;
}

const GENRE_OPTIONS: { key: CanonicalGenre | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'hiphop', label: 'Hip-Hop' },
  { key: 'rnb', label: 'R&B' },
  { key: 'pop', label: 'Pop' },
  { key: 'rock', label: 'Rock' },
  { key: 'indie', label: 'Indie' },
  { key: 'electronic', label: 'Electronic' },
  { key: 'afrobeats', label: 'Afrobeats' },
  { key: 'latin', label: 'Latin' },
  { key: 'country', label: 'Country' },
  { key: 'jazz', label: 'Jazz' },
  { key: 'classical', label: 'Classical' },
  { key: 'metal', label: 'Metal' },
  { key: 'gospel', label: 'Gospel' },
  { key: 'kpop', label: 'K-Pop' },
];

export default function DiscoverTab() {
  const { colors } = useTheme();
  const accentSoft = colors.accent.primary + '1a';
  const successSoft = colors.accent.success + '1a';
  const navigation = useNavigation();
  const [viewMode, setViewMode] = useState<DiscoverViewMode>('mixed');
  const viewAnim = useRef(new Animated.Value(1)).current;
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [searchRows, setSearchRows] = useState<SpotifyResult[]>([]);
  // Upcoming removed
  const [artist, setArtist] = useState<{ id: string; name: string } | null>(null);
  const [artistAlbumsRows, setArtistAlbumsRows] = useState<Awaited<ReturnType<typeof artistAlbums>>>([]);
  const [artistTracksRows, setArtistTracksRows] = useState<Awaited<ReturnType<typeof artistTopTracks>>>([]);
  const [newReleases, setNewReleases] = useState<Awaited<ReturnType<typeof getNewReleases>>>([]);
  const [filteredTopPicks, setFilteredTopPicks] = useState<Awaited<ReturnType<typeof getNewReleases>>>([]);
  const [filteredTrending, setFilteredTrending] = useState<Awaited<ReturnType<typeof getNewReleases>>>([]);
  const [genreRows, setGenreRows] = useState<Array<{ genre: CanonicalGenre; items: Awaited<ReturnType<typeof getNewReleases>> }>>([]);
  const [youMightLike, setYouMightLike] = useState<Array<any>>([]);
  const [takenTopPicks, setTakenTopPicks] = useState<Set<string>>(new Set());
  const asapDebuggedRef = useRef(false);
  const [initialLoading, setInitialLoading] = useState<boolean>(true);
  // Removed upcoming list
  // Genres removed from Discover
  const [debounceTimer, setDebounceTimer] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [fallbackFeed, setFallbackFeed] = useState<FeedItem[]>([]);
  const [picked, setPicked] = useState<Array<{ id: string; artistId: string; title: string; artist: string; releaseDate?: string | null; spotifyUrl?: string | null; imageUrl?: string | null; type?: 'album' | 'single' | 'ep' }>>([]);
  const [pickedLoading, setPickedLoading] = useState(false);
  const [forYouItems, setForYouItems] = useState<Array<{ id: string; name: string; imageUrl?: string | null; latestId?: string; latestDate?: string | null }>>([]);
  const [forYouLoading, setForYouLoading] = useState<boolean>(true);
  const [yourUpdatesReleases, setYourUpdatesReleases] = useState<Array<{ id: string; title: string; artist: string; artistId?: string | null; releaseDate?: string | null; spotifyUrl?: string | null; imageUrl?: string | null; type?: 'album' | 'single' | 'ep' }>>([]);
  const [selectedGenres, setSelectedGenres] = useState<Set<CanonicalGenre>>(new Set());
  const [draftGenres, setDraftGenres] = useState<Set<string>>(new Set(['all']));
  const [filterVisible, setFilterVisible] = useState(false);
  const [reasonRow, setReasonRow] = useState<any | null>(null);
  // Track items saved during this session to show a ✓ instead of Save/Add
  const [addedIds, setAddedIds] = useState<Record<string, true>>({});
  // Listen state map (by spotify_id/provider_id) to surface rating/done status
  const [listenStatus, setListenStatus] = useState<Record<string, { rating?: number | null; done?: boolean; details?: any }>>({});
  // Clean-bubble data: details (name/photo) and latest recent release per followed artist
  const [followedDetails, setFollowedDetails] = useState<Record<string, { name: string; imageUrl?: string | null }>>({});
  const [recentByArtist, setRecentByArtist] = useState<Record<string, { latestId?: string; latestDate?: string | null }>>({});
  // Cache for artist profile images used in the "picked for you" lane
  const [artistImageMap, setArtistImageMap] = useState<Record<string, string>>({});
  const [artistNameMap, setArtistNameMap] = useState<Record<string, string>>({});
  const artistImgPending = useRef<Set<string>>(new Set());
  const [menuRow, setMenuRow] = useState<any | null>(null);
  const lastFetchRef = useRef<number>(0);
  const artistImageMapRef = useRef<Record<string, string>>({});
  const { offline } = useOffline();
  const GENRE_LABEL_MAP = useMemo(() => {
    const map: Record<string, string> = {};
    GENRE_OPTIONS.forEach((g) => { map[g.key] = g.label; });
    return map;
  }, []);
  // Artist profile image cache (V2 adds kind to avoid album art contamination). We'll read V1 as legacy fallback.
  const IMAGE_CACHE_KEY_V2 = 'artistImagesCacheV2';
  const IMAGE_CACHE_KEY_V1 = 'artistImagesCacheV1';
  const PICKED_CACHE_KEY = 'pickedCacheV1';
  const FOR_YOU_CACHE_KEY = 'discover_for_you_v1';
  const FOR_YOU_UPDATES_CACHE_KEY = 'discover_for_you_updates_v1';
  const [pickedDebug, setPickedDebug] = useState<{ followed: number; feedRecents: number; albumRecents: number; trackRecents: number; final: number; missing: number } | null>(null);
  const NEW_RELEASES_CACHE_KEY = 'discover_new_releases_v1';
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

  useEffect(() => {
    artistImageMapRef.current = artistImageMap;
  }, [artistImageMap]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const v = await AsyncStorage.getItem(DISCOVER_VIEW_MODE_KEY);
        if (!mounted) return;
        if (v === 'mixed' || v === 'pills') setViewMode(v);
      } catch {}
    })();
    return () => { mounted = false; };
  }, []);

  const animateViewTransition = useCallback(() => {
    viewAnim.stopAnimation();
    viewAnim.setValue(0);
    Animated.timing(viewAnim, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [viewAnim]);

  const toggleViewMode = useCallback(() => {
    const next: DiscoverViewMode = viewMode === 'mixed' ? 'pills' : 'mixed';
    setViewMode(next);
    H.tap();
    animateViewTransition();
    AsyncStorage.setItem(DISCOVER_VIEW_MODE_KEY, next).catch(() => {});
  }, [animateViewTransition, viewMode]);

  const topPicksSource = useMemo(() => newReleases.slice(0, Math.min(12, newReleases.length)), [newReleases]);
  const trendingSource = useMemo(() => {
    if (fallbackFeed.length) {
      return fallbackFeed.slice(0, 12).map((item) => ({
        id: item.id,
        title: item.title,
        artist: item.artist_name ?? 'Unknown',
        releaseDate: item.release_date ?? null,
        imageUrl: item.image_url ?? null,
        spotifyUrl: item.spotify_url ?? null,
        type: (item as any).item_type ?? null,
        artistId: (item as any).artist_id ?? null,
      }));
    }
    return newReleases.slice(topPicksSource.length, topPicksSource.length + 12);
  }, [fallbackFeed, newReleases, topPicksSource.length]);

  useEffect(() => {
    (async () => {
      const effective = selectedGenres;
      const taken = new Set<string>();
      const removeSaved = (arr: typeof topPicksSource) => arr.filter((it) => {
        const key = spotifyKey(it.id, it.spotifyUrl);
        if (!key) return true;
        return !(listenStatus[key] || addedIds[key]);
      });
      let top = removeSaved(topPicksSource);
      let trending = removeSaved(trendingSource);
      if (effective.size) {
        top = await filterReleasesByGenres(top, effective);
        trending = await filterReleasesByGenres(trending, effective);
      }
      top.forEach((it) => {
        const key = spotifyKey(it.id, it.spotifyUrl);
        if (key) taken.add(key);
      });
      setFilteredTopPicks(top);
      setFilteredTrending(trending);
      setTakenTopPicks(taken);
    })();
  }, [topPicksSource, trendingSource, selectedGenres, listenStatus, addedIds]);

  useEffect(() => {
    let cancelled = false;
    const buildGenreRows = async () => {
      const canonicalOrder = GENRE_OPTIONS.filter((g) => g.key !== 'all').map((g) => g.key as CanonicalGenre);
      const targets: CanonicalGenre[] = selectedGenres.size ? Array.from(selectedGenres) : canonicalOrder;
      const rowsWithCounts = await Promise.all(
        targets.map(async (g) => {
          const items = await filterReleasesByGenres(newReleases, new Set<CanonicalGenre>([g]));
          return { genre: g, items: items.slice(0, 12), count: items.length };
        })
      );
      const nonEmpty = rowsWithCounts.filter((r) => r.count > 0);
      nonEmpty.sort((a, b) => b.count - a.count);
      const MAX_GENRE_ROWS = selectedGenres.size ? 6 : 8;
      if (!cancelled) setGenreRows(nonEmpty.slice(0, MAX_GENRE_ROWS).map(({ genre, items }) => ({ genre, items })));
    };
    buildGenreRows();
    return () => { cancelled = true; };
  }, [newReleases, selectedGenres]);

  useEffect(() => {
    setDraftGenres(selectedGenres.size ? new Set(selectedGenres) : new Set(['all']));
  }, [selectedGenres]);

  const hasYourUpdates = useMemo(() => {
    const recentCount = Object.keys(recentByArtist || {}).length;
    return (forYouItems?.length ?? 0) > 0 || recentCount > 0;
  }, [forYouItems, recentByArtist]);

  const hasDiscoverContent = useMemo(() => {
    const genreContent = genreRows.some((r) => r.items.length > 0);
    return hasYourUpdates || filteredTopPicks.length > 0 || youMightLike.length > 0 || genreContent;
  }, [filteredTopPicks.length, genreRows, hasYourUpdates, youMightLike.length]);

  const toggleDraftGenre = (key: CanonicalGenre | 'all') => {
    setDraftGenres((prev) => {
      const next = new Set(prev);
      if (key === 'all') {
        return new Set(['all']);
      }
      next.delete('all');
      if (next.has(key)) next.delete(key);
      else next.add(key);
      if (next.size === 0) next.add('all');
      return next;
    });
  };

  const applyGenres = async () => {
    const next = draftGenres.has('all') ? new Set<CanonicalGenre>() : new Set(Array.from(draftGenres) as CanonicalGenre[]);
    setSelectedGenres(next);
    await saveIncludedGenres(next);
    setFilterVisible(false);
  };

  const clearGenres = useCallback(async () => {
    const empty = new Set<CanonicalGenre>();
    setDraftGenres(new Set(['all']));
    setSelectedGenres(empty);
    await saveIncludedGenres(empty);
  }, []);

  const renderEmpty = useCallback(() => {
    if (hasDiscoverContent) return null;
    if (selectedGenres.size) {
      return (
        <View style={{ marginTop: 16, gap: 10, alignItems: 'flex-start' }}>
          <Text style={{ color: colors.text.muted }}>No releases match your filters.</Text>
          <Pressable onPress={clearGenres} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.bg.muted, borderWidth: 1, borderColor: colors.border.subtle }}>
            <Text style={{ color: colors.text.secondary, fontWeight: '700' }}>Clear filters</Text>
          </Pressable>
        </View>
      );
    }
    return <Text style={{ marginTop: 16, color: colors.text.muted }}>No results yet. Try Refresh or search for an artist/album.</Text>;
  }, [hasDiscoverContent, selectedGenres.size, colors.text.muted, colors.bg.muted, colors.border.subtle, colors.text.secondary, clearGenres]);

  const buildTasteRecommendations = useCallback(async () => {
    if (!newReleases.length) {
      setYouMightLike([]);
      return;
    }
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) {
        setYouMightLike([]);
        return;
      }
      const { data } = await supabase
        .from('listen_list')
        .select('id,title,artist_name,item_type,rating,rated_at,spotify_id,provider_id,spotify_url')
        .eq('user_id', user.id)
        .not('rating', 'is', null)
        .not('done_at', 'is', null)
        .order('rating', { ascending: false, nullsFirst: false })
        .order('rated_at', { ascending: false, nullsFirst: true })
        .limit(100);
      const rated = (data as any[] | null) ?? [];
      const tracks = rated.filter((r) => (r.item_type || '').toLowerCase() === 'track');
      const albums = rated.filter((r) => (r.item_type || '').toLowerCase() !== 'track');
      const topTaste = [...tracks.slice(0, 20), ...albums.slice(0, 10)].slice(0, 30);

      const artistScore = new Map<string, { score: number; sample: string }>();
      const artistIdSet = new Set<string>();
      const genreScores: Record<CanonicalGenre, number> = {} as any;
      const artistSource = new Map<string, any>();
      const genreSourceTrack: Partial<Record<CanonicalGenre, any>> = {};

      const normArtist = (name?: string | null) => (name || '').trim().toLowerCase();
      const extractId = (v?: string | null) => {
        if (!v) return null;
        const m = String(v).match(/([A-Za-z0-9]{22})/);
        return m?.[1] ?? null;
      };
      const daysSince = (d?: string | null) => {
        if (!d) return 999;
        const t = Date.parse(d);
        if (Number.isNaN(t)) return 999;
        return Math.max(0, Math.floor((Date.now() - t) / (24*60*60*1000)));
      };

      for (const r of topTaste) {
        const scoreBase = Number(r.rating) || 0;
        const recBonus = Math.max(0, 1.5 - Math.min(1.5, daysSince(r.rated_at) / 45));
        const weight = scoreBase + recBonus;
        const a = normArtist(r.artist_name);
        if (a) {
          const existing = artistScore.get(a);
          artistScore.set(a, { score: (existing?.score ?? 0) + weight, sample: existing?.sample || r.title || a });
          if (!artistSource.has(a)) {
            artistSource.set(a, { id: extractId(r.spotify_id || r.provider_id || r.spotify_url), title: r.title, artist: r.artist_name, artwork_url: r.artwork_url, user_rating: r.rating });
          }
        }
        const id = extractId(r.spotify_id || r.provider_id || r.spotify_url);
        if (id) {
          try {
            const lookup = await spotifyLookup(id, 'track');
            const artistId = lookup[0]?.artistId;
            if (artistId) {
              artistIdSet.add(artistId);
              const genres = await getArtistGenresCached(artistId);
              const mapped = mapToCanonicalGenres(genres);
              mapped.forEach((g) => {
                genreScores[g] = (genreScores[g] ?? 0) + weight;
                if (!genreSourceTrack[g]) {
                  genreSourceTrack[g] = { id, title: r.title, artist: r.artist_name, artwork_url: r.artwork_url, user_rating: r.rating };
                }
              });
            }
          } catch {
            // ignore lookup failures
          }
        }
      }

      const topGenres = Object.entries(genreScores)
        .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
        .map(([g]) => g as CanonicalGenre);

      const listenedKeys = new Set<string>(Object.keys(listenStatus || {}));
      Object.keys(addedIds || {}).forEach((k) => listenedKeys.add(k));

      const scored: Array<any> = [];
      for (const item of newReleases) {
        const key = spotifyKey(item.id, item.spotifyUrl);
        if (key && (listenedKeys.has(key) || takenTopPicks.has(key))) continue;
        const artistLower = normArtist(item.artist);
        const artistHit = artistLower ? artistScore.get(artistLower) : null;
        const artistIdHit = item.artistId && artistIdSet.has(item.artistId);
        let score = 0;
        let reason = '';
        let reasonType: 'SIMILAR_TO_TOP_RATED' | 'MATCHES_FAV_GENRE' | 'RELATED_TO_ARTIST' | 'FALLBACK' | undefined;
        let sourceTrack: any = null;
        let sourceArtist: any = null;
        let sourceGenre: string | undefined;
        if (artistHit || artistIdHit) {
          score += 3 + (artistHit?.score ?? 0);
          reason = `Recommended because you rated ${(artistHit?.sample || item.artist || 'this artist')} highly.`;
          reasonType = 'RELATED_TO_ARTIST';
          sourceArtist = { name: item.artist, id: item.artistId || null, artwork_url: item.imageUrl || null };
          const asrc = artistLower ? artistSource.get(artistLower) : null;
          if (asrc) sourceTrack = asrc;
        }
        let mapped: CanonicalGenre[] = [];
        try {
          mapped = mapToCanonicalGenres(await getArtistGenresCached(item.artistId));
        } catch {}
        if (selectedGenres.size && mapped.length && !mapped.some((g) => selectedGenres.has(g))) {
          continue;
        }
        const overlaps = mapped.filter((g) => genreScores[g]);
        if (overlaps.length) {
          const g = overlaps[0];
          score += 1.5 + (genreScores[g] ?? 0);
          if (!reason) {
            const label = GENRE_LABEL_MAP[g] || g;
            reason = `Recommended because you love ${label}.`;
            reasonType = 'MATCHES_FAV_GENRE';
            sourceGenre = label;
          }
          if (!sourceTrack && genreSourceTrack[g]) sourceTrack = genreSourceTrack[g];
        } else if (!reason && topGenres.length && mapped.length) {
          const matchTop = mapped.find((g) => topGenres.includes(g));
          if (matchTop) {
            score += 0.8;
            reason = `Matches your favourite styles (${GENRE_LABEL_MAP[matchTop] || matchTop}).`;
            reasonType = 'MATCHES_FAV_GENRE';
            sourceGenre = GENRE_LABEL_MAP[matchTop] || matchTop;
            if (!sourceTrack && genreSourceTrack[matchTop]) sourceTrack = genreSourceTrack[matchTop];
          }
        }
        if (!reason && topGenres.length) {
          const g = topGenres[0];
          score += 0.5;
          reason = `Because you listen to ${GENRE_LABEL_MAP[g] || g}.`;
          reasonType = 'MATCHES_FAV_GENRE';
          sourceGenre = GENRE_LABEL_MAP[g] || g;
          if (!sourceTrack && genreSourceTrack[g]) sourceTrack = genreSourceTrack[g];
        }
        const normDate = (s?: string | null) => {
          if (!s) return null;
          let x = String(s);
          if (/^\d{4}$/.test(x)) x = `${x}-07-01`;
          else if (/^\d{4}-\d{2}$/.test(x)) x = `${x}-15`;
          return x;
        };
        const rd = normDate(item.releaseDate);
        if (rd) {
          const ageDays = daysSince(rd);
          const recBoost = Math.max(0, 1 - Math.min(1, ageDays / 120));
          score += recBoost;
        }
        scored.push({
          ...item,
          reason: reason || 'Similar to your top-rated tracks.',
          score,
          reasonType: reasonType ?? (reason ? 'SIMILAR_TO_TOP_RATED' : 'FALLBACK'),
          sourceTrack,
          sourceArtist,
          sourceGenre,
        });
      }
      scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const ad = a.releaseDate ? Date.parse(a.releaseDate) : 0;
        const bd = b.releaseDate ? Date.parse(b.releaseDate) : 0;
        return bd - ad;
      });

      let finalList = scored.slice(0, 12);
      if (!finalList.length && topGenres.length) {
        const topGenreSet = new Set<CanonicalGenre>(topGenres.slice(0, 3));
        const fallback = await Promise.all(newReleases.map(async (item) => {
          const key = spotifyKey(item.id, item.spotifyUrl);
          if (key && (listenedKeys.has(key) || takenTopPicks.has(key))) return null;
          let mapped: CanonicalGenre[] = [];
          try { mapped = mapToCanonicalGenres(await getArtistGenresCached(item.artistId)); } catch {}
          if (mapped.some((g) => topGenreSet.has(g))) {
            return {
              ...item,
              reason: `Because you listen to ${GENRE_LABEL_MAP[topGenres[0]] || topGenres[0]}.`,
              score: 0,
              reasonType: 'MATCHES_FAV_GENRE',
              sourceTrack: genreSourceTrack[topGenres[0]] || null,
              sourceArtist: null,
              sourceGenre: GENRE_LABEL_MAP[topGenres[0]] || topGenres[0],
            };
          }
          return null;
        }));
        const clean = fallback.filter(Boolean) as any[];
        if (clean.length) finalList = clean.slice(0, 12);
      }
      if (!finalList.length && newReleases.length) {
        const altPool = newReleases.filter((it) => {
          const key = spotifyKey(it.id, it.spotifyUrl);
          return !(key && (listenedKeys.has(key) || takenTopPicks.has(key)));
        });
        finalList = altPool.slice(0, 8).map((it) => ({
          ...it,
          reason: 'Picked based on your listening.',
          score: 0,
          reasonType: 'FALLBACK',
          sourceTrack: null,
          sourceArtist: null,
          sourceGenre: undefined,
        }));
      }
      setYouMightLike(finalList.slice(0, 12));
    } catch (e) {
      setYouMightLike([]);
    }
  }, [newReleases, listenStatus, addedIds, selectedGenres, GENRE_LABEL_MAP]);

  useEffect(() => {
    buildTasteRecommendations();
  }, [buildTasteRecommendations]);

  const refreshListenStatus = useCallback(async () => {
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) { setListenStatus({}); return; }
      let { data, error } = await supabase
        .from('listen_list')
        .select('id, spotify_id, provider_id, done_at, rating, rating_details');
      if (error && ((error as any)?.code === '42703' || (error as any)?.code === 'PGRST204')) {
        const fallback = await supabase
          .from('listen_list')
          .select('id, spotify_id, provider_id, done_at, rating');
        data = fallback.data
          ? (fallback.data as any[]).map(r => ({ ...r, rating_details: null }))
          : fallback.data;
        error = fallback.error;
      }
      if (error || !data) return;
      const map: Record<string, { rating?: number | null; done?: boolean; details?: any }> = {};
      (data || []).forEach((row: any) => {
        const key = spotifyKey(row.spotify_id || row.provider_id, null);
        if (!key) return;
        map[key] = { rating: row.rating ?? null, done: !!row.done_at, details: row.rating_details ?? null };
      });
      setListenStatus(map);
      const addedFromListen: Record<string, true> = {};
      Object.keys(map).forEach(k => { addedFromListen[k] = true; });
      // Replace addedIds with the authoritative list from listen_list
      setAddedIds(addedFromListen);
    } catch {}
  }, []);

  const markAddedKey = useCallback((id?: string | null, spotifyUrl?: string | null) => {
    const key = spotifyKey(id, spotifyUrl);
    if (!key) return;
    setAddedIds(prev => ({ ...prev, [key]: true }));
    setListenStatus(prev => ({ ...prev, [key]: prev[key] || {} }));
  }, []);

  const cacheArtistImagesV2 = useCallback(async (images: Record<string, string>) => {
    const entries = Object.entries(images || {}).filter(([, url]) => !!url);
    if (!entries.length) return;
    setArtistImageMap((prev) => ({ ...prev, ...images }));
    try {
      const raw = await AsyncStorage.getItem(IMAGE_CACHE_KEY_V2);
      const existing = raw ? JSON.parse(raw) : {};
      const next = { ...(existing || {}) } as any;
      const ts = Date.now();
      for (const [id, url] of entries) next[id] = { url, ts, k: 'artist' };
      await AsyncStorage.setItem(IMAGE_CACHE_KEY_V2, JSON.stringify(next));
    } catch {}
  }, []);

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

  const cacheNewReleases = async (items: Awaited<ReturnType<typeof getNewReleases>>) => {
    try {
      await AsyncStorage.setItem(NEW_RELEASES_CACHE_KEY, JSON.stringify({ items, ts: Date.now() }));
    } catch {}
  };
  const cacheForYou = async (items: Array<{ id: string; name: string; imageUrl?: string | null; latestId?: string; latestDate?: string | null }>, key: string = FOR_YOU_CACHE_KEY) => {
    try {
      await AsyncStorage.setItem(key, JSON.stringify({ items, ts: Date.now() }));
    } catch {}
  };

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
      <Animated.View style={{ position: 'absolute', top: 0, left: 0, width: size, height: size, borderRadius, backgroundColor: colors.bg.muted, opacity }} />
    );
  };

  // Loader
  const load = useCallback(async () => {
    const NEW_RELEASE_DAYS = 42; // broaden source so fallback has more to work with
    const UPDATES_DAYS = 14;
    lastFetchRef.current = Date.now();
    try {
      const [nr, genres] = await Promise.all([getNewReleases(NEW_RELEASE_DAYS), loadIncludedGenres()]);
      setSelectedGenres(genres);
      setDraftGenres(genres.size ? new Set(genres) : new Set(['all']));
      setNewReleases(nr);
      cacheNewReleases(nr);
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
        setForYouLoading(true);
        const followed = await listFollowedArtists();
        if (!followed || followed.length === 0) {
          setFollowedDetails({});
          setRecentByArtist({});
          setForYouItems([]);
          setYourUpdatesReleases([]);
        } else {
          setForYouItems([]);
          setRecentByArtist({});
          setYourUpdatesReleases([]);
          const market = getMarket();
          const cutoffTs = Date.now() - UPDATES_DAYS * 24 * 60 * 60 * 1000;
          if (__DEV__) {
            const sample = followed.slice(0, 3).map((f) => ({ id: f.id, name: f.name }));
            console.log('[updates] followed loaded', { count: followed.length, sample, cutoff: new Date(cutoffTs).toISOString().slice(0, 10) });
          }
          const normalizeDate = (s?: string | null, precision?: string | null): string | null => {
            if (!s) return null;
            let x = String(s);
            const p = (precision || '').toLowerCase();
            if (p === 'year') x = `${x}-01-01`;
            else if (p === 'month') x = `${x}-01`;
            else if (/^\d{4}$/.test(x)) x = `${x}-07-01`;
            else if (/^\d{4}-\d{2}$/.test(x)) x = `${x}-15`;
            return x;
          };
          const isRecent = (s?: string | null, precision?: string | null) => {
            const n = normalizeDate(s, precision);
            if (!n) return false;
            const t = Date.parse(n);
            return !Number.isNaN(t) && t >= cutoffTs;
          };
          const details: Record<string, { name: string; imageUrl?: string | null }> = {};
          const recents: Record<string, { latestId?: string; latestDate?: string | null }> = {};
          const debugAsap = async () => {
            if (!__DEV__ || asapDebuggedRef.current) return;
            asapDebuggedRef.current = true;
            try {
              const fnBase = (process.env.EXPO_PUBLIC_FN_BASE ?? '') || '';
              const search = await fetch(`${fnBase}/spotify-search/artist-search?` + new URLSearchParams({ q: 'A$AP Rocky', market }));
              const sj: any = await search.json();
              const artist = sj?.artists?.items?.[0];
              const asapId = artist?.id || '';
              console.log('[updates][asap] search result', { name: artist?.name, id: asapId });
              if (!asapId) return;
              let items = await artistAlbums(asapId, 'from_token').catch(() => [] as Awaited<ReturnType<typeof artistAlbums>>);
              if (!items.length) items = await artistAlbums(asapId, 'GB').catch(() => [] as Awaited<ReturnType<typeof artistAlbums>>);
              const total = (items as any)?._total ?? null;
              console.log('[updates][asap] albums', { market, len: items.length, total, first: items.slice(0, 10).map((a) => ({ name: a.title, release_date: a.releaseDate, precision: (a as any).releaseDatePrecision, album_group: a.albumGroup })) });
              const stage_raw = Array.isArray(items) ? items.length : 0;
              const mapped = (items || []).map((a: any) => ({
                id: a.id,
                title: a.title,
                artist: a.artist,
                releaseDate: a.releaseDate ?? null,
                releaseDatePrecision: (a as any).releaseDatePrecision ?? null,
              }));
              const stage_mapped = mapped.length;
              const parsed = mapped.map((m) => {
                const norm = normalizeDate(m.releaseDate, m.releaseDatePrecision);
                const parsedDate = norm ? new Date(norm) : null;
                const isIncluded = parsedDate ? parsedDate.getTime() >= cutoffTs : false;
                return { ...m, norm, parsedDate: parsedDate?.toISOString(), isIncluded };
              });
              const stage_dateFiltered = parsed.filter((p) => p.isIncluded).length;
              const seen = new Set<string>();
              const deduped: any[] = [];
              parsed.forEach((p) => {
                const key = p.id || `${p.title}-${p.releaseDate}`;
                if (seen.has(key)) return;
                seen.add(key);
                deduped.push(p);
              });
              const stage_deduped = deduped.length;
              const finalList = deduped
                .sort((a, b) => (Date.parse(b.norm ?? '') || 0) - (Date.parse(a.norm ?? '') || 0))
                .slice(0, 10);
              console.log('[updates][asap] pipeline', {
                stage_raw,
                stage_mapped,
                stage_dateFiltered,
                stage_deduped,
                stage_final: finalList.length,
                windowStartISO: new Date(cutoffTs).toISOString(),
                samples: finalList.slice(0, 5),
              });
              if (stage_dateFiltered === 0 && parsed.length) {
                console.log('[updates][asap] parsed first 10', parsed.slice(0, 10));
              }
            } catch (err) {
              console.warn('[updates][asap] debug failed', err);
            }
          };

          await debugAsap();
          const debugPerArtist: any[] = [];
          let rateLimitHits = 0;

          // Prefer the server-side feed (triggered on follow) to avoid hammering Spotify from the client.
          const followedIds = new Set(followed.map((f) => f.id));
          const followedNames = new Set(followed.map((f) => (f.name || '').toLowerCase().trim()));
          const followedNameById = new Map<string, string>(followed.map((f) => [f.id, f.name]));
          const validFollowedIds = Array.from(followedIds).filter((id) => /^[A-Za-z0-9]{22}$/.test(id));
          let builtFromFeed = false;

          try {
            const feed = await fetchFeedForArtists({ artistIds: validFollowedIds, limit: 250 });
            const recentFeed = (feed || []).filter((it) => followedIds.has(it.artist_id) && isRecent(it.release_date, null));
            if (recentFeed.length) {
              const releases: Array<{ id: string; title: string; artist: string; artistId?: string | null; releaseDate?: string | null; spotifyUrl?: string | null; imageUrl?: string | null; type?: 'album' | 'single' | 'ep' }> = [];
              const seenRelease = new Set<string>();
              const byArtist = new Map<string, { artistId: string; artistName: string; latestId: string; latestDate: string | null }>();

              const toType = (t?: string | null): 'album' | 'single' | 'ep' | undefined => {
                const x = (t || '').toLowerCase();
                if (x === 'single') return 'single';
                if (x === 'album' || x === 'compilation') return 'album';
                return undefined;
              };

              for (const it of recentFeed) {
                const sid = spotifyKey(null, it.spotify_url ?? null);
                if (!sid) continue;
                const relKey = it.spotify_url || sid;
                if (seenRelease.has(relKey)) continue;
                seenRelease.add(relKey);

                const artistId = it.artist_id;
                const artistName = it.artist_name || followedNameById.get(artistId) || 'Unknown';
                releases.push({
                  id: sid,
                  title: it.title,
                  artist: artistName,
                  artistId,
                  releaseDate: it.release_date ?? null,
                  spotifyUrl: it.spotify_url ?? null,
                  imageUrl: it.image_url ?? it.artwork_url ?? null,
                  type: toType((it as any).release_type ?? (it as any).item_type ?? null),
                });

                const prev = byArtist.get(artistId);
                const prevTs = prev?.latestDate ? Date.parse(prev.latestDate) : 0;
                const ts = it.release_date ? Date.parse(normalizeDate(it.release_date, null) ?? '') : 0;
                if (!prev || ts > prevTs) byArtist.set(artistId, { artistId, artistName, latestId: sid, latestDate: it.release_date ?? null });
              }

              releases.sort((a, b) => (b.releaseDate ? Date.parse(b.releaseDate) : 0) - (a.releaseDate ? Date.parse(a.releaseDate) : 0));
              setYourUpdatesReleases(releases.slice(0, 60));

              const items = Array.from(byArtist.values()).map((v) => {
                const cachedImg = artistImageMapRef.current[v.artistId] ?? null;
                return { id: v.artistId, name: v.artistName, imageUrl: cachedImg, latestId: v.latestId, latestDate: v.latestDate };
              });
              items.sort((a, b) => (b.latestDate ? Date.parse(b.latestDate) : 0) - (a.latestDate ? Date.parse(a.latestDate) : 0));

              const detObj: Record<string, { name: string; imageUrl?: string | null }> = { ...details };
              const recObj: Record<string, { latestId?: string; latestDate?: string | null }> = {};
              items.forEach((it) => {
                detObj[it.id] = { name: it.name || 'Unknown', imageUrl: it.imageUrl ?? null };
                recObj[it.id] = { latestId: it.latestId, latestDate: it.latestDate ?? null };
              });

              const missing = items.filter((it) => !it.imageUrl).slice(0, 12);
              const imgUpdates: Record<string, string> = {};
              for (const m of missing) {
                try {
                  const det = await fetchArtistDetails(m.id);
                  const url = det?.imageUrl ?? null;
                  if (!url) continue;
                  if (det?.name) m.name = det.name;
                  m.imageUrl = url;
                  detObj[m.id] = { name: det?.name || m.name || 'Unknown', imageUrl: url };
                  imgUpdates[m.id] = url;
                } catch {}
              }
              await cacheArtistImagesV2(imgUpdates);

              setFollowedDetails(detObj);
              setRecentByArtist(recObj);
              setForYouItems(items);
              cacheForYou(items, FOR_YOU_UPDATES_CACHE_KEY);
              if (__DEV__) console.log('[updates] recents built (feed)', { total: items.length, releases: releases.length, cutoff: new Date(cutoffTs).toISOString().slice(0, 10) });
              builtFromFeed = true;
            }
          } catch {}

          if (builtFromFeed) {
            // Data is set; continue so listen status + loading flags update normally.
          } else {
          // Fast fallback: if we already have newReleases, pull followed-artist matches within window
          const primaryArtist = (r: any): { id?: string | null; name?: string | null } => {
            if (r.artistId || r.artist_id) return { id: r.artistId || r.artist_id, name: r.artist || r.artist_name || null };
            if (Array.isArray(r.artists) && r.artists.length) {
              return { id: r.artists[0]?.id ?? null, name: r.artists[0]?.name ?? null };
            }
            return { id: null, name: r.artist || r.artist_name || null };
          };
          const fallbackFromNr = (newReleases || []).filter((r) => {
            const { id: aid, name: aname } = primaryArtist(r);
            const idMatch = aid && followedIds.has(aid);
            const nameMatch = aname && followedNames.has(String(aname).toLowerCase().trim());
            if (!idMatch && !nameMatch) return false;
            return isRecent((r as any).releaseDate ?? (r as any).release_date, (r as any).releaseDatePrecision ?? (r as any).release_date_precision);
          });
	          if (fallbackFromNr.length) {
	            const releases = fallbackFromNr.slice(0, 60).map((r: any) => {
	              const { id: aid, name: aname } = primaryArtist(r);
	              const sid = spotifyKey(r.id, r.spotifyUrl ?? null) || String(r.id || '');
	              return {
                id: sid,
                title: r.title,
                artist: r.artist || r.artist_name || aname || 'Unknown',
                artistId: aid || null,
                releaseDate: r.releaseDate ?? r.release_date ?? null,
                spotifyUrl: r.spotifyUrl ?? null,
                imageUrl: r.imageUrl || r.image_url || null,
                type: (r.type === 'single' ? 'single' : r.type === 'album' ? 'album' : undefined) as any,
              };
            }).filter((x: any) => !!x.id);
            setYourUpdatesReleases(releases);
            const items = fallbackFromNr.slice(0, 12).map((r: any) => {
              const aid = r.artistId || r.artist_id || (Array.isArray(r.artists) ? r.artists?.[0]?.id : null);
              return {
                id: aid || r.id,
                name: r.artist || r.artist_name || details[aid]?.name || 'Unknown',
                imageUrl: r.imageUrl || r.image_url || null,
                latestId: r.id,
                latestDate: r.releaseDate ?? r.release_date ?? null,
              };
            });
            items.sort((a,b) => {
              const ta = a.latestDate ? Date.parse(a.latestDate) : 0;
              const tb = b.latestDate ? Date.parse(b.latestDate) : 0;
              return tb - ta;
            });
            const recObj: Record<string, { latestId?: string; latestDate?: string | null }> = {};
            const detObj: Record<string, { name: string; imageUrl?: string | null }> = { ...details };
            items.forEach((it) => {
              if (it.id) {
                recObj[it.id] = { latestId: it.latestId, latestDate: it.latestDate ?? null };
                detObj[it.id] = { name: it.name || 'Unknown', imageUrl: it.imageUrl ?? null };
              }
            });
            setFollowedDetails(detObj);
            setRecentByArtist(recObj);
            setForYouItems(items);
            cacheForYou(items, FOR_YOU_UPDATES_CACHE_KEY);
            if (__DEV__) console.log('[updates] recents built (fallback new releases)', { total: items.length, cutoff: new Date(cutoffTs).toISOString().slice(0,10) });
          } else {
            for (const fa of followed) {
              const id = fa.id;
            // details (name/photo)
            try {
              const det = await fetchArtistDetails(id);
              if (det) details[id] = { name: det.name || fa.name, imageUrl: det.imageUrl ?? null };
              else details[id] = { name: fa.name, imageUrl: null };
            } catch { details[id] = { name: fa.name, imageUrl: null }; }
            // albums and recent pick
            try {
              let albs: Awaited<ReturnType<typeof artistAlbums>> = [];
              const hasToken = !!process.env.EXPO_PUBLIC_SPOTIFY_TOKEN;
              const mkts = hasToken ? ['from_token', market || 'GB'] : [market || 'GB'];
              for (const mk of mkts) {
                try {
                  const url = `https://api.spotify.com/v1/artists/${id}/albums?` + new URLSearchParams({ include_groups: 'album,single,appears_on', market: mk, limit: '50' });
                  const attempt = async () => artistAlbums(id, mk);
                  try {
                    albs = await attempt();
                  } catch (err: any) {
                    const msg = String(err || '').toLowerCase();
                    if (msg.includes('rate')) {
                      rateLimitHits += 1;
                      if (rateLimitHits >= 3) break;
                      await new Promise((res) => setTimeout(res, 800));
                      albs = await attempt();
                    } else {
                      throw err;
                    }
                  }
                  if (__DEV__) {
                    const newest = albs?.[0];
                    console.log('[updates] artist albums', {
                      artist: fa.name,
                      id,
                      url,
                      market: mk,
                      count: albs?.length ?? 0,
                      total: (albs as any)?._total ?? null,
                      newest: newest ? { name: newest.title, date: newest.releaseDate, prec: (newest as any).releaseDatePrecision, group: newest.albumGroup } : null,
                    });
                  }
                  if (albs?.length) break;
                  if (rateLimitHits >= 3) break;
                } catch (err) {
                  console.log('[updates] artist albums ERROR', { artist: fa.name, id, market: mk, message: String(err) });
                }
              }
              if (rateLimitHits >= 3) break;
              const normDateVal = (d?: string | null, p?: string | null) => Date.parse(normalizeDate(d, p) ?? '1970-01-01');
              const recent = (albs || []).filter(a => isRecent(a.releaseDate, (a as any).releaseDatePrecision));
              if (__DEV__) {
                debugPerArtist.push({
                  artist: fa.name,
                  id,
                  total: (albs as any)?._total ?? null,
                  pulled: albs?.length ?? 0,
                  recent: recent.length,
                  firstDates: (albs || []).slice(0, 3).map(a => ({ date: a.releaseDate, prec: (a as any).releaseDatePrecision, group: a.albumGroup })),
                });
              }
              if (recent.length) {
                recent.sort((a,b) => normDateVal(b.releaseDate, (b as any).releaseDatePrecision) - normDateVal(a.releaseDate, (a as any).releaseDatePrecision));
                recents[id] = { latestId: recent[0].id, latestDate: recent[0].releaseDate ?? null };
              }
            } catch (err) {
              console.log('[updates] artist albums ERROR', { artist: fa.name, id, message: String(err) });
            }
              await new Promise((res) => setTimeout(res, 250));
          }
            setFollowedDetails(details);
            setRecentByArtist(recents);
            const items = Object.keys(recents || {}).map((id) => ({
              id,
              name: (details[id]?.name) ?? 'Unknown',
              imageUrl: details[id]?.imageUrl ?? null,
              latestId: recents[id]?.latestId,
              latestDate: recents[id]?.latestDate ?? null,
            }));
            items.sort((a,b) => {
              const ta = a.latestDate ? Date.parse(a.latestDate) : 0;
              const tb = b.latestDate ? Date.parse(b.latestDate) : 0;
              return tb - ta;
            });
            if (items.length) {
              setForYouItems(items);
              cacheForYou(items, FOR_YOU_UPDATES_CACHE_KEY);
            }
            if (__DEV__) {
              const sample = items.slice(0, 3);
              console.log('[updates] recents built', { total: items.length, sample, cutoff: new Date(cutoffTs).toISOString().slice(0,10), artistsDebug: debugPerArtist.slice(0,5) });
            }
            if (!items.length) {
              setForYouItems([]);
            }
          }
          }
        }
      } catch {}
      finally { setPickedLoading(false); setForYouLoading(false); }
      await refreshListenStatus();
    } catch {}
    finally {
      setInitialLoading(false);
    }
  }, [refreshListenStatus]);

  useEffect(() => {
    const handler = () => { load(); };
    on('feed:refresh', handler);
    return () => off('feed:refresh', handler);
  }, [load]);

  // Initial load with cache hydration
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(NEW_RELEASES_CACHE_KEY);
        if (raw && mounted) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed?.items)) {
            setNewReleases(parsed.items);
            setInitialLoading(false);
          }
        }
      } catch {}
      try {
        const rawFy = await AsyncStorage.getItem(FOR_YOU_UPDATES_CACHE_KEY);
        if (rawFy && mounted) {
          const parsed = JSON.parse(rawFy);
          const items = Array.isArray(parsed?.items) ? parsed.items : [];
          const ts = typeof parsed?.ts === 'number' ? parsed.ts : 0;
          const HOUR_MS = 60 * 60 * 1000;
          if (items.length && (Date.now() - ts) < 6 * HOUR_MS) {
            setForYouItems(items);
            const detObj: Record<string, { name: string; imageUrl?: string | null }> = {};
            const recObj: Record<string, { latestId?: string; latestDate?: string | null }> = {};
            items.forEach((it: any) => {
              if (!it?.id) return;
              detObj[it.id] = { name: it.name || 'Unknown', imageUrl: it.imageUrl ?? null };
              recObj[it.id] = { latestId: it.latestId, latestDate: it.latestDate ?? null };
            });
            setFollowedDetails(detObj);
            setRecentByArtist(recObj);
            setForYouLoading(false);
          }
        }
      } catch {}
      if (mounted) await load();
    })();
    return () => { mounted = false; };
  }, [load]);

  // Refresh when coming back online
  useEffect(() => {
    if (!offline) load();
  }, [offline, load]);

  // Refresh on focus with 30s throttle
  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      if (now - lastFetchRef.current > 30_000) {
        load();
      }
    }, [load])
  );

  // Also refresh when the tab icon is tapped (even if already focused)
  useEffect(() => {
    const unsub = (navigation as any).addListener('tabPress', () => { load(); });
    return unsub;
  }, [navigation, load]);

  // No genre management in simplified view

  // Refresh upcoming when tab refocuses (e.g., after adding presaves elsewhere)
  useFocusEffect(useCallback(() => {
    load();
  }, [load]));

  // Also refresh when app returns to foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') load(); });
    return () => sub.remove();
  }, [load]);

  // No extra image fetching; bubbles use details fetched during load()

  const onRefresh = useCallback(async () => {
    if (offline) {
      Alert.alert('Offline', 'You are offline. Showing cached results.');
      setRefreshing(false);
      return;
    }
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load, offline]);

  const runSearch = useCallback(async (term: string) => {
    if (!term) { setSearchRows([]); setArtist(null); setArtistAlbumsRows([]); setArtistTracksRows([]); return; }
    setBusy(true);
    try {
      const direct = parseSpotifyUrlOrId(term);
      if (direct) {
        const one = await spotifyLookup(direct.id, direct.lookupType);
        setArtist(null); setArtistAlbumsRows([]); setArtistTracksRows([]); setSearchRows(one);
        return;
      }
      // eslint-disable-next-line no-console
      console.log('[discover search:req]', { q: term, calls: ['spotifySearch artist', 'spotifySearch track', 'spotifySearch album'] });
      const [artistsOnly, tracksOnly, albumsOnly] = await Promise.all([
        spotifySearch(term, 'artist'),
        spotifySearch(term, 'track'),
        spotifySearch(term, 'album'),
      ]);
      const results = [...(tracksOnly || []), ...(albumsOnly || []), ...(artistsOnly || [])];
      // Temporary debug to see returned counts
      // eslint-disable-next-line no-console
      console.log('[discover search]', {
        artists: results.filter(r => r.type === 'artist').length,
        projects: results.filter(r => r.type === 'album' || (r as any).albumType === 'single').length,
        tracks: results.filter(r => r.type === 'track').length,
      });

      setArtist(null); setArtistAlbumsRows([]); setArtistTracksRows([]);
      setSearchRows(results || []);
    } finally {
      setBusy(false);
    }
  }, []);

  // Debounced global search when typing
  useEffect(() => {
    const term = q.trim();
    if (debounceTimer) clearTimeout(debounceTimer);
    if (term.length < 2) { setSearchRows([]); setArtist(null); setArtistAlbumsRows([]); setArtistTracksRows([]); return; }
    const t = setTimeout(async () => {
      await runSearch(term);
    }, 300);
    setDebounceTimer(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, runSearch]);

  const onSearch = async () => {
    await runSearch(q.trim());
  };

  const onAddNew = async (a: { id: string; title: string; artist: string; releaseDate?: string | null; spotifyUrl?: string | null; imageUrl?: string | null; type?: string | null }, stat?: { done?: boolean | undefined }) => {
    const key = spotifyKey(a.id, a.spotifyUrl);
    if (stat?.done && key) {
      // If previously listened, mark it active again before adding so the unique row can be reused
      await markDoneByProvider({ provider: 'spotify', provider_id: key, makeDone: false });
      setListenStatus(prev => ({ ...prev, [key]: { ...(prev[key] || {}), done: false } }));
    }
    const inferredFromUrl =
      (a.spotifyUrl && /open\.spotify\.com\/album\//.test(a.spotifyUrl)) ? 'album' :
      (a.spotifyUrl && /open\.spotify\.com\/track\//.test(a.spotifyUrl)) ? 'track' :
      null;
    const itemType: 'track' | 'album' | 'single' =
      (a.type === 'album' || a.type === 'single') ? a.type :
      (a.type === 'ep') ? 'album' :
      (inferredFromUrl === 'album' ? 'album' : 'track');
    const res = await addToListFromSearch({
      type: itemType,
      title: a.title,
      artist: a.artist,
      releaseDate: a.releaseDate ?? null,
      spotifyUrl: a.spotifyUrl ?? null,
      appleUrl: null,
      imageUrl: a.imageUrl ?? null,
    });
    if (!res.ok) { H.error(); Alert.alert(res.message || 'Could not save'); return; }
    H.success();
    if (key && res.row) {
      setListenStatus(prev => ({ ...prev, [key]: { rating: res.row.rating ?? null, done: !!res.row.done_at, details: res.row.rating_details ?? null } }));
    }
    markAddedKey(a.id, a.spotifyUrl);
    if (res.message === 'Already on your list') await refreshListenStatus();
  };

  const onSaveSearch = async (r: SpotifyResult, stat?: { done?: boolean | undefined }) => {
    if (r.type === 'artist') { Alert.alert('Pick a track or album to save'); return; }
    const listenKey = spotifyKey(r.id, r.spotifyUrl);
    if (stat?.done && listenKey) {
      await markDoneByProvider({ provider: 'spotify', provider_id: listenKey, makeDone: false });
      setListenStatus(prev => ({ ...prev, [listenKey]: { ...(prev[listenKey] || {}), done: false } }));
    }
    const res = await addToListFromSearch({
      type: r.type === 'album' ? 'album' : 'track',
      title: r.title,
      artist: r.artist ?? null,
      releaseDate: r.releaseDate ?? null,
      spotifyUrl: r.spotifyUrl ?? null,
      appleUrl: null,
      imageUrl: r.imageUrl ?? null,
    });
    if (!res.ok) { H.error(); Alert.alert(res.message || 'Could not save'); return; }
    H.success();
    const newKey = spotifyKey(r.id, r.spotifyUrl);
    if (newKey && res.row) {
      setListenStatus(prev => ({ ...prev, [newKey]: { rating: res.row.rating ?? null, done: !!res.row.done_at, details: res.row.rating_details ?? null } }));
    }
    markAddedKey(r.id, r.spotifyUrl);
    if (res.message === 'Already on your list') await refreshListenStatus();
  };

  // Build rows: carousel (Latest) shows first N; list shows remainder labeled 'More new releases'
  const today = new Date().toISOString().slice(0, 10);
  const normalize = (s: string) => s
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const matchScore = (name: string, query: string) => {
    const n = normalize(name);
    const qn = normalize(query);
    if (!n || !qn) return 0;
    if (n === qn) return 100;
    if (n.startsWith(qn)) return 85;
    const qWords = qn.split(' ');
    const nWords = n.split(' ');
    const allWords = qWords.every(w => nWords.includes(w));
    if (allWords) return 70;
    if (n.includes(qn)) return 60;
    const partialMatches = qWords.filter(w => nWords.some(nw => nw.includes(w) || w.includes(nw)));
    const ratio = partialMatches.length / qWords.length;
    if (ratio > 0) {
      return Math.round(40 + Math.min(15, ratio * 15));
    }
    return 0;
  };

  // Derived, relevance-sorted search results with optional filter
  const groupedSearch = useMemo(() => {
    const byRelevance = (items: SpotifyResult[]) => {
      const scored = items.map(r => {
        const label = r.title || r.artist || '';
        return { r, score: matchScore(label, q) };
      });
      scored.sort((a, b) => (b.score - a.score) || ((b.r.popularity || 0) - (a.r.popularity || 0)));
      return scored.map(s => s.r);
    };

    const projects = byRelevance(searchRows.filter(r => r.type === 'album' || (r as any).albumType === 'single' || (r as any).type === 'single')).slice(0, 5);
    const tracks = byRelevance(searchRows.filter(r => r.type === 'track')).slice(0, 5);
    const artistsOnly = byRelevance(searchRows.filter(r => r.type === 'artist')).slice(0, 5);
    return {
      projects,
      tracks,
      artists: artistsOnly,
    };
  }, [searchRows, q]);

  const rankSections = (query: string, sections: { artists: SpotifyResult[]; tracks: SpotifyResult[]; projects: SpotifyResult[] }) => {
    const qn = normalize(query);
    const qWords = qn ? qn.split(' ') : [];
    const baseOrder: Array<keyof typeof sections> = ['tracks', 'projects', 'artists'];
    if (!qn) return baseOrder;

    const scoreSection = (items: SpotifyResult[], type: 'artists' | 'tracks' | 'projects') => {
      const topN = items.slice(0, 10);
      const scores = topN.map((r, idx) => {
        const label = r.title || r.artist || '';
        const score = matchScore(label, query);
        const rankBonus = idx < 3 && score >= 85 ? 8 : 0;
        return { score, rankBonus };
      });
      const topScore = scores.reduce((m, s) => Math.max(m, s.score), 0);
      const topHitRankBonus = scores.some(s => s.rankBonus > 0) ? 8 : 0;
      const countBonus = Math.min(items.length, 20) * 0.3;
      let shapeBonus = 0;
      if (qWords.length === 1 && type === 'artists') shapeBonus = 10;
      if (qWords.length >= 3 && type === 'tracks') shapeBonus = 10;
      if (qWords.length >= 3 && type === 'projects') shapeBonus = 6;
      return { topScore, topHitRankBonus, countBonus, shapeBonus, final: topScore + topHitRankBonus + countBonus + shapeBonus };
    };

    const scores = {
      artists: scoreSection(sections.artists, 'artists'),
      tracks: scoreSection(sections.tracks, 'tracks'),
      projects: scoreSection(sections.projects, 'projects'),
    };

    const order = (Object.keys(scores) as Array<keyof typeof scores>).sort((a, b) => scores[b].final - scores[a].final);
    const [first, second] = order;
    const diff = scores[first].final - scores[second].final;
    const finalOrder = diff >= 12 ? order : baseOrder;

    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('[discover rank]', {
        query,
        scores,
        order: finalOrder,
      });
    }

    return finalOrder;
  };

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log('[discover dropdown sections]', {
      artists: groupedSearch.artists.length,
      tracks: groupedSearch.tracks.length,
      projects: groupedSearch.projects.length,
    });
  }, [groupedSearch.artists.length, groupedSearch.tracks.length, groupedSearch.projects.length]);

  const clearSearch = () => {
    setQ('');
    setSearchRows([]);
    setArtist(null);
    setArtistAlbumsRows([]);
    setArtistTracksRows([]);
  };

  const hasGrouped = groupedSearch.projects.length || groupedSearch.tracks.length || groupedSearch.artists.length;

  const sectionOrder = rankSections(q, {
    artists: groupedSearch.artists,
    tracks: groupedSearch.tracks,
    projects: groupedSearch.projects,
  });

  type SearchSection = { title: string; key: 'artists' | 'tracks' | 'projects'; data: SpotifyResult[] };
  const groupedSections = useMemo<SearchSection[]>(() => {
    if (!hasGrouped) return [];
    const out: SearchSection[] = [];
    sectionOrder.forEach((section) => {
      if (section === 'tracks' && groupedSearch.tracks.length) out.push({ title: 'Tracks', key: 'tracks', data: groupedSearch.tracks });
      if (section === 'projects' && groupedSearch.projects.length) out.push({ title: 'Projects', key: 'projects', data: groupedSearch.projects });
      if (section === 'artists' && groupedSearch.artists.length) out.push({ title: 'Artists', key: 'artists', data: groupedSearch.artists });
    });
    return out;
  }, [groupedSearch, sectionOrder, hasGrouped]);

  // Build rows for FlatList (fallback view when there is no grouped search)
  const rows: Row[] = [];

  if (!hasGrouped) {
    // Artist header with Follow action
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
  }

  const statusFor = (id?: string | null, spotifyUrl?: string | null) => {
    const key = spotifyKey(id, spotifyUrl);
    return key ? listenStatus[key] : undefined;
  };

  const offlineBanner = offline ? (
    <View style={{ padding: 8, backgroundColor: accentSoft, borderRadius: 10, borderWidth: 1, borderColor: colors.accent.primary, marginBottom: 10 }}>
      <Text style={{ color: colors.accent.primary, fontWeight: '700', textAlign: 'center' }}>You’re offline — showing saved results</Text>
    </View>
  ) : null;

  if (initialLoading && !newReleases.length && !fallbackFeed.length) {
    return (
      <Screen>
        {offlineBanner}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <ActivityIndicator size="large" />
          <Text style={{ marginTop: 12, color: colors.text.muted }}>Loading Discover…</Text>
        </View>
      </Screen>
    );
  }

  const isAddedFor = (id?: string | null, spotifyUrl?: string | null) => {
    const key = spotifyKey(id, spotifyUrl);
    return key ? !!addedIds[key] : false;
  };

  const renderStatusBlock = (stat?: { rating?: number | null; done?: boolean; details?: any }, compact = false, alignStart = false) => {
    if (!stat) return null;
    const rated = typeof stat.rating === 'number' && !Number.isNaN(stat.rating);
    const overallDetail = (() => {
      if (!stat.details) return null;
      const o = (stat.details as any).overall ?? (stat.details as any).overall_rating ?? (stat.details as any).overall_score;
      if (o == null) return null;
      const n = Number(o);
      return Number.isFinite(n) ? n : null;
    })();
    const derivedDetail = (() => {
      if (!stat.details) return null;
      const vals = Object.values(stat.details as Record<string, number>).map(v => Number(v)).filter(v => Number.isFinite(v));
      if (!vals.length) return null;
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      return Math.round(avg * 10) / 10;
    })();
    const ratingValue = (() => {
      if (overallDetail != null) return overallDetail;
      if (rated) return Number(stat.rating);
      return derivedDetail;
    })();
    const listened = !!stat.done;
    return (
      <View style={{ gap: 2, alignItems: alignStart ? 'flex-start' : 'flex-end', alignSelf: alignStart ? 'flex-start' : 'auto' }}>
        {ratingValue ? (
          <View style={{
            backgroundColor: accentSoft,
            paddingHorizontal: compact ? 8 : 10,
            paddingVertical: compact ? 4 : 6,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: colors.accent.primary,
          }}>
            <Text style={{ fontWeight: '800', color: colors.text.secondary, fontSize: 12 }}>
              ★ {Math.round(Number(ratingValue))}
            </Text>
          </View>
        ) : null}
        {listened ? (
          <View style={{
            backgroundColor: successSoft,
            paddingHorizontal: compact ? 8 : 10,
            paddingVertical: compact ? 4 : 6,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: colors.accent.success,
          }}>
            <Text style={{ fontWeight: '700', color: colors.accent.success, fontSize: 12 }}>Listened</Text>
          </View>
        ) : null}
      </View>
    );
  };
  const handleMenuChanged = async (update?: { type: 'mark' | 'remove' | 'rate'; row: any; done?: boolean }) => {
    if (update?.type === 'remove' && update.row) {
      const key = spotifyKey((update.row as any).spotify_id || (update.row as any).provider_id || (update.row as any).id || null, (update.row as any).spotify_url || null);
      if (key) {
        setAddedIds((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        setListenStatus((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
    }
    if (update?.type === 'mark' && update.row) {
      const key = spotifyKey((update.row as any).spotify_id || (update.row as any).provider_id || (update.row as any).id || null, (update.row as any).spotify_url || null);
      if (key) {
        const done = update.done === true;
        setAddedIds((prev) => ({ ...prev, [key]: true }));
        setListenStatus((prev) => ({ ...prev, [key]: { rating: (update.row as any).rating ?? null, done, details: (update.row as any).rating_details ?? null } }));
      }
    }
    if (update?.type === 'rate' && update.row) {
      const key = spotifyKey((update.row as any).spotify_id || (update.row as any).provider_id || (update.row as any).id || null, (update.row as any).spotify_url || null);
      if (key) {
        setAddedIds((prev) => ({ ...prev, [key]: true }));
        setListenStatus((prev) => ({ ...prev, [key]: { ...(prev[key] || {}), rating: (update.row as any).rating ?? null, details: (update.row as any).rating_details ?? null } }));
      }
    }
    await refreshListenStatus();
    await load();
  };

  const tagLabel = (stat: { rating?: number | null; done?: boolean } | undefined, isAdded: boolean) => {
    if (stat?.done) return 'Add again';
    return isAdded ? 'Added' : 'Save';
  };

  const renderSearchRow = (r: SpotifyResult) => {
    const presave = !!(r.releaseDate && r.releaseDate > today);
    const typeLabel = r.type === 'album' ? 'Album' : r.type === 'track' ? 'Track' : 'Artist';
    const stat = statusFor(r.id, r.spotifyUrl);
    const isAdded = isAddedFor(r.id, r.spotifyUrl) || !!stat;
    const label = tagLabel(stat, isAdded);
    const artUrl = r.imageUrl || artistImageMap[r.id] || null;
    return (
      <GlassCard asChild style={{ marginVertical: 4, padding: 0 }}>
        <View style={{ paddingVertical: 10, paddingHorizontal: 6, opacity: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            {(() => {
              const thumb = artUrl ? (
                <Image source={{ uri: artUrl }} style={{ width: 60, height: 60, borderRadius: 12, backgroundColor: colors.bg.muted }} />
              ) : (
                <View style={{ width: 60, height: 60, borderRadius: 12, backgroundColor: colors.bg.muted, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: colors.text.muted, fontWeight: '800' }}>{(r.title || '?').slice(0,1)}</Text>
                </View>
              );
              if (r.type !== 'artist') return thumb;
              return (
                <Pressable
                  onPress={() => openArtist(r.id, { name: r.title })}
                  hitSlop={10}
                  style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}
                >
                  {thumb}
                </Pressable>
              );
            })()}
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={{ fontSize: 16, fontWeight: '500', color: colors.text.secondary }} numberOfLines={1}>{r.title}</Text>
              <Text style={{ color: colors.text.muted, marginTop: 2 }} numberOfLines={1}>{r.artist ?? typeLabel}</Text>
              {!!r.releaseDate && (
                <Text style={{ color: presave ? colors.accent.success : colors.text.muted, marginTop: 2 }}>
                  {presave ? `Presave · ${formatDate(r.releaseDate)}` : `Released · ${formatDate(r.releaseDate)}`}
                </Text>
              )}
            </View>
            {r.type === 'artist' ? (
              <View style={{ alignItems: 'flex-end' }}>
                <FollowButton artistId={r.id} artistName={r.title} />
              </View>
            ) : (
              <View style={{ alignItems: 'flex-end' }}>
                {renderStatusBlock(stat)}
                <Pressable onPress={() => onSaveSearch(r, stat)} disabled={stat?.done ? false : isAdded} hitSlop={8} style={{ marginTop: 4 }}>
                  <Text style={{ color: colors.accent.success, fontWeight: '700' }}>
                    {label}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setMenuRow({ ...r, artist_id: r.artistId ?? null, in_list: isAdded, done_at: stat?.done ? new Date().toISOString() : null } as any)}
                  hitSlop={8}
                  style={{ paddingHorizontal: 6, paddingVertical: 6 }}
                >
                  <Text style={{ fontSize: 18, color: colors.text.muted }}>⋯</Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>
      </GlassCard>
    );
  };

  const renderItem = ({ item }: { item: Row }) => {
    if (item.kind === 'section-title') {
      return (
        <Text style={{ fontSize: 18, fontWeight: '600', marginTop: 16, marginBottom: 8, color: colors.text.secondary }}>{item.title}</Text>
      );
    }
  if (item.kind === 'new') {
  const presave = !!(item.releaseDate && item.releaseDate > today);
  const stat = statusFor(item.id, item.spotifyUrl);
  const isAdded = isAddedFor(item.id, item.spotifyUrl) || !!stat;
  const label = tagLabel(stat, isAdded);
    return (
      <GlassCard asChild style={{ marginVertical: 4, padding: 0, opacity: isAdded ? 0.82 : 1 }}>
        <View style={{ paddingVertical: 10, paddingHorizontal: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Image source={{ uri: item.imageUrl ?? undefined }} style={{ width: 60, height: 60, borderRadius: 12, backgroundColor: colors.bg.muted }} />
            <View style={{ flex: 1, paddingRight: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontSize: 16, fontWeight: '500', flexShrink: 1, color: colors.text.secondary }} numberOfLines={1}>{item.title}</Text>
                {!!item.type && (
                  <Text style={{ fontSize: 10, fontWeight: '800', color: colors.accent.primary, backgroundColor: accentSoft, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                    {item.type.toUpperCase()}
                  </Text>
                )}
              </View>
              <Text style={{ color: colors.text.muted, marginTop: 2 }} numberOfLines={1}>{item.artist}</Text>
              {!!item.releaseDate && (
                <Text style={{ color: presave ? colors.accent.success : colors.text.muted, marginTop: 2 }}>
                  {presave ? `Presave · ${formatDate(item.releaseDate)}` : `Released · ${formatDate(item.releaseDate)}`}
                </Text>
              )}
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              {renderStatusBlock(stat)}
              <Pressable onPress={() => onAddNew(item, stat)} disabled={stat?.done ? false : isAdded} hitSlop={8} style={{ marginTop: 4 }}>
                <Text style={{ color: colors.accent.success, fontWeight: '700' }}>
                  {label}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setMenuRow({ ...item, in_list: isAdded, done_at: stat?.done ? new Date().toISOString() : null } as any)}
                hitSlop={8}
                style={{ paddingHorizontal: 6, paddingVertical: 6 }}
              >
                <Text style={{ fontSize: 18, color: colors.text.muted }}>⋯</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </GlassCard>
    );
    }
  // Upcoming removed
    // search result (fallback)
    return renderSearchRow(item.r);
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
    <View key={`discover-releases-${viewMode}`} style={{ marginTop: 8 }}>
      {(() => {
        const pad = 16;
        const renderUpdatesRow = (items: Array<{ id: string; name: string; imageUrl?: string | null; latestId?: string; latestDate?: string | null }>) => {
          return (
            <View style={{ paddingTop: 8, paddingBottom: 10 }}>
              <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text.secondary, marginBottom: 10, paddingHorizontal: pad, alignSelf: 'stretch', textAlign: 'left' }}>
                Your updates
              </Text>
              <FlatList
                data={items.slice(0, 16)}
                keyExtractor={(it) => `updates-artist-${it.id}`}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 6, columnGap: 12 }}
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => openArtist(item.id, { name: item.name, highlight: item.latestId ?? null })}
                    hitSlop={8}
                    style={({ pressed }) => ({ width: 74, alignItems: 'center', opacity: pressed ? 0.9 : 1 })}
                  >
                    <View style={{ width: 58, height: 58, borderRadius: 29, backgroundColor: colors.bg.muted, overflow: 'hidden', borderWidth: 1, borderColor: colors.text.secondary + '22' }}>
                      {item.imageUrl ? (
                        <Image source={{ uri: item.imageUrl }} style={{ width: 58, height: 58 }} />
                      ) : (
                        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ color: colors.text.muted, fontWeight: '800' }}>{(item.name || '?').slice(0, 1).toUpperCase()}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={{ marginTop: 6, fontSize: 11, color: colors.text.secondary, opacity: 0.95 }} numberOfLines={1}>
                      {item.name || 'Unknown'}
                    </Text>
                  </Pressable>
                )}
              />
            </View>
          );
        };

        const renderEmptySpotlight = () => {
          const screenWidth = Dimensions.get('window').width;
          const cardW = Math.min(screenWidth * 0.92, 360);
          return (
            <View style={{ paddingTop: 8, paddingBottom: 18, alignItems: 'stretch' }}>
              <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text.secondary, marginBottom: 12, paddingHorizontal: pad, alignSelf: 'stretch', textAlign: 'left' }}>
                Your updates
              </Text>
              <GlassCard style={{ width: cardW, padding: 16, borderRadius: 20, borderWidth: 1, borderColor: colors.text.secondary + '14', gap: 12, alignSelf: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.bg.muted, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="notifications-outline" size={20} color={colors.text.secondary} />
                  </View>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={{ fontSize: 16.5, fontWeight: '600', color: colors.text.secondary }} numberOfLines={1}>No new releases this week</Text>
                    <Text style={{ fontSize: 13, color: colors.text.muted, opacity: 0.8 }} numberOfLines={2}>Follow more artists to fill this up.</Text>
                  </View>
                  <Pressable
                    onPress={() => router.push('/discover')}
                    style={({ pressed }) => ({
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderRadius: 999,
                      backgroundColor: colors.bg.muted,
                      opacity: pressed ? 0.9 : 1,
                    })}
                  >
                    <Text style={{ color: colors.text.secondary, fontWeight: '700', fontSize: 12 }}>Browse</Text>
                  </Pressable>
                </View>
              </GlassCard>
            </View>
          );
        };

        if (pickedLoading || forYouLoading) {
          const placeholders = Array.from({ length: 3 }).map((_, i) => ({ id: `ph-${i}` }));
          return (
            <View style={{ paddingTop: 8, paddingBottom: 10 }}>
              <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text.secondary, marginBottom: 12, paddingHorizontal: pad, alignSelf: 'stretch', textAlign: 'left' }}>
                Your updates
              </Text>
              <FlatList
                data={placeholders}
                keyExtractor={(it) => it.id}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 6, columnGap: 12 }}
                renderItem={() => (
                  <View style={{ width: 74, alignItems: 'center' }}>
                    <View style={{ width: 58, height: 58, borderRadius: 29, backgroundColor: colors.bg.muted, overflow: 'hidden' }}>
                      <Shimmer size={58} borderRadius={29} />
                    </View>
                    <View style={{ width: 54, height: 10, marginTop: 8, borderRadius: 6, backgroundColor: colors.bg.muted, overflow: 'hidden' }}>
                      <Animated.View style={{ width: 54, height: 10, backgroundColor: colors.bg.muted }} />
                    </View>
                  </View>
                )}
              />
            </View>
          );
        }

        const fallbackItems = Object.keys(recentByArtist || {}).map((id) => {
          const det = followedDetails[id] || { name: 'Unknown', imageUrl: null };
          const rec = recentByArtist[id] || {} as { latestId?: string; latestDate?: string | null };
          return { id, name: det.name, imageUrl: det.imageUrl ?? null, latestId: rec.latestId, latestDate: rec.latestDate ?? null };
        });
        const base = (forYouItems && forYouItems.length ? forYouItems : fallbackItems) as Array<{ id: string; name: string; imageUrl?: string | null; latestId?: string; latestDate?: string | null }>;
        const uniq = new Map<string, { id: string; name: string; imageUrl?: string | null; latestId?: string; latestDate?: string | null }>();
        base.forEach((it) => {
          if (!it?.latestId) return;
          if (!it?.id || !/^[A-Za-z0-9]{22}$/.test(String(it.id))) return;
          if (!uniq.has(it.id)) uniq.set(it.id, it);
        });
        const sorted = Array.from(uniq.values()).sort((a, b) => {
          const ta = a.latestDate ? Date.parse(a.latestDate) : 0;
          const tb = b.latestDate ? Date.parse(b.latestDate) : 0;
          return tb - ta;
        });
        if (!sorted.length) return renderEmptySpotlight();
        return renderUpdatesRow(sorted);
      })()}
      <Animated.View
        style={{
          opacity: viewAnim,
          transform: [
            {
              translateY: viewAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [8, 0],
              }),
            },
          ],
        }}
      >
      {(() => {
        const screenWidth = Dimensions.get('window').width;
        const horizontalPad = 16;
        const gap = 14;
        const cardWidth = Math.floor((screenWidth - horizontalPad * 2) * 0.86);
        const columnGap = 10;
        const rowsPerPage = screenWidth >= 420 ? 4 : 3;
        const imageSize = 52;
        const heroGap = 12;
        const heroCardWidth = Math.floor((screenWidth - horizontalPad * 2) * 0.92);
        const heroCardHeight = 226;

        const renderReleaseCard = (item: any) => {
          const stat = statusFor(item.id, item.spotifyUrl);
          const isAdded = isAddedFor(item.id, item.spotifyUrl) || !!stat;
          const label = tagLabel(stat, isAdded);
          const artistId = item.artistId || item.artist_id || null;
          const openRelease = () => {
            const url = item.spotifyUrl || item.spotify_url || null;
            if (url) {
              Linking.openURL(String(url)).catch(() => {});
              return;
            }
            setMenuRow({ ...item, artist_id: artistId, in_list: isAdded, done_at: stat?.done ? new Date().toISOString() : null } as any);
          };
          return (
            <GlassCard
              key={item.id || item.title}
              asChild
              style={{
                width: '100%',
                padding: 0,
                borderRadius: 18,
                minHeight: 88,
              }}
            >
              <Pressable
                onPress={openRelease}
                onLongPress={() => setMenuRow({ ...item, artist_id: artistId, in_list: isAdded, done_at: stat?.done ? new Date().toISOString() : null } as any)}
                delayLongPress={RELEASE_LONG_PRESS_MS}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingHorizontal: 12,
                  paddingVertical: 12,
                  opacity: pressed ? 0.9 : 1,
                  transform: [{ scale: pressed ? 0.995 : 1 }],
                })}
              >
                <View style={{ width: imageSize, height: imageSize, borderRadius: 14, backgroundColor: colors.bg.muted, overflow: 'hidden' }}>
                  {item.imageUrl ? (
                    <Image source={{ uri: item.imageUrl }} style={{ width: imageSize, height: imageSize }} />
                  ) : (
                    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: colors.text.muted, fontWeight: '800' }}>{(item.title || '?').slice(0,1)}</Text>
                    </View>
                  )}
                </View>
                <View style={{ flex: 1, gap: 4, minWidth: 0 }}>
                  <Text style={{ fontWeight: '700', color: colors.text.secondary, lineHeight: 18 }} numberOfLines={1} ellipsizeMode="tail">
                    {item.title}
                  </Text>
                  {!!item.artist && (
                    <Text style={{ color: colors.text.muted, lineHeight: 16 }} numberOfLines={1} ellipsizeMode="tail">
                      {item.artist}
                    </Text>
                  )}
                </View>
                <View style={{ alignItems: 'flex-end', flex: 0 }}>
                  <Pressable
                    onPress={() => onAddNew({ id: item.id, title: item.title, artist: item.artist || '', releaseDate: item.releaseDate ?? null, spotifyUrl: item.spotifyUrl ?? null, imageUrl: item.imageUrl ?? null, type: item.type ?? null })}
                    disabled={isAdded}
                    hitSlop={8}
                  >
                    <Text style={{ color: colors.accent.success, fontWeight: '700', opacity: isAdded ? 0.6 : 1, fontSize: 12 }}>{label}</Text>
                  </Pressable>
                  {renderStatusBlock(stat, true, true)}
                </View>
              </Pressable>
            </GlassCard>
          );
        };

        const renderHeroCard = (item: any) => {
          const stat = statusFor(item.id, item.spotifyUrl);
          const isAdded = isAddedFor(item.id, item.spotifyUrl) || !!stat;
          const artistId = item.artistId || item.artist_id || null;

          const openRelease = () => {
            const url = item.spotifyUrl || item.spotify_url || null;
            if (url) {
              Linking.openURL(String(url)).catch(() => {});
              return;
            }
            setMenuRow({ ...item, artist_id: artistId, in_list: isAdded, done_at: stat?.done ? new Date().toISOString() : null } as any);
          };

          return (
            <HeroReleaseCard
              title={item.title}
              artist={item.artist || null}
              imageUrl={item.imageUrl || null}
              releaseDate={item.releaseDate ?? null}
              saved={isAdded}
              width={heroCardWidth}
              height={heroCardHeight}
              onPress={openRelease}
              onLongPress={() => setMenuRow({ ...item, artist_id: artistId, in_list: isAdded, done_at: stat?.done ? new Date().toISOString() : null } as any)}
              delayLongPress={RELEASE_LONG_PRESS_MS}
              onSave={() =>
                onAddNew(
                  {
                    id: item.id,
                    title: item.title,
                    artist: item.artist || '',
                    releaseDate: item.releaseDate ?? null,
                    spotifyUrl: item.spotifyUrl ?? null,
                    imageUrl: item.imageUrl ?? null,
                    type: item.type ?? null,
                  },
                  stat
                )
              }
            />
          );
        };

        const chunk = (arr: any[], size: number) => {
          const out: any[][] = [];
          for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
          return out;
        };

        const renderPillColumns = (data: any[], key: string) => {
          const pages = chunk(data.slice(0, 120), rowsPerPage);
          return (
            <FlatList
              data={pages}
              keyExtractor={(_, idx) => `${key}-p${idx}`}
              horizontal
              showsHorizontalScrollIndicator={false}
              decelerationRate="fast"
              snapToAlignment="start"
              snapToInterval={cardWidth + gap}
              contentContainerStyle={{ paddingHorizontal: horizontalPad }}
              ItemSeparatorComponent={() => <View style={{ width: gap }} />}
              renderItem={({ item: page }) => (
                <View style={{ width: cardWidth, rowGap: columnGap }}>
                  {page.map((it: any) => (
                    <React.Fragment key={it?.id ?? it?.spotifyUrl ?? it?.title}>
                      {renderReleaseCard(it)}
                    </React.Fragment>
                  ))}
                </View>
              )}
            />
          );
        };

        const renderHeroRow = (data: any[], key: string) => {
          if (!data.length) return null;
          return (
            <FlatList
              data={data}
              keyExtractor={(it, idx) => `${key}-${it?.id ?? it?.spotifyUrl ?? it?.title}-${idx}`}
              horizontal
              showsHorizontalScrollIndicator={false}
              decelerationRate="fast"
              snapToAlignment="start"
              snapToInterval={heroCardWidth + heroGap}
              contentContainerStyle={{ paddingHorizontal: horizontalPad }}
              ItemSeparatorComponent={() => <View style={{ width: heroGap }} />}
              renderItem={({ item }) => renderHeroCard(item)}
            />
          );
        };

        const getHeroCount = (len: number) => Math.min(3, Math.max(0, len));

        const renderSection = (data: any[], title: string, key: string) => {
          if (!data.length) return null;
          if (viewMode === 'pills') {
            return (
              <View key={key} style={{ marginBottom: 18 }}>
                {title ? <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text.secondary, marginBottom: 10, paddingHorizontal: horizontalPad }}>{title}</Text> : null}
                {renderPillColumns(data, key)}
              </View>
            );
          }

          const heroCount = getHeroCount(data.length);
          const hero = data.slice(0, heroCount);
          const rest = data.slice(heroCount);
          return (
            <View key={key} style={{ marginBottom: 18 }}>
              {title ? <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text.secondary, marginBottom: 10, paddingHorizontal: horizontalPad }}>{title}</Text> : null}
              {renderHeroRow(hero, `${key}-hero`)}
              {rest.length ? <View style={{ marginTop: 12 }}>{renderPillColumns(rest, `${key}-pills`)}</View> : null}
            </View>
          );
        };

        const hasAny = hasYourUpdates || filteredTopPicks.length > 0 || youMightLike.length > 0 || genreRows.some((r) => r.items.length > 0);
        return (
          <>
            {yourUpdatesReleases.length ? (
              <View key="your-updates-releases" style={{ marginBottom: 16 }}>
                {renderSection(yourUpdatesReleases, '', 'your-updates')}
              </View>
            ) : null}
            {filteredTopPicks.length ? (
              <View key="top-picks" style={{ marginBottom: 16 }}>
                <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text.secondary, marginBottom: 10, paddingHorizontal: horizontalPad }}>Top picks</Text>
                {renderSection(filteredTopPicks, '', 'top-picks')}
              </View>
            ) : null}
            {(() => {
              if (!youMightLike.length) return null;
              return (
                <View key="you-might-like" style={{ marginTop: 12 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 8 }}>
                    <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text.secondary }}>You might like</Text>
                    <Pressable hitSlop={6} onPress={() => setReasonRow({ reasonType: 'SECTION', reason: 'Based on your listening and ratings — not just new releases.' })}>
                      <Ionicons name="information-circle-outline" size={14} color={colors.text.muted} />
                    </Pressable>
                  </View>
                  {renderSection(youMightLike, '', 'yml')}
                </View>
              );
            })()}
            {genreRows.map((row, idx) => {
              const label = GENRE_OPTIONS.find((g) => g.key === row.genre)?.label ?? row.genre;
              return (
                <View key={`wrap-${row.genre}`} style={{ marginTop: idx === 0 ? 16 : 8 }}>
                  {renderSection(row.items, `New ${label}`, `genre-${row.genre}`)}
                </View>
              );
            })}
            {hasAny && (
              <GlassCard asChild style={{ marginTop: 6 }}>
                <Pressable
                  onPress={() => router.push('/new-releases-all')}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingVertical: 12,
                    paddingHorizontal: 12,
                    opacity: pressed ? 0.9 : 1,
                  })}
                >
                  <Text style={{ fontWeight: '800', color: colors.text.secondary }}>View all releases</Text>
                  <Ionicons name="chevron-forward" size={18} color={colors.text.secondary} />
                </Pressable>
              </GlassCard>
            )}
          </>
        );
      })()}
      </Animated.View>
    </View>
  );

  return (
    <Screen>
      {offlineBanner}
      <View style={{ marginTop: 8, marginBottom: 12, flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search music: artists, albums, tracks"
          onSubmitEditing={onSearch}
          placeholderTextColor={colors.text.muted}
          style={{ flex: 1, borderWidth: 1, borderColor: colors.border.subtle, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.bg.secondary, color: colors.text.secondary }}
        />
        {q.length > 0 && (
          <Pressable onPress={clearSearch} hitSlop={8} style={{ paddingHorizontal: 10, paddingVertical: 8, backgroundColor: colors.bg.muted, borderRadius: 8 }}>
            <Text style={{ color: colors.text.secondary, fontWeight: '700' }}>Clear</Text>
          </Pressable>
        )}
        <Pressable
          onPress={toggleViewMode}
          hitSlop={8}
          style={({ pressed }) => ({
            padding: 10,
            borderRadius: 10,
            backgroundColor: colors.bg.muted,
            opacity: pressed ? 0.9 : 1,
          })}
        >
          <View>
            <Ionicons
              name={viewMode === 'mixed' ? 'albums' : 'albums-outline'}
              size={20}
              color={colors.text.secondary}
            />
            <View
              style={{
                position: 'absolute',
                right: -1,
                bottom: -1,
                width: 7,
                height: 7,
                borderRadius: 99,
                backgroundColor: viewMode === 'mixed' ? colors.accent.primary : colors.text.muted,
                borderWidth: 1,
                borderColor: colors.bg.muted,
                opacity: 0.9,
              }}
            />
          </View>
        </Pressable>
        <Pressable onPress={() => setFilterVisible(true)} hitSlop={8} style={{ padding: 10, borderRadius: 10, backgroundColor: colors.bg.muted }}>
          <Ionicons name="options-outline" size={20} color={colors.text.secondary} />
        </Pressable>
      </View>
      {/* Suggestions panel removed; global search results are shown below */}
  {/* Tip removed */}
      {busy && (
        <View style={{ paddingVertical: 8 }}>
          <ActivityIndicator />
        </View>
      )}
  {/* artistHeader removed when showing grouped search results */}
      {hasGrouped ? (
        <SectionList
          sections={groupedSections}
          keyExtractor={(item, index) => `sec-${item.type}-${item.id}-${index}`}
          renderSectionHeader={({ section }) => (
            <Text style={{ fontSize: 18, fontWeight: '600', marginTop: 16, marginBottom: 8, color: colors.text.secondary }}>{section.title}</Text>
          )}
          renderItem={({ item }) => renderSearchRow(item)}
          keyboardShouldPersistTaps="handled"
          refreshing={refreshing}
          onRefresh={onRefresh}
          ListEmptyComponent={renderEmpty}
        />
      ) : (
        <FlatList
          data={rows}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          extraData={viewMode}
          ListHeaderComponent={ReleasesHeader}
          ListEmptyComponent={renderEmpty}
          refreshing={refreshing}
          onRefresh={onRefresh}
          keyboardShouldPersistTaps="handled"
        />
      )}
      <Modal visible={filterVisible} transparent animationType="slide" onRequestClose={() => setFilterVisible(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={() => setFilterVisible(false)} />
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16 }}>
          <GlassCard style={{ padding: 16 }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text.secondary, marginBottom: 10 }}>Filter by genre</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {GENRE_OPTIONS.map((opt) => (
                <Chip
                  key={opt.key}
                  label={opt.label}
                  selected={draftGenres.has(opt.key)}
                  onPress={() => toggleDraftGenre(opt.key)}
                />
              ))}
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginTop: 16 }}>
              <Pressable onPress={clearGenres} style={{ flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.bg.muted }}>
                <Text style={{ textAlign: 'center', fontWeight: '700', color: colors.text.secondary }}>Clear filters</Text>
              </Pressable>
              <Pressable onPress={applyGenres} style={{ flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.accent.primary }}>
                <Text style={{ textAlign: 'center', fontWeight: '800', color: colors.text.inverted }}>Apply</Text>
              </Pressable>
            </View>
          </GlassCard>
        </View>
      </Modal>
      <Modal visible={!!reasonRow} transparent animationType="fade" onRequestClose={() => setReasonRow(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }} onPress={() => setReasonRow(null)} />
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16 }}>
          <GlassCard style={{ padding: 16 }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text.secondary, marginBottom: 6 }}>Why these?</Text>
            <Text style={{ color: colors.text.secondary, marginBottom: 4 }}>Based on your listening and ratings — not just new releases.</Text>
            <Text style={{ color: colors.text.muted, marginBottom: 12, fontSize: 12 }}>We look at what you enjoy to suggest similar music.</Text>
            <Pressable onPress={() => setReasonRow(null)} style={{ marginTop: 10, alignSelf: 'flex-end', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.bg.muted }}>
              <Text style={{ color: colors.text.secondary, fontWeight: '700' }}>Close</Text>
            </Pressable>
          </GlassCard>
        </View>
      </Modal>
      <StatusMenu
        row={menuRow as any}
        visible={!!menuRow}
        onClose={() => setMenuRow(null)}
        onChanged={handleMenuChanged}
      />
    </Screen>
  );
}
