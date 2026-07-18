import AsyncStorage from '@react-native-async-storage/async-storage';
import { BlurView } from 'expo-blur';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, AppState, Dimensions, FlatList, Image, Keyboard, Pressable, ScrollView, SectionList, Text, TextInput, View, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { goToRelease } from '../../lib/navigation';
import { openArtist } from '../../lib/openArtist';
import { getNewReleasesByGenre, getTopPicks, getWesternNewReleases } from '../../lib/recommend';
import { FN_BASE as FN, fetchFn } from '../../lib/fnBase';
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
type DebugFetchResult = { url: string; status: number; build: string | null; body: string; ok: boolean };
type SectionStatus = 'loading' | 'success' | 'empty' | 'error';
type FollowedUpdateArtist = { id: string; name: string; imageUrl?: string | null; latestId?: string; latestDate?: string | null };
type FollowedArtistDetails = Record<string, { name: string; imageUrl?: string | null }>;

const SCREEN_WIDTH = Dimensions.get('window').width;
type DiscoverViewMode = 'mixed' | 'pills';
const DISCOVER_VIEW_MODE_KEY = 'discover.viewMode';
const DISCOVER_MARKETS = ['US', 'GB'];
const DISCOVER_GENRE_DAYS = 30;
const DISCOVER_TOP_PICKS_DAYS = 30;
const UPDATES_DAYS = 14;
const YOUR_UPDATES_CAP = 20;
const DISCOVER_HEADER_HEIGHT = 76;
const UPDATES_DEEP_REFRESH_TTL_MS = 15 * 60 * 1000;
const UPDATES_SCAN_BATCH_SIZE = 3;

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

function normalizeDiscoverDate(value?: string | null, precision?: string | null): string | null {
  if (!value) return null;
  let normalized = String(value);
  const normalizedPrecision = (precision || '').toLowerCase();
  if (normalizedPrecision === 'year') normalized = `${normalized}-01-01`;
  else if (normalizedPrecision === 'month') normalized = `${normalized}-01`;
  else if (/^\d{4}$/.test(normalized)) normalized = `${normalized}-07-01`;
  else if (/^\d{4}-\d{2}$/.test(normalized)) normalized = `${normalized}-15`;
  return normalized;
}

function discoverDateTimestamp(value?: string | null, precision?: string | null): number {
  const normalized = normalizeDiscoverDate(value, precision);
  if (!normalized) return 0;
  const timestamp = Date.parse(normalized);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function isWithinDiscoverWindow(value: string | null | undefined, cutoffTs: number, precision?: string | null): boolean {
  return discoverDateTimestamp(value, precision) >= cutoffTs;
}

function discoverWindowCutoff(days: number) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return date.getTime();
}

function normalizeArtistIdentity(value?: string | null): string | null {
  const normalized = (value || '').trim().toLowerCase();
  return normalized || null;
}

function isVariousArtistsName(value?: string | null): boolean {
  return normalizeArtistIdentity(value) === 'various artists';
}

function isSpotifyAlbumUrl(value?: string | null): boolean {
  if (!value) return true;
  return /open\.spotify\.com\/album\//i.test(value);
}

function isAllowedUpdateFeedRow(row: FeedItem, followedIds: Set<string>): boolean {
  if (!followedIds.has(row.artist_id)) return false;
  if (!isSpotifyAlbumUrl(row.spotify_url ?? null)) return false;
  if (isVariousArtistsName(row.artist_name)) return false;
  const releaseType = String((row as any).release_type ?? (row as any).item_type ?? '').toLowerCase();
  return releaseType !== 'compilation' && releaseType !== 'appears_on';
}

function getReleaseArtistIds(release: any): string[] {
  if (Array.isArray(release?.artistIds)) return release.artistIds.filter(Boolean).map(String);
  if (Array.isArray(release?.artists)) return release.artists.map((artist: any) => artist?.id).filter(Boolean).map(String);
  const id = release?.artistId ?? release?.artist_id ?? null;
  return id ? [String(id)] : [];
}

function getReleaseArtistNames(release: any): string[] {
  if (Array.isArray(release?.artistNames)) return release.artistNames.filter(Boolean).map(String);
  if (Array.isArray(release?.artists)) return release.artists.map((artist: any) => artist?.name).filter(Boolean).map(String);
  const name = release?.artist ?? release?.artist_name ?? null;
  return name ? [String(name)] : [];
}

function isPrimaryFollowedRelease(release: any, followedArtistId: string): boolean {
  if (String(release?.type ?? '').toLowerCase() === 'track') return false;
  if (!isSpotifyAlbumUrl(release?.spotifyUrl ?? release?.spotify_url ?? null)) return false;

  const albumGroup = String(release?.albumGroup ?? release?.album_group ?? '').toLowerCase();
  if (albumGroup === 'appears_on' || albumGroup === 'compilation') return false;

  const albumType = String(release?.albumType ?? release?.album_type ?? '').toLowerCase();
  if (albumType === 'compilation' || albumType === 'appears_on') return false;

  const artistNames = getReleaseArtistNames(release);
  if (artistNames.some(isVariousArtistsName)) return false;

  return getReleaseArtistIds(release).includes(followedArtistId);
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
  { key: 'kpop', label: 'K-Pop' },
];

const VISIBLE_GENRE_KEYS = new Set<CanonicalGenre>(
  GENRE_OPTIONS
    .filter((g) => g.key !== 'all')
    .map((g) => g.key as CanonicalGenre)
);

const toVisibleGenreSet = (genres: Iterable<CanonicalGenre>) => (
  new Set(Array.from(genres).filter((g) => VISIBLE_GENRE_KEYS.has(g)))
);

type DiscoverLoad = (opts?: { preserveExisting?: boolean }) => Promise<void>;

export default function DiscoverTab() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const accentSoft = colors.accent.primary + '1a';
  const successSoft = colors.accent.success + '1a';
  const navigation = useNavigation();
  const [viewMode, setViewMode] = useState<DiscoverViewMode>('mixed');
  const viewAnim = useRef(new Animated.Value(1)).current;
  const headerAnim = useRef(new Animated.Value(1)).current;
  const headerVisibleRef = useRef(true);
  const lastScrollYRef = useRef(0);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [searchRows, setSearchRows] = useState<SpotifyResult[]>([]);
  // Upcoming removed
  const [artist, setArtist] = useState<{ id: string; name: string } | null>(null);
  const [artistAlbumsRows, setArtistAlbumsRows] = useState<Awaited<ReturnType<typeof artistAlbums>>>([]);
  const [artistTracksRows, setArtistTracksRows] = useState<Awaited<ReturnType<typeof artistTopTracks>>>([]);
  const [newReleases, setNewReleases] = useState<Awaited<ReturnType<typeof getWesternNewReleases>>>([]);
  const [topPicksRaw, setTopPicksRaw] = useState<Awaited<ReturnType<typeof getTopPicks>>>([]);
  const [filteredTopPicks, setFilteredTopPicks] = useState<Awaited<ReturnType<typeof getWesternNewReleases>>>([]);
  const [filteredTrending, setFilteredTrending] = useState<Awaited<ReturnType<typeof getWesternNewReleases>>>([]);
  const [genreRows, setGenreRows] = useState<Array<{ genre: CanonicalGenre; items: Awaited<ReturnType<typeof getWesternNewReleases>> }>>([]);
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
  const [followedArtistRows, setFollowedArtistRows] = useState<FollowedUpdateArtist[]>([]);
  const [yourUpdatesReleases, setYourUpdatesReleases] = useState<Array<{ id: string; title: string; artist: string; artistId?: string | null; releaseDate?: string | null; spotifyUrl?: string | null; imageUrl?: string | null; type?: 'album' | 'single' | 'ep' }>>([]);
  const [expandedUpdateArtists, setExpandedUpdateArtists] = useState<Set<string>>(new Set());
  const [topPicksLoading, setTopPicksLoading] = useState<boolean>(true);
  const [topPicksError, setTopPicksError] = useState<any | null>(null);
  const [yourUpdatesError, setYourUpdatesError] = useState<any | null>(null);
  const [loadCycleId, setLoadCycleId] = useState<number>(0);
  const [selectedGenres, setSelectedGenres] = useState<Set<CanonicalGenre>>(new Set());
  const [draftGenres, setDraftGenres] = useState<Set<string>>(new Set(['all']));
  const [filterVisible, setFilterVisible] = useState(false);
  const [debugVisible, setDebugVisible] = useState(false);
  const [debugBusy, setDebugBusy] = useState(false);
  const [debugWide, setDebugWide] = useState<DebugFetchResult | null>(null);
  const [debugGenre, setDebugGenre] = useState<DebugFetchResult | null>(null);
  const [reasonRow, setReasonRow] = useState<any | null>(null);
  const loadRef = useRef<DiscoverLoad | null>(null);
  const allDiscoverSnapshotRef = useRef<{
    topPicks: Awaited<ReturnType<typeof getWesternNewReleases>>;
    genreRows: Array<{ genre: CanonicalGenre; items: Awaited<ReturnType<typeof getWesternNewReleases>> }>;
    youMightLike: Array<any>;
  } | null>(null);
  // Track items saved during this session to show a ✓ instead of Save/Add
  const [addedIds, setAddedIds] = useState<Record<string, true>>({});
  // Listen state map (by spotify_id/provider_id) to surface rating/done status
  const [listenStatus, setListenStatus] = useState<Record<string, { rating?: number | null; done?: boolean; details?: any }>>({});
  // Clean-bubble data: details (name/photo) and latest recent release per followed artist
  const [followedDetails, setFollowedDetails] = useState<FollowedArtistDetails>({});
  const [recentByArtist, setRecentByArtist] = useState<Record<string, { latestId?: string; latestDate?: string | null }>>({});
  // Cache for artist profile images used in the "picked for you" lane
  const [artistImageMap, setArtistImageMap] = useState<Record<string, string>>({});
  const [artistNameMap, setArtistNameMap] = useState<Record<string, string>>({});
  const artistImgPending = useRef<Set<string>>(new Set());
  const [menuRow, setMenuRow] = useState<any | null>(null);
  const lastFetchRef = useRef<number>(0);
  const artistImageMapRef = useRef<Record<string, string>>({});
  const updatesLastDeepScanAtRef = useRef<number>(0);
  const forYouItemsRef = useRef<typeof forYouItems>([]);
  const yourUpdatesReleasesRef = useRef<typeof yourUpdatesReleases>([]);
  const loggedLoadCycleRef = useRef<number>(0);
  const { offline } = useOffline();
  const debugSetNewReleases = useCallback(
    (source: string, items: Awaited<ReturnType<typeof getWesternNewReleases>>) => {
      if (__DEV__) {
        const first3 = (items ?? []).slice(0, 3).map((it) => ({
          id: it?.id ?? null,
          spotifyUrl: !!it?.spotifyUrl,
          artistId: !!it?.artistId,
        }));
        console.log('[discover][setNewReleases]', {
          source,
          count: items?.length ?? 0,
          sampleId: items?.[0]?.id ?? null,
          first3,
        });
        console.trace(`[discover][setNewReleases trace] ${source}`);
      }
      setNewReleases(items);
    },
    [setNewReleases]
  );
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
  const NEW_RELEASES_CACHE_KEY = 'discover_new_releases_v3';
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
    forYouItemsRef.current = forYouItems;
  }, [forYouItems]);

  useEffect(() => {
    yourUpdatesReleasesRef.current = yourUpdatesReleases;
  }, [yourUpdatesReleases]);

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

  const setHeaderVisible = useCallback((visible: boolean) => {
    if (headerVisibleRef.current === visible) return;
    headerVisibleRef.current = visible;
    Animated.timing(headerAnim, {
      toValue: visible ? 1 : 0,
      duration: visible ? 180 : 140,
      useNativeDriver: true,
    }).start();
  }, [headerAnim]);

  const handleDiscoverScroll = useCallback((event: any) => {
    const y = Math.max(0, event?.nativeEvent?.contentOffset?.y ?? 0);
    const lastY = lastScrollYRef.current;
    const delta = y - lastY;
    lastScrollYRef.current = y;

    if (y < 8) {
      setHeaderVisible(true);
      return;
    }
    if (delta > 4) setHeaderVisible(false);
    else if (delta < -3) setHeaderVisible(true);
  }, [setHeaderVisible]);

  const formatDebugBody = useCallback((text: string) => {
    try {
      const json = JSON.parse(text);
      return JSON.stringify(json, null, 2);
    } catch {
      return text;
    }
  }, []);

  const runDebugFetch = useCallback(async () => {
    const wideUrl = `${FN}/spotify-search/top-picks?days=${DISCOVER_TOP_PICKS_DAYS}&debug=1`;
    const genreUrl = `${FN}/spotify-search/new-releases-genre?genres=rap,pop&debug=1`;
    setDebugBusy(true);
    const fetchOne = async (url: string, setter: (val: DebugFetchResult) => void) => {
      try {
        const res = await fetchFn(url);
        const text = await res.text();
        setter({
          url,
          status: res.status,
          build: res.headers.get('x-spotify-search-build'),
          body: formatDebugBody(text),
          ok: res.ok,
        });
      } catch (e) {
        setter({
          url,
          status: 0,
          build: null,
          body: String(e),
          ok: false,
        });
      }
    };
    try {
      await Promise.all([
        fetchOne(wideUrl, (val) => setDebugWide(val)),
        fetchOne(genreUrl, (val) => setDebugGenre(val)),
      ]);
    } finally {
      setDebugBusy(false);
    }
  }, [formatDebugBody]);

  const copyDebugBody = useCallback(async (payload?: DebugFetchResult | null) => {
    if (!payload?.body) return;
    const text = payload.body;
    try {
      // Optional dependency; prefer Expo Clipboard when installed.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Clipboard = require('expo-clipboard');
      if (Clipboard?.setStringAsync) {
        await Clipboard.setStringAsync(text);
        Alert.alert('Copied', 'Debug JSON copied to clipboard.');
        return;
      }
    } catch {}
    try {
      const nav = (globalThis as any)?.navigator;
      if (nav?.clipboard?.writeText) {
        await nav.clipboard.writeText(text);
        Alert.alert('Copied', 'Debug JSON copied to clipboard.');
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!__DEV__) return;
    if (debugVisible) {
      runDebugFetch();
    }
  }, [debugVisible, runDebugFetch]);

  useEffect(() => {
    let cancelled = false;
    setTopPicksLoading(true);
    (async () => {
      const effective = selectedGenres;
      const taken = new Set<string>();
      const removeSaved = (arr: typeof topPicksRaw) => arr.filter((it) => {
        const key = spotifyKey(it.id, it.spotifyUrl);
        if (!key) return true;
        return !(listenStatus[key] || addedIds[key]);
      });
      let top = removeSaved(topPicksRaw);
      if (effective.size) {
        top = await filterReleasesByGenres(top, effective);
      }
      top.forEach((it) => {
        const key = spotifyKey(it.id, it.spotifyUrl);
        if (key) taken.add(key);
      });
      if (cancelled) return;
      setFilteredTopPicks(top);
      setFilteredTrending([]);
      setTakenTopPicks(taken);
      setTopPicksLoading(false);
    })().catch(() => {
      if (cancelled) return;
      setFilteredTopPicks([]);
      setFilteredTrending([]);
      setTakenTopPicks(new Set());
      setTopPicksLoading(false);
    });
    return () => { cancelled = true; };
  }, [topPicksRaw, selectedGenres, listenStatus, addedIds]);

  useEffect(() => {
    let cancelled = false;
    const buildGenreRows = async () => {
      const canonicalOrder = GENRE_OPTIONS.filter((g) => g.key !== 'all').map((g) => g.key as CanonicalGenre);
      const targets: CanonicalGenre[] = selectedGenres.size ? Array.from(selectedGenres) : canonicalOrder;
      const buckets = await getNewReleasesByGenre({
        genres: targets,
        days: DISCOVER_GENRE_DAYS,
        market: 'US',
        strict: false,
        mode: 'full',
      });
      const rowsWithCounts = targets.map((g) => {
        const bucket = Array.isArray((buckets as any)?.[g]) ? (buckets as any)[g] : [];
        const items = bucket.filter((it: any) => !!it?.spotifyUrl);
        return { genre: g, items: items.slice(0, 12), count: items.length };
      });
      const MAX_GENRE_ROWS = selectedGenres.size ? 6 : 8;
      if (!cancelled) {
        const ordered = rowsWithCounts.slice(0, MAX_GENRE_ROWS);
        setGenreRows(ordered.map(({ genre, items }) => ({ genre, items })));
        if (__DEV__) {
          const wireCounts = Object.fromEntries(ordered.slice(0, 4).map((r) => [r.genre, r.items.length]));
          console.log('[discover][wire]', { topPicksLength: topPicksRaw.length, genreBucketCounts: wireCounts });
          const firstItem = rowsWithCounts.find((r) => (r.items?.length ?? 0) > 0)?.items?.[0];
          console.log('[NRG] first item keys', Object.keys(firstItem ?? {}));
          const hiphop = rowsWithCounts.find((r) => r.genre === 'hiphop');
          console.log('[discover rails][predicate sample]', {
            rail: 'hiphop',
            readsField: 'genre',
            comparesTo: 'remote genre bucket from spotify-search/new-releases-genre',
            matchedCount: hiphop?.count ?? 0,
          });
          const counts = Object.fromEntries(rowsWithCounts.map((r) => [r.genre, r.count]));
          console.log('[discover rails][counts]', {
            days: DISCOVER_GENRE_DAYS,
            markets: DISCOVER_MARKETS,
            genres: targets,
            strict: false,
            counts,
          });
        }
      }
    };
    buildGenreRows();
    return () => { cancelled = true; };
  }, [selectedGenres, topPicksRaw.length]);

  useEffect(() => {
    const visibleGenres = toVisibleGenreSet(selectedGenres);
    setDraftGenres(visibleGenres.size ? new Set(visibleGenres) : new Set(['all']));
  }, [selectedGenres]);

  const yourUpdatesLoading = pickedLoading || forYouLoading;
  const freshYourUpdatesReleases = useMemo(() => {
    const cutoffTs = discoverWindowCutoff(UPDATES_DAYS);
    return yourUpdatesReleases.filter((item) => isWithinDiscoverWindow(item.releaseDate ?? null, cutoffTs));
  }, [yourUpdatesReleases]);
  const followedArtists = useMemo<FollowedUpdateArtist[]>(() => {
    const cutoffTs = discoverWindowCutoff(UPDATES_DAYS);
    const fallbackByArtistId = new Map(forYouItems.map((artist) => [artist.id, artist]));
    const uniq = new Map<string, { id: string; name: string; imageUrl?: string | null; latestId?: string; latestDate?: string | null }>();
    const addRecentArtist = (artist: FollowedUpdateArtist) => {
      if (!artist.id || uniq.has(artist.id)) return;
      const detail = followedDetails[artist.id];
      const fallback = fallbackByArtistId.get(artist.id);
      const latestDate = artist.latestDate ?? fallback?.latestDate ?? null;
      if (!isWithinDiscoverWindow(latestDate, cutoffTs)) return;
      uniq.set(artist.id, {
        id: artist.id,
        name: detail?.name || artist.name || fallback?.name || 'Unknown',
        imageUrl: detail?.imageUrl ?? artist.imageUrl ?? fallback?.imageUrl ?? null,
        latestId: artist.latestId ?? fallback?.latestId,
        latestDate,
      });
    };
    forYouItems.forEach(addRecentArtist);
    followedArtistRows.forEach(addRecentArtist);
    freshYourUpdatesReleases.forEach((item) => {
      const artistId = item.artistId ?? null;
      if (!artistId || !/^[A-Za-z0-9]{22}$/.test(String(artistId))) return;
      const detail = followedDetails[artistId];
      const fallback = fallbackByArtistId.get(artistId);
      uniq.set(artistId, {
        id: artistId,
        name: detail?.name || item.artist || fallback?.name || 'Unknown',
        imageUrl: detail?.imageUrl ?? fallback?.imageUrl ?? null,
        latestId: item.id,
        latestDate: item.releaseDate ?? null,
      });
    });
    return Array.from(uniq.values());
  }, [followedArtistRows, followedDetails, forYouItems, freshYourUpdatesReleases]);
  const yourUpdatesVisible = useMemo(
    () => freshYourUpdatesReleases.slice(0, YOUR_UPDATES_CAP),
    [freshYourUpdatesReleases]
  );
  const yourUpdatesGroups = useMemo(() => {
    const groups: Array<{
      artistKey: string;
      artistName?: string | null;
      items: typeof yourUpdatesVisible;
    }> = [];
    const groupByArtist = new Map<string, { artistKey: string; artistName?: string | null; items: typeof yourUpdatesVisible }>();

    yourUpdatesVisible.forEach((item) => {
      const artistKey = item.artistId || normalizeArtistIdentity(item.artist) || spotifyKey(item.id, item.spotifyUrl) || item.id;
      if (!artistKey) return;
      const existing = groupByArtist.get(artistKey);
      if (existing) {
        existing.items.push(item);
        return;
      }
      const group = { artistKey, artistName: item.artist ?? null, items: [item] };
      groupByArtist.set(artistKey, group);
      groups.push(group);
    });

    return groups;
  }, [yourUpdatesVisible]);
  useEffect(() => {
    setExpandedUpdateArtists(new Set());
  }, [yourUpdatesVisible]);
  const expandUpdateGroup = useCallback((artistKey: string) => {
    setExpandedUpdateArtists((prev) => {
      if (prev.has(artistKey)) return prev;
      const next = new Set(prev);
      next.add(artistKey);
      return next;
    });
  }, []);
  const yourUpdatesDisplayItems = useMemo(() => {
    const entries: Array<{
      item: typeof yourUpdatesVisible[number];
      artistKey: string;
      moreCount?: number;
      hideArtist?: boolean;
      expandOnPress?: boolean;
    }> = [];

    yourUpdatesGroups.forEach((group) => {
      const isExpanded = expandedUpdateArtists.has(group.artistKey);
      const visibleItems = isExpanded ? group.items : group.items.slice(0, 2);
      visibleItems.forEach((item, index) => {
        const isCollapsedGroup = !isExpanded && group.items.length > 2;
        entries.push({
          item,
          artistKey: group.artistKey,
          moreCount: isCollapsedGroup && index === 1 ? group.items.length - 2 : undefined,
          hideArtist: isExpanded && index >= 2,
          expandOnPress: isCollapsedGroup,
        });
      });
    });

    return entries;
  }, [expandedUpdateArtists, yourUpdatesGroups]);

  const yourUpdatesState = useMemo<{ items: typeof yourUpdatesReleases; status: SectionStatus; error?: any }>(() => {
    if (yourUpdatesLoading) return { items: [], status: 'loading' };
    if (yourUpdatesError) return { items: [], status: 'error', error: yourUpdatesError };
    if (!freshYourUpdatesReleases.length) return { items: [], status: 'empty' };
    return { items: freshYourUpdatesReleases, status: 'success' };
  }, [freshYourUpdatesReleases, yourUpdatesError, yourUpdatesLoading]);

  const topPicksState = useMemo<{ items: typeof filteredTopPicks; status: SectionStatus; error?: any }>(() => {
    if (topPicksLoading && !filteredTopPicks.length) return { items: [], status: 'loading' };
    if (topPicksError && !filteredTopPicks.length) return { items: [], status: 'error', error: topPicksError };
    if (!filteredTopPicks.length) return { items: [], status: 'empty' };
    return { items: filteredTopPicks, status: 'success' };
  }, [filteredTopPicks, topPicksError, topPicksLoading]);

  const hasYourUpdates = useMemo(() => (
    followedArtists.length > 0 || freshYourUpdatesReleases.length > 0
  ), [followedArtists.length, freshYourUpdatesReleases.length]);

  const hasDiscoverContent = useMemo(() => {
    const genreContent = genreRows.length > 0;
    return hasYourUpdates || topPicksState.status !== 'empty' || youMightLike.length > 0 || genreContent;
  }, [genreRows.length, hasYourUpdates, topPicksState.status, youMightLike.length]);

  useEffect(() => {
    if (selectedGenres.size) return;
    if (!filteredTopPicks.length && !genreRows.length && !youMightLike.length) return;
    allDiscoverSnapshotRef.current = {
      topPicks: filteredTopPicks,
      genreRows,
      youMightLike,
    };
  }, [filteredTopPicks, genreRows, selectedGenres.size, youMightLike]);

  const restoreAllSnapshot = useCallback(() => {
    const snapshot = allDiscoverSnapshotRef.current;
    if (!snapshot) return false;
    setFilteredTopPicks(snapshot.topPicks);
    setGenreRows(snapshot.genreRows);
    setYouMightLike(snapshot.youMightLike);
    setTopPicksLoading(false);
    return true;
  }, []);

  const refreshDiscoverPreservingContent = useCallback(async () => {
    const runner = loadRef.current;
    if (!runner) return;
    setRefreshing(true);
    try {
      await runner({ preserveExisting: true });
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!__DEV__) return;
    if (!loadCycleId) return;
    if (loggedLoadCycleRef.current === loadCycleId) return;
    if (topPicksLoading || yourUpdatesLoading) return;
    loggedLoadCycleRef.current = loadCycleId;
    console.log('[following]', {
      recent_release_artists: followedArtists.length,
      recent_releases: freshYourUpdatesReleases.length,
      shown: followedArtists.length,
    });
    console.log('[discover][sections]', {
      loadCycleId,
      counts: {
        yourUpdatesReleases: freshYourUpdatesReleases.length,
        followedArtists: followedArtists.length,
        topPicks: filteredTopPicks.length,
      },
      states: {
        yourUpdates: yourUpdatesState.status,
        topPicks: topPicksState.status,
      },
      loading: {
        yourUpdates: yourUpdatesLoading,
        topPicks: topPicksLoading,
      },
      error: {
        yourUpdates: !!yourUpdatesError,
        topPicks: !!topPicksError,
      },
    });
  }, [
    filteredTopPicks.length,
    followedArtists.length,
    loadCycleId,
    topPicksError,
    topPicksLoading,
    topPicksState.status,
    yourUpdatesError,
    yourUpdatesLoading,
    freshYourUpdatesReleases.length,
    yourUpdatesState.status,
  ]);

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
    const next = draftGenres.has('all') ? new Set<CanonicalGenre>() : toVisibleGenreSet(Array.from(draftGenres) as CanonicalGenre[]);
    if (next.size === 0) restoreAllSnapshot();
    setSelectedGenres(next);
    setFilterVisible(false);
    await saveIncludedGenres(next);
    await refreshDiscoverPreservingContent();
  };

  const clearGenres = useCallback(async () => {
    const empty = new Set<CanonicalGenre>();
    restoreAllSnapshot();
    setDraftGenres(new Set(['all']));
    setSelectedGenres(empty);
    await saveIncludedGenres(empty);
    await refreshDiscoverPreservingContent();
  }, [refreshDiscoverPreservingContent, restoreAllSnapshot]);

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

  const hydrateFollowedArtistImages = useCallback(async (
    items: FollowedUpdateArtist[],
    existingDetails: FollowedArtistDetails = {}
  ): Promise<FollowedArtistDetails> => {
    const details: FollowedArtistDetails = { ...existingDetails };
    const imageUpdates: Record<string, string> = {};

    for (const item of items.filter((it) => it.id && !it.imageUrl).slice(0, 12)) {
      const cached = artistImageMapRef.current[item.id];
      if (cached) {
        item.imageUrl = cached;
        details[item.id] = { name: item.name || details[item.id]?.name || 'Unknown', imageUrl: cached };
        continue;
      }

      try {
        const detail = await fetchArtistDetails(item.id);
        const url = detail?.imageUrl ?? null;
        if (!url) {
          details[item.id] = { name: detail?.name || item.name || details[item.id]?.name || 'Unknown', imageUrl: null };
          continue;
        }

        if (detail?.name) item.name = detail.name;
        item.imageUrl = url;
        details[item.id] = { name: detail?.name || item.name || 'Unknown', imageUrl: url };
        imageUpdates[item.id] = url;
      } catch {
        details[item.id] = { name: item.name || details[item.id]?.name || 'Unknown', imageUrl: null };
      }
    }

    await cacheArtistImagesV2(imageUpdates);
    return details;
  }, [cacheArtistImagesV2]);

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

  const cacheNewReleases = async (items: Awaited<ReturnType<typeof getWesternNewReleases>>) => {
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
  const load = useCallback<DiscoverLoad>(async (opts) => {
    const preserveExisting = !!opts?.preserveExisting;
    const NEW_RELEASE_DAYS = DISCOVER_GENRE_DAYS;
    const cycleId = Date.now();
    lastFetchRef.current = cycleId;
    setLoadCycleId(cycleId);
    if (!preserveExisting) setTopPicksLoading(true);
    setTopPicksError(null);
    setYourUpdatesError(null);
    try {
      if (__DEV__) {
        console.log('[discover rails][req]', {
          topPicksUrl: `${FN}/spotify-search/top-picks?days=${DISCOVER_TOP_PICKS_DAYS}`,
          genreUrl: `${FN}/spotify-search/new-releases-genre?genres=rap,pop&days=${DISCOVER_GENRE_DAYS}`,
          note: 'top picks + genre rails fetched separately',
        });
      }
      const [nrResult, genresResult, topPicksResult] = await Promise.allSettled([
        getWesternNewReleases(NEW_RELEASE_DAYS, 220, DISCOVER_MARKETS),
        loadIncludedGenres(),
        getTopPicks(DISCOVER_TOP_PICKS_DAYS),
      ]);
      let nr: Awaited<ReturnType<typeof getWesternNewReleases>> = [];
      if (nrResult.status === 'fulfilled') {
        nr = nrResult.value;
        if (__DEV__) {
          const sample = nr?.[0];
          const railsPoolNow = nr.filter((it) => !!it.spotifyUrl && !!it.artistId);
          const spotifyUrlCount = nr.reduce(
            (acc, it) => {
              if (it.spotifyUrl) acc.present += 1;
              else acc.missing += 1;
              return acc;
            },
            { present: 0, missing: 0 }
          );
          const artistIdCount = nr.reduce(
            (acc, it) => {
              if (it.artistId) acc.present += 1;
              else acc.missing += 1;
              return acc;
            },
            { present: 0, missing: 0 }
          );
          console.log('[discover rails][sample count]', nr?.length ?? 0);
          console.log('[discover rails][sample keys]', Object.keys(sample ?? {}));
          console.log('[discover rails][sample item]', sample ?? null);
          console.log('[discover rails][filter expects]', {
            usesField: 'artistId',
            genreSource: 'getArtistGenresCached(artistId)',
            mapping: 'mapToCanonicalGenres(genres)',
            includeSet: 'Set<CanonicalGenre>',
          });
          console.log('[discover rails][pool counts]', {
            total: nr.length,
            railsPool: railsPoolNow.length,
            spotifyUrl: spotifyUrlCount,
            artistId: artistIdCount,
          });
          console.log('[discover rails][sample items][newReleases]', nr.slice(0, 3));
          console.log('[discover rails][sample items][railsPool]', railsPoolNow.slice(0, 3));
          console.log('[discover rails][resp]', { total: nr.length });
        }
        debugSetNewReleases('from getWesternNewReleases', nr);
        cacheNewReleases(nr);
      } else {
        if (!preserveExisting) {
          debugSetNewReleases('from getWesternNewReleases (error)', []);
        }
        if (__DEV__) {
          console.warn('[discover rails][new releases failed]', nrResult.reason);
        }
      }

      if (topPicksResult.status === 'fulfilled') {
        setTopPicksRaw(topPicksResult.value || []);
        if (__DEV__) {
          console.log('[discover][wire]', { topPicksLength: topPicksResult.value?.length ?? 0 });
        }
      } else {
        if (!preserveExisting) {
          setTopPicksRaw([]);
        }
        setTopPicksError(topPicksResult.reason);
        if (__DEV__) console.warn('[discover top-picks][failed]', topPicksResult.reason);
      }

      if (genresResult.status === 'fulfilled') {
        const genres = toVisibleGenreSet(genresResult.value);
        setSelectedGenres(genres);
        setDraftGenres(genres.size ? new Set(genres) : new Set(['all']));
        if (genres.size !== genresResult.value.size) {
          void saveIncludedGenres(genres);
        }
      } else if (__DEV__) {
        console.warn('[discover rails][genres failed]', genresResult.reason);
      }

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
        if (!preserveExisting) {
          setPickedLoading(true);
          setForYouLoading(true);
        }
        const followed = await listFollowedArtists();
        if (!followed || followed.length === 0) {
          setFollowedDetails({});
          setRecentByArtist({});
          setForYouItems([]);
          setFollowedArtistRows([]);
          setYourUpdatesReleases([]);
        } else {
          setFollowedArtistRows(followed.map((artist) => ({
            id: artist.id,
            name: artist.name || 'Unknown',
            imageUrl: null,
          })));
          if (!preserveExisting) {
            setForYouItems([]);
            setRecentByArtist({});
            setYourUpdatesReleases([]);
          }
          const market = getMarket();
          const cutoffTs = discoverWindowCutoff(UPDATES_DAYS);
          if (__DEV__) {
            const sample = followed.slice(0, 3).map((f) => ({ id: f.id, name: f.name }));
            console.log('[updates] followed loaded', { count: followed.length, sample, cutoff: new Date(cutoffTs).toISOString().slice(0, 10) });
          }
          const details: Record<string, { name: string; imageUrl?: string | null }> = {};
          const recents: Record<string, { latestId?: string; latestDate?: string | null }> = {};
          const debugAsap = async () => {
            if (!__DEV__ || asapDebuggedRef.current) return;
            asapDebuggedRef.current = true;
            try {
              const fnBase = (process.env.EXPO_PUBLIC_FN_BASE ?? '') || '';
              const search = await fetchFn(`${fnBase}/spotify-search/artist-search?` + new URLSearchParams({ q: 'A$AP Rocky', market }));
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
                const norm = normalizeDiscoverDate(m.releaseDate, m.releaseDatePrecision);
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
          const followedNameById = new Map<string, string>(followed.map((f) => [f.id, f.name]));
          const followedIdByName = new Map<string, string>(followed.map((f) => [(f.name || '').toLowerCase().trim(), f.id]));
          const validFollowedIds = Array.from(followedIds).filter((id) => /^[A-Za-z0-9]{22}$/.test(id));
          let seedYourUpdatesReleases: Array<{ id: string; title: string; artist: string; artistId?: string | null; releaseDate?: string | null; spotifyUrl?: string | null; imageUrl?: string | null; type?: 'album' | 'single' | 'ep' }> = [];
          let seedFollowedItems: FollowedUpdateArtist[] = [];
          let builtFromFeed = false;
          const hasVisibleUpdates = forYouItemsRef.current.length > 0 || yourUpdatesReleasesRef.current.length > 0;
          const deepScanFresh = (Date.now() - updatesLastDeepScanAtRef.current) < UPDATES_DEEP_REFRESH_TTL_MS;
          const skipDeepUpdateScan = preserveExisting && hasVisibleUpdates && deepScanFresh;

          try {
            const feed = await fetchFeedForArtists({ artistIds: validFollowedIds, limit: 250 });
            const recentFeed = (feed || []).filter((it) => (
              isAllowedUpdateFeedRow(it, followedIds) &&
              isWithinDiscoverWindow(it.release_date ?? null, cutoffTs)
            ));
            if (recentFeed.length) {
              const releases: Array<{ id: string; title: string; artist: string; artistId?: string | null; releaseDate?: string | null; spotifyUrl?: string | null; imageUrl?: string | null; type?: 'album' | 'single' | 'ep' }> = [];
              const seenRelease = new Set<string>();
              const byArtist = new Map<string, { artistId: string; artistName: string; latestId: string; latestDate: string | null }>();

              const toType = (t?: string | null): 'album' | 'single' | 'ep' | undefined => {
                const x = (t || '').toLowerCase();
                if (x === 'single') return 'single';
                if (x === 'album') return 'album';
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
                const prevTs = prev?.latestDate ? discoverDateTimestamp(prev.latestDate) : 0;
                const ts = discoverDateTimestamp(it.release_date ?? null);
                if (!prev || ts > prevTs) byArtist.set(artistId, { artistId, artistName, latestId: sid, latestDate: it.release_date ?? null });
              }

              releases.sort((a, b) => discoverDateTimestamp(b.releaseDate ?? null) - discoverDateTimestamp(a.releaseDate ?? null));
              setYourUpdatesReleases(releases.slice(0, 60));

              const items = Array.from(byArtist.values()).map((v) => {
                const cachedImg = artistImageMapRef.current[v.artistId] ?? null;
                return { id: v.artistId, name: v.artistName, imageUrl: cachedImg, latestId: v.latestId, latestDate: v.latestDate };
              });
              items.sort((a, b) => discoverDateTimestamp(b.latestDate ?? null) - discoverDateTimestamp(a.latestDate ?? null));

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

              seedYourUpdatesReleases = releases.slice(0, 60);
              seedFollowedItems = items;
              Object.assign(details, detObj);
              setFollowedDetails(detObj);
              setRecentByArtist(recObj);
              setForYouItems(items);
              setFollowedArtistRows((prev) => prev.map((artist) => {
                const update = items.find((item) => item.id === artist.id);
                return update ? { ...artist, ...update } : artist;
              }));
              cacheForYou(items, FOR_YOU_UPDATES_CACHE_KEY);
              if (__DEV__) console.log('[updates] recents built (feed)', { total: items.length, releases: releases.length, cutoff: new Date(cutoffTs).toISOString().slice(0, 10) });
              builtFromFeed = true;
            }
          } catch {}

          if (!builtFromFeed && validFollowedIds.length && !skipDeepUpdateScan) {
            try {
              const refreshIds = validFollowedIds;
              for (let index = 0; index < refreshIds.length; index += UPDATES_SCAN_BATCH_SIZE) {
                const batch = refreshIds.slice(index, index + UPDATES_SCAN_BATCH_SIZE);
                await Promise.all(batch.map((artistId) => (
                  fetchFn(`${FN}/check-new-releases?` + new URLSearchParams({ artistId, market })).catch(() => null)
                )));
              }
              const feed = await fetchFeedForArtists({ artistIds: validFollowedIds, limit: 250 });
              const recentFeed = (feed || []).filter((it) => (
                isAllowedUpdateFeedRow(it, followedIds) &&
                isWithinDiscoverWindow(it.release_date ?? null, cutoffTs)
              ));
              if (recentFeed.length) {
                const releases: Array<{ id: string; title: string; artist: string; artistId?: string | null; releaseDate?: string | null; spotifyUrl?: string | null; imageUrl?: string | null; type?: 'album' | 'single' | 'ep' }> = [];
                const seenRelease = new Set<string>();
                const byArtist = new Map<string, { artistId: string; artistName: string; latestId: string; latestDate: string | null }>();
                const toType = (t?: string | null): 'album' | 'single' | 'ep' | undefined => {
                  const x = (t || '').toLowerCase();
                  if (x === 'single') return 'single';
                  if (x === 'album') return 'album';
                  return undefined;
                };
                for (const it of recentFeed) {
                  const sid = spotifyKey(null, it.spotify_url ?? null) || it.provider_id || it.spotify_id || it.id;
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
                  const prevTs = prev?.latestDate ? discoverDateTimestamp(prev.latestDate) : 0;
                  const ts = discoverDateTimestamp(it.release_date ?? null);
                  if (!prev || ts > prevTs) byArtist.set(artistId, { artistId, artistName, latestId: sid, latestDate: it.release_date ?? null });
                }
                releases.sort((a, b) => discoverDateTimestamp(b.releaseDate ?? null) - discoverDateTimestamp(a.releaseDate ?? null));
                setYourUpdatesReleases(releases.slice(0, 60));
                const items: FollowedUpdateArtist[] = Array.from(byArtist.values()).map((v) => ({
                  id: v.artistId,
                  name: v.artistName,
                  imageUrl: artistImageMapRef.current[v.artistId] ?? null,
                  latestId: v.latestId,
                  latestDate: v.latestDate,
                }));
                items.sort((a, b) => discoverDateTimestamp(b.latestDate ?? null) - discoverDateTimestamp(a.latestDate ?? null));
                const detObj = await hydrateFollowedArtistImages(items, details);
                const recObj: Record<string, { latestId?: string; latestDate?: string | null }> = {};
                items.forEach((it) => {
                  recObj[it.id] = { latestId: it.latestId, latestDate: it.latestDate ?? null };
                });
                seedYourUpdatesReleases = releases.slice(0, 60);
                seedFollowedItems = items;
                Object.assign(details, detObj);
                setFollowedDetails(detObj);
                setRecentByArtist(recObj);
                setForYouItems(items);
                setFollowedArtistRows((prev) => prev.map((artist) => {
                  const update = items.find((item) => item.id === artist.id);
                  return update ? { ...artist, ...update } : artist;
                }));
                cacheForYou(items, FOR_YOU_UPDATES_CACHE_KEY);
                builtFromFeed = true;
                if (__DEV__) console.log('[updates] recents built (feed refresh)', { total: items.length, releases: releases.length, cutoff: new Date(cutoffTs).toISOString().slice(0, 10) });
              }
            } catch {}
          }

          {
          if (skipDeepUpdateScan) {
            if (__DEV__) {
              console.log('[updates] skipped deep scan', {
                ageMs: Date.now() - updatesLastDeepScanAtRef.current,
                visibleArtists: forYouItemsRef.current.length,
                visibleReleases: yourUpdatesReleasesRef.current.length,
              });
            }
          } else {
          // Fast fallback: if we already have newReleases, pull followed-artist matches within window
          const primaryArtist = (r: any): { id?: string | null; name?: string | null } => {
            if (r.artistId || r.artist_id) return { id: r.artistId || r.artist_id, name: r.artist || r.artist_name || null };
            if (Array.isArray(r.artists) && r.artists.length) {
              return { id: r.artists[0]?.id ?? null, name: r.artists[0]?.name ?? null };
            }
            return { id: null, name: r.artist || r.artist_name || null };
          };
          const followedArtistIdForRelease = (r: any): string | null => {
            const { id: aid, name: aname } = primaryArtist(r);
            if (aid && followedIds.has(aid)) return aid;
            const normalizedName = String(aname || '').toLowerCase().trim();
            if (!normalizedName) return null;
            const exact = followedIdByName.get(normalizedName);
            if (exact) return exact;
            const partial = Array.from(followedIdByName.entries()).find(([name]) => !!name && normalizedName.includes(name));
            return partial?.[1] ?? null;
          };
          const fallbackFromNr = (nr || []).filter((r: any) => {
            if (!followedArtistIdForRelease(r)) return false;
            if (!isWithinDiscoverWindow(r.releaseDate ?? r.release_date ?? null, cutoffTs)) return false;
            return true;
          });
          const useGlobalNewReleaseFallbackForUpdates = false;
	          if (useGlobalNewReleaseFallbackForUpdates && fallbackFromNr.length) {
	            const releases = fallbackFromNr.slice(0, 60).map((r: any) => {
	              const { name: aname } = primaryArtist(r);
                const artistId = followedArtistIdForRelease(r);
	              const sid = spotifyKey(r.id, r.spotifyUrl ?? null) || String(r.id || '');
	              return {
                id: sid,
                title: r.title,
                artist: r.artist || r.artist_name || aname || 'Unknown',
                artistId,
                releaseDate: r.releaseDate ?? r.release_date ?? null,
                spotifyUrl: r.spotifyUrl ?? null,
                imageUrl: r.imageUrl || r.image_url || null,
                type: (r.type === 'single' ? 'single' : r.type === 'album' ? 'album' : undefined) as any,
              };
            }).filter((x: any) => !!x.id);
            setYourUpdatesReleases(releases);
            const byArtist = new Map<string, FollowedUpdateArtist>();
            fallbackFromNr.forEach((r: any) => {
              const aid = followedArtistIdForRelease(r);
              if (!aid) return;
              const date = r.releaseDate ?? r.release_date ?? null;
              const existing = byArtist.get(aid);
              if (existing && discoverDateTimestamp(existing.latestDate ?? null) >= discoverDateTimestamp(date)) return;
              byArtist.set(aid, {
                id: aid,
                name: r.artist || r.artist_name || details[aid]?.name || followedNameById.get(aid) || 'Unknown',
                imageUrl: artistImageMapRef.current[aid] ?? null,
                latestId: r.id,
                latestDate: date,
              });
            });
            const items = Array.from(byArtist.values());
            items.sort((a,b) => {
              const ta = discoverDateTimestamp(a.latestDate ?? null);
              const tb = discoverDateTimestamp(b.latestDate ?? null);
              return tb - ta;
            });
            const recObj: Record<string, { latestId?: string; latestDate?: string | null }> = {};
            const detObj = await hydrateFollowedArtistImages(items, details);
            items.forEach((it) => {
              if (it.id) {
                recObj[it.id] = { latestId: it.latestId, latestDate: it.latestDate ?? null };
                detObj[it.id] = { name: detObj[it.id]?.name || it.name || 'Unknown', imageUrl: detObj[it.id]?.imageUrl ?? it.imageUrl ?? null };
              }
            });
            setFollowedDetails(detObj);
            setRecentByArtist(recObj);
            setForYouItems(items);
            setFollowedArtistRows((prev) => prev.map((artist) => {
              const update = items.find((item) => item.id === artist.id);
              return update ? { ...artist, ...update } : artist;
            }));
            cacheForYou(items, FOR_YOU_UPDATES_CACHE_KEY);
            if (__DEV__) console.log('[updates] recents built (fallback new releases)', { total: items.length, cutoff: new Date(cutoffTs).toISOString().slice(0,10) });
          } else {
            const releases: Array<{ id: string; title: string; artist: string; artistId?: string | null; releaseDate?: string | null; spotifyUrl?: string | null; imageUrl?: string | null; type?: 'album' | 'single' | 'ep' }> = [];
            const seenRelease = new Set<string>();
            const scanFollowedArtist = async (fa: (typeof followed)[number]) => {
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
              const seenAlbumIds = new Set<string>();
              const mkts = Array.from(new Set(['from_token', market || 'GB', 'US', 'GB'].filter(Boolean)));
              for (const mk of mkts) {
                try {
                  const url = `https://api.spotify.com/v1/artists/${id}/albums?` + new URLSearchParams({ include_groups: 'album,single', market: mk, limit: '50' });
                  const attempt = async () => artistAlbums(id, mk, 'album,single');
                  let marketAlbums: Awaited<ReturnType<typeof artistAlbums>> = [];
                  try {
                    marketAlbums = await attempt();
                  } catch (err: any) {
                    const msg = String(err || '').toLowerCase();
                    if (msg.includes('rate')) {
                      rateLimitHits += 1;
                      if (rateLimitHits >= 3) break;
                      await new Promise((res) => setTimeout(res, 800));
                      marketAlbums = await attempt();
                    } else {
                      throw err;
                    }
                  }
                  for (const album of marketAlbums || []) {
                    const albumKey = album.id || album.spotifyUrl || `${album.title}-${album.releaseDate}`;
                    if (!albumKey || seenAlbumIds.has(albumKey)) continue;
                    seenAlbumIds.add(albumKey);
                    albs.push(album);
                  }
                  if (__DEV__) {
                    const newest = marketAlbums?.[0];
                    console.log('[updates] artist albums', {
                      artist: fa.name,
                      id,
                      url,
                      market: mk,
                      count: marketAlbums?.length ?? 0,
                      total: (marketAlbums as any)?._total ?? null,
                      newest: newest ? { name: newest.title, date: newest.releaseDate, prec: (newest as any).releaseDatePrecision, group: newest.albumGroup } : null,
                    });
                  }
                  if (rateLimitHits >= 3) {
                    await new Promise((res) => setTimeout(res, 1200));
                    rateLimitHits = 0;
                  }
                } catch (err) {
                  console.log('[updates] artist albums ERROR', { artist: fa.name, id, market: mk, message: String(err) });
                }
              }
              const normDateVal = (d?: string | null, p?: string | null) => discoverDateTimestamp(d, p);
              let recent = (albs || []).filter((album) => (
                isPrimaryFollowedRelease(album, id) &&
                isWithinDiscoverWindow(album.releaseDate ?? null, cutoffTs, (album as any).releaseDatePrecision ?? null)
              ));
              if (__DEV__) {
                debugPerArtist.push({
                  artist: fa.name,
                  id,
                  total: (albs as any)?._total ?? null,
                  pulled: albs?.length ?? 0,
                  recent: recent.length,
                  recentTracks: 0,
                  firstDates: (albs || []).slice(0, 3).map(a => ({ date: a.releaseDate, prec: (a as any).releaseDatePrecision, group: a.albumGroup })),
                });
              }
              if (!recent.length && fa.name) {
                try {
                  const year = String(new Date().getFullYear());
                  const searchRows = await spotifySearch(`artist:"${fa.name}" year:${year}`, 'album');
                  const searchRecents = (searchRows || []).filter((row) => {
                    if (row.type !== 'album' || row.artistId !== id) return false;
                    if (!isPrimaryFollowedRelease(row, id)) return false;
                    return isWithinDiscoverWindow(row.releaseDate ?? null, cutoffTs);
                  });
                  if (searchRecents.length) {
                    recent = searchRecents.map((row) => ({
                      id: row.albumId || row.id,
                      title: row.title,
                      artist: row.artist || details[id]?.name || fa.name || 'Unknown',
                      releaseDate: row.releaseDate ?? null,
                      releaseDatePrecision: 'day',
                      spotifyUrl: row.spotifyUrl ?? null,
                      imageUrl: row.imageUrl ?? null,
                      artistIds: row.artistId ? [row.artistId] : [],
                      artistNames: row.artist ? [row.artist] : [],
                      type: row.albumType === 'single' ? 'single' : 'album',
                      albumType: row.albumType,
                    }));
                  }
                } catch (err) {
                  console.log('[updates] artist search fallback ERROR', { artist: fa.name, id, message: String(err) });
                }
              }
              if (recent.length) {
                recent.sort((a,b) => normDateVal(b.releaseDate, (b as any).releaseDatePrecision) - normDateVal(a.releaseDate, (a as any).releaseDatePrecision));
                recents[id] = { latestId: recent[0].id, latestDate: recent[0].releaseDate ?? null };
                recent.forEach((album: any) => {
                  const sid = spotifyKey(album.id ?? null, album.spotifyUrl ?? null) || String(album.id || '');
                  if (!sid) return;
                  const releaseKey = sid;
                  if (seenRelease.has(releaseKey)) return;
                  seenRelease.add(releaseKey);
                  const albumType = String(album.type || album.albumType || '').toLowerCase();
                  releases.push({
                    id: sid,
                    title: album.title,
                    artist: album.artist || details[id]?.name || fa.name || 'Unknown',
                    artistId: id,
                    releaseDate: album.releaseDate ?? null,
                    spotifyUrl: album.spotifyUrl ?? null,
                    imageUrl: album.imageUrl ?? null,
                    type: albumType === 'single' ? 'single' : albumType === 'ep' ? 'ep' : 'album',
                  });
                });
              }
            } catch (err) {
              console.log('[updates] artist albums ERROR', { artist: fa.name, id, message: String(err) });
            }
            };
            for (let index = 0; index < followed.length; index += UPDATES_SCAN_BATCH_SIZE) {
              const batch = followed.slice(index, index + UPDATES_SCAN_BATCH_SIZE);
              await Promise.all(batch.map(scanFollowedArtist));
              if (rateLimitHits >= 3) {
                await new Promise((res) => setTimeout(res, 1200));
                rateLimitHits = 0;
              }
            }
            seedFollowedItems.forEach((item) => {
              if (!item.id || !isWithinDiscoverWindow(item.latestDate ?? null, cutoffTs)) return;
              if (!recents[item.id]) recents[item.id] = { latestId: item.latestId, latestDate: item.latestDate ?? null };
              if (!details[item.id]) details[item.id] = { name: item.name || 'Unknown', imageUrl: item.imageUrl ?? null };
            });
            setFollowedDetails(details);
            setRecentByArtist(recents);
            const itemById = new Map<string, FollowedUpdateArtist>();
            seedFollowedItems.forEach((item) => {
              if (!item.id || !isWithinDiscoverWindow(item.latestDate ?? null, cutoffTs)) return;
              itemById.set(item.id, item);
            });
            Object.keys(recents || {}).forEach((id) => {
              itemById.set(id, {
                id,
                name: (details[id]?.name) ?? 'Unknown',
                imageUrl: details[id]?.imageUrl ?? null,
                latestId: recents[id]?.latestId,
                latestDate: recents[id]?.latestDate ?? null,
              });
            });
            const items = Array.from(itemById.values());
            items.sort((a,b) => {
              const ta = discoverDateTimestamp(a.latestDate ?? null);
              const tb = discoverDateTimestamp(b.latestDate ?? null);
              return tb - ta;
            });
            if (items.length) {
              setForYouItems(items);
              setFollowedArtistRows((prev) => prev.map((artist) => {
                const update = items.find((item) => item.id === artist.id);
                return update ? { ...artist, ...update } : artist;
              }));
              cacheForYou(items, FOR_YOU_UPDATES_CACHE_KEY);
            }
            const releaseByKey = new Map<string, { id: string; title: string; artist: string; artistId?: string | null; releaseDate?: string | null; spotifyUrl?: string | null; imageUrl?: string | null; type?: 'album' | 'single' | 'ep' }>();
            [...seedYourUpdatesReleases, ...releases].forEach((release) => {
              const key = spotifyKey(release.id, release.spotifyUrl ?? null) || `${release.artistId || release.artist}-${release.title}-${release.releaseDate || ''}`;
              if (!key || releaseByKey.has(key)) return;
              if (!isWithinDiscoverWindow(release.releaseDate ?? null, cutoffTs)) return;
              releaseByKey.set(key, release);
            });
            const mergedReleases = Array.from(releaseByKey.values())
              .sort((a, b) => discoverDateTimestamp(b.releaseDate ?? null) - discoverDateTimestamp(a.releaseDate ?? null));
            setYourUpdatesReleases(mergedReleases.slice(0, 60));
            updatesLastDeepScanAtRef.current = Date.now();
            if (__DEV__) {
              const sample = items.slice(0, 3);
              console.log('[updates] recents built', { total: items.length, releases: mergedReleases.length, seeded: seedFollowedItems.length, sample, cutoff: new Date(cutoffTs).toISOString().slice(0,10), artistsDebug: debugPerArtist.slice(0,5) });
            }
            if (!items.length) {
              setForYouItems([]);
            }
          }
          }
          }
        }
      } catch (err) {
        setYourUpdatesError(err);
        if (__DEV__) console.warn('[updates] load failed', err);
      }
      finally { setPickedLoading(false); setForYouLoading(false); }
      await refreshListenStatus();
    } catch (err) {
      setTopPicksError((prev: any | null) => prev ?? err);
      if (__DEV__) console.warn('[discover] load failed', err);
    }
    finally {
      setTopPicksLoading(false);
      setInitialLoading(false);
    }
  }, [cacheArtistImagesV2, debugSetNewReleases, hydrateFollowedArtistImages, refreshListenStatus]);

  useEffect(() => {
    loadRef.current = load;
  }, [debugSetNewReleases, load]);

  useEffect(() => {
    const handler = () => { load(); };
    on('feed:refresh', handler);
    return () => off('feed:refresh', handler);
  }, [debugSetNewReleases, load]);

  // Initial load with cache hydration
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(NEW_RELEASES_CACHE_KEY);
        if (raw && mounted) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed?.items)) {
            debugSetNewReleases('from cache', parsed.items);
            setInitialLoading(false);
          }
        }
      } catch {}
      // Your updates is intentionally not hydrated from cache; stale artist rows are more misleading than a short loading state.
      if (mounted) await load();
    })();
    return () => { mounted = false; };
  }, [debugSetNewReleases, load]);

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

  const resetSearchState = useCallback(() => {
    setQ('');
    setSearchRows([]);
    setArtist(null);
    setArtistAlbumsRows([]);
    setArtistTracksRows([]);
  }, []);

  const onRefresh = useCallback(async () => {
    if (offline) {
      Alert.alert('Offline', 'You are offline. Showing cached results.');
      setRefreshing(false);
      return;
    }
    if (q.trim() || searchRows.length || artist || artistAlbumsRows.length || artistTracksRows.length) {
      resetSearchState();
      Keyboard.dismiss();
    }
    setRefreshing(true);
    await load({ preserveExisting: true });
    setRefreshing(false);
  }, [artist, artistAlbumsRows.length, artistTracksRows.length, load, offline, q, resetSearchState, searchRows.length]);

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
    Keyboard.dismiss();
  };

  const onAddNew = async (a: { id: string; title: string; artist: string; releaseDate?: string | null; spotifyUrl?: string | null; imageUrl?: string | null; type?: string | null; isrc?: string | null }, stat?: { done?: boolean | undefined }) => {
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
      isrc: a.isrc ?? null,
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
      isrc: r.isrc ?? null,
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

  const artistIntentScore = (r: SpotifyResult, query: string) => {
    const label = r.title || r.artist || '';
    const nameScore = matchScore(label, query);
    const popularity = Math.max(0, Math.min(100, r.popularity || 0));
    const followerScore = Math.min(18, Math.log10(Math.max(1, (r.followers || 0) + 1)) * 2);
    const exactShortPenalty = normalize(label) === normalize(query) && popularity < 45 ? 18 : 0;
    const exactSignalBonus = normalize(label) === normalize(query) && (popularity >= 10 || (r.followers || 0) >= 1_000) ? 18 : 0;
    return nameScore + (popularity * 0.32) + followerScore + exactSignalBonus - exactShortPenalty;
  };

  // Derived, relevance-sorted search results with optional artist intent.
  const groupedSearch = useMemo(() => {
    const byRelevance = (items: SpotifyResult[]) => {
      const scored = items.map(r => {
        const label = r.title || r.artist || '';
        return { r, score: matchScore(label, q) };
      });
      scored.sort((a, b) => (b.score - a.score) || ((b.r.popularity || 0) - (a.r.popularity || 0)));
      return scored.map(s => s.r);
    };

    const music = byRelevance(searchRows.filter(r => r.type === 'track' || r.type === 'album' || (r as any).albumType === 'single' || (r as any).type === 'single')).slice(0, 10);
    const artistScores = searchRows
      .filter(r => r.type === 'artist')
      .map(r => ({
        r,
        nameScore: matchScore(r.title || r.artist || '', q),
        intentScore: artistIntentScore(r, q),
      }))
      .sort((a, b) => (b.intentScore - a.intentScore) || ((b.r.popularity || 0) - (a.r.popularity || 0)));
    const topMusicScore = music.reduce((max, r) => Math.max(max, matchScore(r.title || r.artist || '', q)), 0);
    const topArtistScore = artistScores[0]?.nameScore ?? 0;
    const topArtistIntentScore = artistScores[0]?.intentScore ?? 0;
    const hasStrongArtist = !!artistScores[0] && topArtistScore >= 85 && (topArtistScore >= topMusicScore - 10 || topArtistIntentScore >= 115);
    const strongArtists = hasStrongArtist
      ? artistScores
        .filter((s, index) => index === 0 || (s.intentScore >= topArtistIntentScore - 60 && (
          (s.nameScore >= 85 && ((s.r.popularity || 0) >= 45 || (s.r.followers || 0) >= 100_000))
          || (s.nameScore >= 70 && (s.r.popularity || 0) >= 65)
        )))
        .slice(0, 5)
        .map(s => s.r)
      : [];
    const artists = strongArtists.length
      ? []
      : artistScores.filter(s => s.intentScore >= 85 && (s.nameScore >= 60 || (s.nameScore >= 55 && (s.r.popularity || 0) >= 50))).map(s => s.r).slice(0, 5);
    return { music, strongArtists, artists };
  }, [searchRows, q]);

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log('[discover dropdown sections]', {
      strongArtists: groupedSearch.strongArtists.length,
      artists: groupedSearch.artists.length,
      music: groupedSearch.music.length,
    });
  }, [groupedSearch.artists.length, groupedSearch.music.length, groupedSearch.strongArtists.length]);

  const clearSearch = () => {
    resetSearchState();
    Keyboard.dismiss();
  };

  const hasGrouped = groupedSearch.music.length || groupedSearch.strongArtists.length || groupedSearch.artists.length;

  type SearchSection = { title: string; key: 'artist' | 'artists' | 'music'; data: SpotifyResult[] };
  const groupedSections = useMemo<SearchSection[]>(() => {
    if (!hasGrouped) return [];
    const out: SearchSection[] = [];
    if (groupedSearch.strongArtists.length) out.push({ title: groupedSearch.strongArtists.length === 1 ? 'Artist' : 'Artists', key: 'artist', data: groupedSearch.strongArtists });
    if (groupedSearch.music.length) out.push({ title: 'Music', key: 'music', data: groupedSearch.music });
    if (groupedSearch.artists.length) out.push({ title: 'Artists', key: 'artists', data: groupedSearch.artists });
    return out;
  }, [groupedSearch, hasGrouped]);

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
    <View style={{ padding: 8, backgroundColor: accentSoft, borderRadius: 10, borderWidth: 1, borderColor: colors.accent.primary, marginBottom: 10, marginHorizontal: 16 }}>
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

  const renderDebugBlock = (label: string, payload: DebugFetchResult | null) => {
    const okLabel = payload ? `${payload.status} ${payload.ok ? 'OK' : 'ERR'}` : '—';
    return (
      <View style={{ marginTop: 12, padding: 12, borderWidth: 1, borderColor: colors.border.subtle, borderRadius: 12, backgroundColor: colors.bg.muted }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <Text style={{ fontWeight: '700', color: colors.text.secondary }}>{label}</Text>
          <Pressable
            onPress={() => copyDebugBody(payload)}
            hitSlop={6}
            disabled={!payload?.body}
            style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
          >
            <Text style={{ color: payload?.body ? colors.text.secondary : colors.text.muted, fontWeight: '700' }}>Copy</Text>
          </Pressable>
        </View>
        <Text style={{ color: colors.text.muted, fontSize: 12 }}>Status: {okLabel}</Text>
        <Text style={{ color: colors.text.muted, fontSize: 12 }}>Build: {payload?.build ?? '—'}</Text>
        <Text style={{ color: colors.text.muted, fontSize: 12, marginBottom: 6 }}>URL: {payload?.url ?? '—'}</Text>
        <Text selectable style={{ fontSize: 12, color: colors.text.secondary }}>
          {payload?.body ?? 'No response yet.'}
        </Text>
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
    const releaseDateLabel = formatDate(r.releaseDate);
    return (
      <GlassCard asChild style={{ marginVertical: 4, marginHorizontal: 16, padding: 0 }}>
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
              {!!releaseDateLabel && (
                <Text style={{ color: presave ? colors.accent.success : colors.text.muted, marginTop: 2 }}>
                  {presave ? `Presave · ${releaseDateLabel}` : `Released · ${releaseDateLabel}`}
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
        <Text style={{ fontSize: 18, fontWeight: '600', marginTop: 16, marginBottom: 8, marginHorizontal: 16, color: colors.text.secondary }}>{item.title}</Text>
      );
    }
  if (item.kind === 'new') {
  const presave = !!(item.releaseDate && item.releaseDate > today);
  const stat = statusFor(item.id, item.spotifyUrl);
  const isAdded = isAddedFor(item.id, item.spotifyUrl) || !!stat;
  const label = tagLabel(stat, isAdded);
  const releaseDateLabel = formatDate(item.releaseDate);
    return (
      <GlassCard asChild style={{ marginVertical: 4, marginHorizontal: 16, padding: 0, opacity: isAdded ? 0.82 : 1 }}>
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
              {!!releaseDateLabel && (
                <Text style={{ color: presave ? colors.accent.success : colors.text.muted, marginTop: 2 }}>
                  {presave ? `Presave · ${releaseDateLabel}` : `Released · ${releaseDateLabel}`}
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

        const renderReleaseCard = (
          item: any,
          options?: { moreCount?: number; hideArtist?: boolean; onPress?: () => void }
        ) => {
          const moreCount = options?.moreCount;
          const stat = statusFor(item.id, item.spotifyUrl);
          const isAdded = isAddedFor(item.id, item.spotifyUrl) || !!stat;
          const label = tagLabel(stat, isAdded);
          const artistId = item.artistId || item.artist_id || null;
          const openRelease = () => {
            const releaseId = spotifyKey(item.id, item.spotifyUrl || item.spotify_url) || item.id;
            if (releaseId) {
              goToRelease(releaseId, {
                spotifyId: item.id ?? null,
                spotifyUrl: item.spotifyUrl ?? item.spotify_url ?? null,
                title: item.title ?? '',
                artistName: item.artist ?? '',
                imageUrl: item.imageUrl ?? null,
                type: item.type ?? null,
                artistId,
                releaseDate: item.releaseDate ?? null,
              });
              return;
            }
            setMenuRow({ ...item, artist_id: artistId, in_list: isAdded, done_at: stat?.done ? new Date().toISOString() : null } as any);
          };
          const handlePress = options?.onPress ?? openRelease;
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
                onPress={handlePress}
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
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <Text style={{ flex: 1, fontWeight: '700', color: colors.text.secondary, lineHeight: 18 }} numberOfLines={1} ellipsizeMode="tail">
                      {item.title}
                    </Text>
                    {moreCount ? (
                      <Text style={{ color: colors.text.muted, fontSize: 11, fontWeight: '600' }}>+{moreCount}</Text>
                    ) : null}
                  </View>
                  {!options?.hideArtist && !!item.artist && (
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

        const renderHeroCard = (
          item: any,
          options?: { moreCount?: number; hideArtist?: boolean; onPress?: () => void }
        ) => {
          const moreCount = options?.moreCount;
          const stat = statusFor(item.id, item.spotifyUrl);
          const isAdded = isAddedFor(item.id, item.spotifyUrl) || !!stat;
          const artistId = item.artistId || item.artist_id || null;

          const openRelease = () => {
            const releaseId = spotifyKey(item.id, item.spotifyUrl || item.spotify_url) || item.id;
            if (releaseId) {
              goToRelease(releaseId, {
                spotifyId: item.id ?? null,
                spotifyUrl: item.spotifyUrl ?? item.spotify_url ?? null,
                title: item.title ?? '',
                artistName: item.artist ?? '',
                imageUrl: item.imageUrl ?? null,
                type: item.type ?? null,
                artistId,
                releaseDate: item.releaseDate ?? null,
              });
              return;
            }
            setMenuRow({ ...item, artist_id: artistId, in_list: isAdded, done_at: stat?.done ? new Date().toISOString() : null } as any);
          };
          const handlePress = options?.onPress ?? openRelease;

          return (
            <HeroReleaseCard
              title={item.title}
              artist={options?.hideArtist ? null : item.artist || null}
              imageUrl={item.imageUrl || null}
              releaseDate={item.releaseDate ?? null}
              saved={isAdded}
              titleBadge={moreCount ? `+${moreCount}` : null}
              width={heroCardWidth}
              height={heroCardHeight}
              onPress={handlePress}
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

        const renderUpdatesPillColumns = (
          data: Array<{ item: typeof yourUpdatesVisible[number]; artistKey: string; moreCount?: number; hideArtist?: boolean; expandOnPress?: boolean }>,
          key: string
        ) => {
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
                  {page.map((entry, idx) => (
                    <React.Fragment key={entry.item?.id ?? entry.item?.spotifyUrl ?? entry.item?.title ?? `${key}-${idx}`}>
                      {renderReleaseCard(entry.item, {
                        moreCount: entry.moreCount,
                        hideArtist: entry.hideArtist,
                        onPress: entry.expandOnPress ? () => expandUpdateGroup(entry.artistKey) : undefined,
                      })}
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

        const renderUpdatesSection = (
          data: Array<{ item: typeof yourUpdatesVisible[number]; artistKey: string; moreCount?: number; hideArtist?: boolean; expandOnPress?: boolean }>,
          key: string
        ) => {
          if (!data.length) return null;
          if (viewMode === 'pills') {
            return (
              <View key={key} style={{ marginBottom: 18 }}>
                {renderUpdatesPillColumns(data, key)}
              </View>
            );
          }

          const hero = data.slice(0, getHeroCount(data.length));
          const rest = data.slice(hero.length);
          return (
            <View key={key} style={{ marginBottom: 18 }}>
              {hero.length ? (
                <FlatList
                  data={hero}
                  keyExtractor={(entry, idx) => `${key}-hero-${entry.item?.id ?? entry.item?.spotifyUrl ?? entry.item?.title}-${idx}`}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  decelerationRate="fast"
                  snapToAlignment="start"
                  snapToInterval={heroCardWidth + heroGap}
                  contentContainerStyle={{ paddingHorizontal: horizontalPad }}
                  ItemSeparatorComponent={() => <View style={{ width: heroGap }} />}
                  renderItem={({ item: entry }) => renderHeroCard(entry.item, {
                    moreCount: entry.moreCount,
                    hideArtist: entry.hideArtist,
                    onPress: entry.expandOnPress ? () => expandUpdateGroup(entry.artistKey) : undefined,
                  })}
                />
              ) : null}
              {rest.length ? <View style={{ marginTop: hero.length ? 12 : 0 }}>{renderUpdatesPillColumns(rest, `${key}-pills`)}</View> : null}
            </View>
          );
        };

        const renderSectionSkeleton = (key: string, count = 3) => (
          <View key={key} style={{ paddingHorizontal: horizontalPad, rowGap: 10, marginBottom: 8 }}>
            {Array.from({ length: count }).map((_, idx) => (
              <View key={`${key}-${idx}`} style={{ borderRadius: 16, overflow: 'hidden', backgroundColor: colors.bg.muted, height: 76 }}>
                <Shimmer size={76} borderRadius={16} />
              </View>
            ))}
          </View>
        );

        const renderInlineState = (message: string, tone: 'muted' | 'error' = 'muted', detail?: string) => (
          <View style={{ paddingHorizontal: horizontalPad, marginBottom: 8, gap: detail ? 4 : 0 }}>
            <Text
              style={{
                color: tone === 'error' ? colors.accent.primary : colors.text.muted,
                fontSize: 13,
                fontWeight: detail ? '700' : '400',
              }}
            >
              {message}
            </Text>
            {detail ? (
              <Text
                style={{
                  color: colors.text.muted,
                  fontSize: 13,
                }}
              >
                {detail}
              </Text>
            ) : null}
          </View>
        );

        const renderFollowedArtistFallback = () => (
          <View style={{ marginBottom: 8 }}>
            <FlatList
              data={followedArtists.slice(0, 24)}
              keyExtractor={(item) => `followed-update-${item.id}`}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: horizontalPad }}
              ItemSeparatorComponent={() => <View style={{ width: 10 }} />}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => openArtist(item.id, { name: item.name, highlight: item.latestId ?? null })}
                  hitSlop={8}
                  style={({ pressed }) => ({
                    width: 86,
                    alignItems: 'center',
                    opacity: pressed ? 0.88 : 1,
                  })}
                >
                  <View style={{ width: 62, height: 62, borderRadius: 31, backgroundColor: colors.bg.muted, overflow: 'hidden', borderWidth: 1, borderColor: colors.border.subtle }}>
                    {item.imageUrl ? (
                      <Image source={{ uri: item.imageUrl }} style={{ width: 62, height: 62 }} />
                    ) : (
                      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ color: colors.text.secondary, fontWeight: '900', fontSize: 18 }}>
                          {(item.name || '?').slice(0, 1).toUpperCase()}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={{ marginTop: 7, color: colors.text.secondary, fontSize: 12, fontWeight: '700', textAlign: 'center' }} numberOfLines={1}>
                    {item.name || 'Unknown'}
                  </Text>
                </Pressable>
              )}
            />
          </View>
        );

        return (
          <>
            <View key="your-updates-releases" style={{ marginBottom: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, paddingHorizontal: horizontalPad }}>
                <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text.secondary }}>
                  Your updates
                </Text>
                {freshYourUpdatesReleases.length > YOUR_UPDATES_CAP ? (
                  <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text.muted }}>
                    Latest {YOUR_UPDATES_CAP}
                  </Text>
                ) : null}
              </View>
              {yourUpdatesState.status === 'loading'
                ? renderSectionSkeleton('your-updates-loading')
                : yourUpdatesState.status === 'error'
                  ? renderInlineState('Could not load updates right now.', 'error')
                  : yourUpdatesState.status === 'empty'
                    ? followedArtists.length
                      ? renderFollowedArtistFallback()
                      : renderInlineState('No new releases in the last 14 days', 'muted')
                    : renderUpdatesSection(yourUpdatesDisplayItems, 'your-updates')}
            </View>
            <View key="top-picks" style={{ marginBottom: 16 }}>
              <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text.secondary, marginBottom: 10, paddingHorizontal: horizontalPad }}>
                Top Picks
              </Text>
              {topPicksState.status === 'loading'
                ? renderSectionSkeleton('top-picks-loading')
                : topPicksState.status === 'error'
                  ? renderInlineState('Could not load top picks right now.', 'error')
                  : topPicksState.status === 'empty'
                    ? renderInlineState('No top picks available right now.')
                    : renderSection(topPicksState.items, '', 'top-picks')}
            </View>
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
                  <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text.secondary, marginBottom: 10, paddingHorizontal: horizontalPad }}>
                    {`New ${label}`}
                  </Text>
                  {row.items.length ? (
                    renderSection(row.items, '', `genre-${row.genre}`)
                  ) : (
                    <Text style={{ color: colors.text.muted, paddingHorizontal: horizontalPad, marginBottom: 8 }}>
                      No releases yet.
                    </Text>
                  )}
                </View>
              );
            })}
          </>
        );
      })()}
      </Animated.View>
    </View>
  );

  const headerTranslateY = headerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-(DISCOVER_HEADER_HEIGHT + insets.top), 0],
  });
  const headerTop = Math.max(insets.top + 6, 12);
  const listTopPadding = headerTop + DISCOVER_HEADER_HEIGHT;

  const DiscoverHeader = (
    <Animated.View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        top: headerTop,
        left: 0,
        right: 0,
        zIndex: 20,
        opacity: headerAnim,
        transform: [{ translateY: headerTranslateY }],
      }}
    >
      <View style={{ marginHorizontal: 16, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: colors.overlay.softLight, backgroundColor: colors.bg.secondary + 'cc' }}>
        <BlurView intensity={68} tint="dark" style={{ paddingHorizontal: 10, paddingVertical: 8 }}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Search music: artists, albums, tracks"
              onSubmitEditing={onSearch}
              returnKeyType="search"
              blurOnSubmit
              placeholderTextColor={colors.text.muted}
              style={{ flex: 1, height: 42, borderWidth: 1, borderColor: colors.border.subtle, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 0, backgroundColor: colors.bg.primary, color: colors.text.secondary }}
            />
            {q.length > 0 && (
              <Pressable onPress={clearSearch} hitSlop={8} style={{ height: 42, justifyContent: 'center', paddingHorizontal: 10, backgroundColor: colors.bg.muted, borderRadius: 10 }}>
                <Text style={{ color: colors.text.secondary, fontWeight: '700' }}>Clear</Text>
              </Pressable>
            )}
            <Pressable
              onPress={toggleViewMode}
              hitSlop={8}
              style={({ pressed }) => ({
                width: 42,
                height: 42,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 10,
                backgroundColor: colors.bg.muted,
                opacity: pressed ? 0.9 : 1,
              })}
            >
              <View>
                <Ionicons
                  name={viewMode === 'mixed' ? 'albums' : 'albums-outline'}
                  size={19}
                  color={colors.text.secondary}
                />
              </View>
            </Pressable>
            <Pressable onPress={() => setFilterVisible(true)} hitSlop={8} style={{ width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: colors.bg.muted }}>
              <Ionicons name="options-outline" size={19} color={colors.text.secondary} />
            </Pressable>
          </View>
        </BlurView>
      </View>
    </Animated.View>
  );

  return (
    <Screen edges={['left', 'right']} style={{ paddingHorizontal: 0, paddingTop: 0 }}>
      {offlineBanner}
      {DiscoverHeader}
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
          contentContainerStyle={{ paddingTop: listTopPadding, paddingBottom: 112 }}
          renderSectionHeader={({ section }) => (
            <Text style={{ fontSize: 18, fontWeight: '600', marginTop: 16, marginBottom: 8, marginHorizontal: 16, color: colors.text.secondary }}>{section.title}</Text>
          )}
          renderItem={({ item }) => renderSearchRow(item)}
          onScroll={handleDiscoverScroll}
          scrollEventThrottle={16}
          keyboardDismissMode="on-drag"
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
          contentContainerStyle={{ paddingTop: listTopPadding, paddingBottom: 112 }}
          onScroll={handleDiscoverScroll}
          scrollEventThrottle={16}
          keyboardDismissMode="on-drag"
          refreshing={refreshing}
          onRefresh={onRefresh}
          keyboardShouldPersistTaps="handled"
        />
      )}
      <Modal visible={filterVisible} transparent animationType="slide" onRequestClose={() => setFilterVisible(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={() => setFilterVisible(false)} />
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16 }}>
          <GlassCard style={{ padding: 18 }}>
            <View style={{ marginBottom: 14 }}>
              <Text style={{ fontSize: 22, fontWeight: '900', color: colors.text.secondary }}>Filter Discover</Text>
              <Text style={{ color: colors.text.muted, marginTop: 4, fontSize: 13 }}>Explore ripples by genre.</Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {GENRE_OPTIONS.map((opt) => (
                <Chip
                  key={opt.key}
                  label={opt.label}
                  selected={draftGenres.has(opt.key)}
                  onPress={() => toggleDraftGenre(opt.key)}
                  style={{
                    borderWidth: 1,
                    borderColor: draftGenres.has(opt.key) ? colors.accent.primary : colors.border.subtle,
                    backgroundColor: draftGenres.has(opt.key) ? accentSoft : colors.bg.muted,
                  }}
                />
              ))}
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginTop: 18 }}>
              <Pressable
                onPress={() => {
                  setFilterVisible(false);
                  void clearGenres();
                }}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 12,
                  backgroundColor: colors.bg.muted,
                  borderWidth: 1,
                  borderColor: colors.border.subtle,
                }}
              >
                <Text style={{ textAlign: 'center', fontWeight: '800', color: colors.text.secondary }}>Reset / All</Text>
              </Pressable>
              <Pressable onPress={applyGenres} style={{ flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: colors.accent.primary }}>
                <Text style={{ textAlign: 'center', fontWeight: '800', color: colors.text.inverted }}>Apply</Text>
              </Pressable>
            </View>
          </GlassCard>
        </View>
      </Modal>
      {__DEV__ && (
        <Modal visible={debugVisible} transparent animationType="slide" onRequestClose={() => setDebugVisible(false)}>
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={() => setDebugVisible(false)} />
          <View style={{ position: 'absolute', left: 0, right: 0, top: 40, bottom: 40, padding: 16 }}>
            <GlassCard style={{ flex: 1, padding: 12 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text.secondary }}>Discover Debug</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Pressable
                    onPress={runDebugFetch}
                    hitSlop={6}
                    style={({ pressed }) => ({
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderRadius: 8,
                      backgroundColor: colors.bg.muted,
                      opacity: pressed ? 0.9 : 1,
                    })}
                  >
                    <Text style={{ color: colors.text.secondary, fontWeight: '700', fontSize: 12 }}>Refresh</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setDebugVisible(false)}
                    hitSlop={6}
                    style={({ pressed }) => ({
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderRadius: 8,
                      backgroundColor: colors.bg.muted,
                      opacity: pressed ? 0.9 : 1,
                    })}
                  >
                    <Text style={{ color: colors.text.secondary, fontWeight: '700', fontSize: 12 }}>Close</Text>
                  </Pressable>
                </View>
              </View>
              {debugBusy ? (
                <View style={{ paddingVertical: 6 }}>
                  <ActivityIndicator />
                </View>
              ) : null}
              <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
                {renderDebugBlock('Top picks (/spotify-search/top-picks)', debugWide)}
                {renderDebugBlock('Genres (rap,pop)', debugGenre)}
              </ScrollView>
            </GlassCard>
          </View>
        </Modal>
      )}
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
