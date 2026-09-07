import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, FlatList, Image, LayoutAnimation, Platform, Pressable, ScrollView, SectionList, Text, UIManager, View } from 'react-native';
import Avatar from '../../components/Avatar';
import { H } from '../../components/haptics';
import Screen from '../../components/Screen';
import Snackbar from '../../components/Snackbar';
import Chip from '../../components/Chip';
import StatusMenu from '../../components/StatusMenu';
import FeedHeader, { type FeedMode } from '../../components/feed/FeedHeader';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDate } from '../../lib/date';
import { discoverReleaseDateTimestamp } from '../../lib/discoverFreshness';
import { off, on } from '../../lib/events';
import { FN_BASE, fetchFn } from '../../lib/fnBase';
import { fetchFeedForArtists, listFollowedArtists, type FeedItem } from '../../lib/follow';
import { addToListFromSearch, fetchListenList, removeListen } from '../../lib/listen';
import { parseSpotifyUrlOrId } from '../../lib/spotify';
import { goToRelease } from '../../lib/navigation';
import { fetchSocialActivity } from '../../lib/profileSocial';
import { useSession } from '../../lib/session';
import { RELEASE_LONG_PRESS_MS } from '../../hooks/useReleaseActions';
import { useTheme } from '../../theme/useTheme';

type Item = FeedItem;
type SocialActivityKind = 'listened' | 'rated' | 'marked_listened';
type SocialActivityItem = {
  id: string;
  kind: SocialActivityKind;
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

const extractAppleId = (value?: string | null) => {
  if (!value) return null;
  if (/^\d+$/.test(value)) return value;
  try {
    const u = new URL(value);
    const qId = u.searchParams.get('i');
    if (qId && /^\d+$/.test(qId)) return qId;
    const album = u.pathname.match(/\/album\/[^/]+\/(\d+)/);
    if (album?.[1]) return album[1];
    const song = u.pathname.match(/\/song\/[^/]+\/(\d+)/);
    if (song?.[1]) return song[1];
  } catch {}
  return null;
};

const FEED_MODE_KEY = (uid: string) => `wavemark:feed-mode:${uid}`;

const spotifyAlbumIdForFeedItem = (item: Item): string | null => {
  const match = item.spotify_url?.match(/open\.spotify\.com\/album\/([A-Za-z0-9]{22})/i);
  if (match?.[1]) return match[1];
  const candidate = item.spotify_id ?? item.provider_id ?? null;
  return typeof candidate === 'string' && /^[A-Za-z0-9]{22}$/.test(candidate) ? candidate : null;
};

const feedReleaseTimestamp = (item: Item): number => (
  discoverReleaseDateTimestamp(
    item.release_date ?? null,
    (item as any).release_date_precision ?? null
  )
);

const prepareFeedRows = (items: Item[]): Item[] => {
  const byRelease = new Map<string, Item>();
  (items || []).forEach((item) => {
    const spotifyAlbumId = spotifyAlbumIdForFeedItem(item);
    const key = spotifyAlbumId ? `spotify:${spotifyAlbumId}` : `row:${item.id}`;
    const existing = byRelease.get(key);
    if (!existing || feedReleaseTimestamp(item) > feedReleaseTimestamp(existing)) {
      byRelease.set(key, item);
    }
  });
  return Array.from(byRelease.values()).sort((a, b) => (
    feedReleaseTimestamp(b) - feedReleaseTimestamp(a)
  ));
};

export default function FeedTab() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useSession();
  const SOCIAL_HEADER_HEIGHT = 44;
  const STICKY_CONTROLS_THRESHOLD = 154;
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Item[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [added, setAdded] = useState<Record<string, boolean>>({});
  const [mode, setMode] = useState<FeedMode>('artist');
  const [modeHydrated, setModeHydrated] = useState(false);
  const [socialLoading, setSocialLoading] = useState(false);
  const [socialRows, setSocialRows] = useState<SocialActivityItem[]>([]);
  const [socialRefreshing, setSocialRefreshing] = useState(false);
  const [socialError, setSocialError] = useState<string | null>(null);
  const [expandedSocialGroupIds, setExpandedSocialGroupIds] = useState<Set<string>>(() => new Set());
  const [followedCount, setFollowedCount] = useState<number | null>(null);
  const [filter, setFilter] = useState<'all' | 'album' | 'single' | 'new'>('all');
  const [doneKeys, setDoneKeys] = useState<string[]>([]);
  const [inListKeys, setInListKeys] = useState<string[]>([]);
  const [menuRow, setMenuRow] = useState<any | null>(null);
  const [stickyControlsVisible, setStickyControlsVisible] = useState(false);
  const [snack, setSnack] = useState<{ visible: boolean; message: string; listenId?: string | null; feedId?: string | null }>({ visible: false, message: '', listenId: null, feedId: null });
  const artistListRef = useRef<any>(null);
  const socialListRef = useRef<any>(null);
  const artistScrollOffsetRef = useRef(0);
  const socialScrollOffsetRef = useRef(0);
  const restoreTargetRef = useRef<{ mode: FeedMode | null; offset: number }>({ mode: null, offset: 0 });
  const rowsRef = useRef<Item[]>([]);
  const socialRowsRef = useRef<SocialActivityItem[]>([]);
  const socialAutoExpandedRef = useRef(false);
  const accentSoft = colors.accent.primary + '1a';

  useEffect(() => { rowsRef.current = rows; }, [rows]);
  useEffect(() => { socialRowsRef.current = socialRows; }, [socialRows]);
  useEffect(() => {
    if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const uid = user?.id;
      setMode('artist');
      setModeHydrated(false);
      if (!uid) return;
      try {
        const raw = await AsyncStorage.getItem(FEED_MODE_KEY(uid));
        if (!mounted) return;
        if (raw === 'artist' || raw === 'social') setMode(raw);
        else setMode('artist');
      } finally {
        if (mounted) setModeHydrated(true);
      }
    })();
    return () => { mounted = false; };
  }, [user?.id]);

  useEffect(() => {
    const uid = user?.id;
    if (!uid || !modeHydrated) return;
    AsyncStorage.setItem(FEED_MODE_KEY(uid), mode).catch(() => {});
  }, [mode, modeHydrated, user?.id]);

  const onChangeMode = useCallback((next: FeedMode) => {
    setMode(next);
  }, []);

  const scrollToOffset = useCallback((listRef: any, offset: number) => {
    const inst = listRef?.current;
    if (!inst) return false;
    if (typeof inst.scrollToOffset === 'function') {
      inst.scrollToOffset({ offset, animated: false });
      return true;
    }
    const responder = inst.getScrollResponder?.();
    if (responder?.scrollTo) {
      responder.scrollTo({ y: offset, animated: false });
      return true;
    }
    return false;
  }, []);

  const attemptRestoreScroll = useCallback(() => {
    const target = restoreTargetRef.current;
    if (!target.mode) return;
    if (target.mode === 'artist') {
      if (loading) return;
      if (scrollToOffset(artistListRef, target.offset)) restoreTargetRef.current = { mode: null, offset: 0 };
      return;
    }
    if (socialLoading) return;
    if (scrollToOffset(socialListRef, target.offset)) restoreTargetRef.current = { mode: null, offset: 0 };
  }, [loading, scrollToOffset, socialLoading]);

  // Preserve scroll position per mode when switching.
  useEffect(() => {
    const nextOffset = mode === 'artist' ? artistScrollOffsetRef.current : socialScrollOffsetRef.current;
    restoreTargetRef.current = { mode, offset: nextOffset };
    const id = requestAnimationFrame(() => attemptRestoreScroll());
    return () => cancelAnimationFrame(id);
  }, [attemptRestoreScroll, mode]);

  // If data finishes loading after a mode switch, restore again once the list can actually scroll.
  useEffect(() => {
    if (restoreTargetRef.current.mode === mode) attemptRestoreScroll();
  }, [attemptRestoreScroll, loading, mode, socialLoading]);

  const load = useCallback(async (opts?: { showLoading?: boolean }) => {
    const showLoading = opts?.showLoading ?? rowsRef.current.length === 0;
    if (showLoading) setLoading(true);
    try {
      const [followed, listenRows] = await Promise.all([listFollowedArtists().catch(() => []), fetchListenList().catch(() => [])]);
      const artistIds = (followed || []).map((a) => a.id).filter(Boolean);
      setFollowedCount(artistIds.length);
      const data = artistIds.length ? await fetchFeedForArtists({ artistIds }) : [];
      const done = new Set<string>();
      const inList = new Set<string>();
      listenRows.filter(r => !!r.done_at).forEach((r) => {
        if (r.spotify_url) done.add(r.spotify_url);
        if (r.apple_url) done.add(r.apple_url);
        if (r.title && r.artist_name) done.add(`${r.title}__${r.artist_name}`);
      });
      (listenRows || []).forEach((r) => {
        if (r.spotify_url) inList.add(r.spotify_url);
        if (r.apple_url) inList.add(r.apple_url);
        if (r.provider_id) inList.add(String(r.provider_id));
        if ((r as any).spotify_id) inList.add(String((r as any).spotify_id));
        if (r.title && r.artist_name) inList.add(`${r.title}__${r.artist_name}`);
      });
      setDoneKeys(Array.from(done));
      setInListKeys(Array.from(inList));
      setRows(prepareFeedRows(data));
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  const loadSocial = useCallback(async (opts?: { showLoading?: boolean }) => {
    const showLoading = opts?.showLoading ?? socialRowsRef.current.length === 0;
    if (showLoading) setSocialLoading(true);
    setSocialError(null);
    try {
      const items = await fetchSocialActivity();
      setSocialRows(items.map((it) => ({
        id: it.id,
        kind: it.kind,
        actorId: it.actorId,
        actorName: it.actorName,
        actorUsername: it.actorUsername ?? null,
        actorAvatarUrl: it.actorAvatarUrl ?? null,
        createdAt: it.createdAt,
        title: it.title,
        artistName: it.artistName ?? null,
        rating: it.rating ?? null,
        spotifyUrl: it.spotifyUrl ?? null,
        appleUrl: it.appleUrl ?? null,
        artworkUrl: it.artworkUrl ?? null,
        itemType: it.itemType ?? null,
      })));
    } catch (e: any) {
      const msg = String(e?.message || '');
      setSocialRows([]);
      setSocialError(msg || 'Could not load social activity');
    } finally {
      if (showLoading) setSocialLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  // Auto-refresh whenever the tab gains focus
  useFocusEffect(useCallback(() => {
    // Keep existing content visible; refresh in the background.
    load({ showLoading: false });
    loadSocial({ showLoading: false });
  }, [load, loadSocial]));
  useEffect(() => {
    const handler = () => load();
    on('feed:refresh', handler);
    return () => off('feed:refresh', handler);
  }, [load]);

  useEffect(() => { loadSocial(); }, [loadSocial]);
  // Helpers
  const todayStr = new Date().toISOString().slice(0, 10);
  const yesterdayStr = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const isNew = (d?: string | null) => {
    if (!d) return false;
    const ts = discoverReleaseDateTimestamp(d);
    if (!ts) return false;
    const ms = Date.now() - ts;
    const days = ms / (24 * 60 * 60 * 1000);
    return days >= 0 && days < 7;
  };
  const labelForDate = (d?: string | null) => {
    if (!d) return 'Unknown date';
    if (d === todayStr) return 'Today';
    if (d === yesterdayStr) return 'Yesterday';
    return formatDate(d);
  };
  const itemTypeOf = (r: Item): 'album' | 'single' | null => {
    const raw = (r as any).item_type ?? (r as any).release_type ?? null;
    const t = typeof raw === 'string' ? raw.toLowerCase() : '';
    if (t === 'album') return 'album';
    if (t === 'single') return 'single';
    return null;
  };
  const filteredRows = useMemo(() => rows.filter(r => {
    if (filter === 'all') return true;
    if (filter === 'new') return isNew(r.release_date);
    return itemTypeOf(r) === filter;
  }), [rows, filter]);
  const doneSet = useMemo(() => new Set(doneKeys), [doneKeys]);
  const inListSet = useMemo(() => new Set(inListKeys), [inListKeys]);
  const remainingCount = useMemo(() => filteredRows.filter((r) => {
    const key = r.spotify_url ?? (r.title && r.artist_name ? `${r.title}__${r.artist_name}` : null);
    if (!key) return true;
    return !doneSet.has(key);
  }).length, [filteredRows, doneSet]);
  const sections = useMemo(() => {
    const byDay = new Map<string, Item[]>();
    for (const r of filteredRows) {
      const key = r.release_date ?? 'Unknown date';
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push(r);
    }
    // sort section keys by date desc; unknown at end
    const keys = Array.from(byDay.keys());
    keys.sort((a, b) => {
      if (a === 'Unknown date') return 1;
      if (b === 'Unknown date') return -1;
      return discoverReleaseDateTimestamp(b) - discoverReleaseDateTimestamp(a);
    });
    return keys.map(k => ({ title: labelForDate(k === 'Unknown date' ? null : k), data: byDay.get(k)! }));
  }, [filteredRows]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await runCheckerNow();
      await load();
    } finally {
      setRefreshing(false);
    }
  }, []);

  const onRefreshSocial = useCallback(async () => {
    setSocialRefreshing(true);
    socialAutoExpandedRef.current = false;
    setExpandedSocialGroupIds(new Set());
    try {
      await loadSocial();
    } finally {
      setSocialRefreshing(false);
    }
  }, [loadSocial]);

  const onAdd = async (r: Item) => {
    const itemType = itemTypeOf(r);
    const res = await addToListFromSearch({
      // Store singles as tracks to satisfy DB constraint on item_type
      type: itemType === 'album' ? 'album' : 'track',
      title: r.title,
      artist: r.artist_name ?? null,
      releaseDate: r.release_date ?? null,
      spotifyUrl: r.spotify_url ?? null,
      appleUrl: r.apple_url ?? null,
      artworkUrl: r.artwork_url ?? null,
      providerId: (r as any).provider_id ?? r.spotify_id ?? (r as any).apple_id ?? (r as any).external_id ?? null,
    });
    if (res.ok) {
      H.success();
      setAdded(prev => ({ ...prev, [r.id]: true }));
      setSnack({
        visible: true,
        message: `Added ${r.title}`,
        listenId: res.id ?? null,
        feedId: r.id,
      });
    } else {
      H.error();
      Alert.alert(res.message || 'Could not add');
    }
  };

  const runCheckerNow = async () => {
    try {
      // Best-effort: triggers the server-side “check new releases” job.
      // Uses a safe fallback base URL (see `lib/fnBase.ts`) so pull-to-refresh doesn’t pop alerts when env is missing.
      await fetchFn(`${FN_BASE}/check-new-releases`);
    } catch {
      // Silent failure; the feed will still refresh from whatever is already in `new_release_feed`.
    }
  };

  const newCount = useMemo(() => filteredRows.filter(r => isNew(r.release_date)).length, [filteredRows]);
  const localDateKeyFromDate = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  const localDateKeyFromIso = (iso: string) => {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return localDateKeyFromDate(new Date());
    return localDateKeyFromDate(new Date(t));
  };
  const dateFromKey = (key: string) => {
    const [y, m, d] = key.split('-').map((n) => parseInt(n, 10));
    if (!y || !m || !d) return new Date();
    return new Date(y, m - 1, d);
  };
  const todayKey = useMemo(() => localDateKeyFromDate(new Date()), []);
  const yesterdayKey = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return localDateKeyFromDate(d);
  }, []);
  const labelForSocialDateKey = useCallback((key: string) => {
    if (key === todayKey) return 'Today';
    if (key === yesterdayKey) return 'Yesterday';
    const d = dateFromKey(key);
    return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
  }, [todayKey, yesterdayKey]);

  type SocialGroup = {
    id: string;
    friendId: string;
    friendName: string;
    friendUsername: string | null;
    friendAvatarUrl: string | null;
    dateKey: string;
    dateLabel: string;
    latestTs: number;
    items: SocialActivityItem[];
    listenedCount: number;
    ratedCount: number;
  };
  type SocialFeedRow =
    | { kind: 'separator'; id: string; label: string }
    | { kind: 'group'; id: string; group: SocialGroup };

  const socialFeedRows = useMemo<SocialFeedRow[]>(() => {
    if (!socialRows.length) return [];
    const byKey = new Map<string, SocialGroup>();

    for (const it of socialRows) {
      const friendId = String(it.actorId || '');
      if (!friendId) continue;
      const dateKey = localDateKeyFromIso(it.createdAt);
      const groupKey = `${friendId}:${dateKey}`;
      const ts = Date.parse(it.createdAt);
      const latestTs = Number.isNaN(ts) ? Date.now() : ts;

      const existing = byKey.get(groupKey);
      if (!existing) {
        byKey.set(groupKey, {
          id: groupKey,
          friendId,
          friendName: it.actorName || 'Listener',
          friendUsername: it.actorUsername ?? null,
          friendAvatarUrl: it.actorAvatarUrl ?? null,
          dateKey,
          dateLabel: labelForSocialDateKey(dateKey),
          latestTs,
          items: [it],
          listenedCount: it.kind === 'rated' ? 0 : 1,
          ratedCount: it.kind === 'rated' ? 1 : 0,
        });
      } else {
        existing.items.push(it);
        existing.latestTs = Math.max(existing.latestTs, latestTs);
        if (it.kind === 'rated') existing.ratedCount += 1;
        else existing.listenedCount += 1;
      }
    }

    const byDate = new Map<string, SocialGroup[]>();
    for (const g of byKey.values()) {
      if (!byDate.has(g.dateKey)) byDate.set(g.dateKey, []);
      g.items.sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
      byDate.get(g.dateKey)!.push(g);
    }

    const dateKeys = Array.from(byDate.keys());
    dateKeys.sort((a, b) => dateFromKey(b).getTime() - dateFromKey(a).getTime());

    const out: SocialFeedRow[] = [];
    for (const dk of dateKeys) {
      const label = labelForSocialDateKey(dk);
      out.push({ kind: 'separator', id: `sep:${dk}`, label });
      const groups = (byDate.get(dk) || []).slice();
      groups.sort((a, b) => b.latestTs - a.latestTs || a.friendName.localeCompare(b.friendName));
      for (const g of groups) out.push({ kind: 'group', id: g.id, group: g });
    }
    return out;
  }, [labelForSocialDateKey, socialRows]);

  const summaryLineForGroup = (g: SocialGroup) => {
    const listened = g.listenedCount;
    const rated = g.ratedCount;
    const listenedItems = g.items.filter((x) => x.kind !== 'rated');
    const trackCount = listenedItems.filter((x) => x.itemType === 'track').length;
    const albumCount = listenedItems.filter((x) => x.itemType === 'album').length;
    const noun = albumCount > 0 && trackCount > 0
      ? (listened === 1 ? 'item' : 'items')
      : albumCount > 0
        ? (listened === 1 ? 'album' : 'albums')
        : (listened === 1 ? 'track' : 'tracks');
    const listenedPart = listened > 0 ? `Listened to ${listened} ${noun}` : '';
    const ratedPart = rated > 0 ? `Rated ${rated}` : '';
    if (listenedPart && ratedPart) return `${listenedPart} · ${ratedPart}`;
    return listenedPart || ratedPart || 'Activity';
  };

  const ratingStarsFor = (rating?: number | null) => {
    if (typeof rating !== 'number' || Number.isNaN(rating)) return null;
    const bounded = Math.max(0, Math.min(10, rating));
    const stars = Math.max(0, Math.min(5, Math.round(bounded / 2)));
    return `${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}`;
  };

  const contextLineForItem = (item: SocialActivityItem) => {
    if (item.kind === 'rated') {
      const stars = ratingStarsFor(item.rating);
      return stars ? `Rated ${stars}` : 'Rated';
    }
    return 'Listened to';
  };

  const socialItemKey = useCallback((item: SocialActivityItem) => {
    if (item.spotifyUrl) return item.spotifyUrl;
    if (item.appleUrl) return item.appleUrl;
    if (item.title && item.artistName) return `${item.title}__${item.artistName}`;
    return item.id;
  }, []);

  const onAddSocial = useCallback(async (item: SocialActivityItem) => {
    const key = socialItemKey(item);
    if (key && inListSet.has(key)) return;
    const itemType =
      item.itemType ??
      (item.spotifyUrl && /open\.spotify\.com\/album\//.test(item.spotifyUrl) ? 'album' : 'track');
    const providerId =
      parseSpotifyUrlOrId(item.spotifyUrl || '')?.id ||
      extractAppleId(item.appleUrl) ||
      null;
    const res = await addToListFromSearch({
      type: itemType === 'album' ? 'album' : 'track',
      title: item.title,
      artist: item.artistName ?? null,
      releaseDate: null,
      spotifyUrl: item.spotifyUrl ?? null,
      appleUrl: item.appleUrl ?? null,
      artworkUrl: item.artworkUrl ?? null,
      providerId,
    });
    if (res.ok) {
      H.success();
      if (key) setInListKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
      setSnack({
        visible: true,
        message: `Added ${item.title}`,
        listenId: res.id ?? null,
        feedId: null,
      });
    } else {
      H.error();
      Alert.alert(res.message || 'Could not add');
    }
  }, [inListSet, socialItemKey]);

  const openSocialItemMenu = useCallback((item: SocialActivityItem) => {
    const provider: 'spotify' | 'apple' = item.appleUrl && !item.spotifyUrl ? 'apple' : 'spotify';
    const itemType =
      item.itemType ??
      (item.spotifyUrl && /open\.spotify\.com\/album\//.test(item.spotifyUrl) ? 'album' : 'track');
    const fallbackId = item.spotifyUrl || item.appleUrl || `social:${item.id}`;

    setMenuRow({
      id: fallbackId,
      item_type: itemType,
      provider,
      title: item.title || 'Untitled',
      artist_name: item.artistName ?? null,
      spotify_url: item.spotifyUrl ?? null,
      apple_url: item.appleUrl ?? null,
      artwork_url: item.artworkUrl ?? null,
      rating: item.rating ?? null,
    });
  }, [setMenuRow]);

  const openSocialItem = useCallback((item: SocialActivityItem) => {
    const spotifyId = item.spotifyId || parseSpotifyUrlOrId(item.spotifyUrl || '')?.id || (item.provider === 'spotify' ? item.providerId : null);
    const appleId = item.appleId || extractAppleId(item.appleUrl) || (item.provider === 'apple' ? item.providerId : null);
    const provider = item.provider || (appleId && !spotifyId ? 'apple' : 'spotify');
    const releaseId = (provider === 'apple' ? appleId : spotifyId) || item.id;
    goToRelease(releaseId, {
      provider,
      spotifyId,
      spotifyUrl: item.spotifyUrl,
      appleId,
      appleUrl: item.appleUrl,
      title: item.title,
      artistName: item.artistName,
      imageUrl: item.artworkUrl,
      releaseDate: item.releaseDate,
      type: item.itemType,
    });
  }, []);

  const toggleExpandedGroup = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedSocialGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const socialGroupIds = useMemo(
    () => socialFeedRows.filter((r) => r.kind === 'group').map((r) => (r as any).group.id as string),
    [socialFeedRows],
  );
  useEffect(() => {
    if (mode !== 'social' || socialAutoExpandedRef.current || !socialGroupIds[0]) return;
    socialAutoExpandedRef.current = true;
    setExpandedSocialGroupIds(new Set([socialGroupIds[0]]));
  }, [mode, socialGroupIds]);
  const expandedCount = useMemo(
    () => socialGroupIds.reduce((acc, id) => acc + (expandedSocialGroupIds.has(id) ? 1 : 0), 0),
    [expandedSocialGroupIds, socialGroupIds],
  );
  const allExpanded = socialGroupIds.length > 0 && expandedCount === socialGroupIds.length;
  const hasSocialGroups = socialGroupIds.length > 0;
  const hasExpandableGroups = socialGroupIds.length > 1;
  const expandAll = useCallback(() => {
    if (!hasSocialGroups) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedSocialGroupIds(new Set(socialGroupIds));
  }, [hasSocialGroups, socialGroupIds]);
  const collapseAll = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedSocialGroupIds(new Set());
  }, []);

  const updateStickyControls = useCallback((offset: number) => {
    const next = offset > STICKY_CONTROLS_THRESHOLD;
    setStickyControlsVisible((current) => (current === next ? current : next));
  }, []);

  const SocialGroupCard = ({ group, expanded }: { group: SocialGroup; expanded: boolean }) => {
    const opacity = useRef(new Animated.Value(expanded ? 1 : 0)).current;
    useEffect(() => {
      Animated.timing(opacity, { toValue: expanded ? 1 : 0, duration: 170, useNativeDriver: true }).start();
    }, [expanded, opacity]);

    const listenedItems = useMemo(() => group.items.filter((x) => x.kind !== 'rated'), [group.items]);
    const ratedItems = useMemo(() => group.items.filter((x) => x.kind === 'rated'), [group.items]);

    return (
      <View style={{ marginHorizontal: 2, borderBottomWidth: 1, borderBottomColor: colors.border.subtle }}>
        <View style={{ paddingVertical: 15 }}>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={group.friendUsername ? `Open @${group.friendUsername}'s profile` : `${group.friendName}: ${summaryLineForGroup(group)}`}
              onPress={() => {
                if (group.friendUsername) {
                  router.push({ pathname: '/profile/listener/[username]', params: { username: group.friendUsername } });
                } else {
                  toggleExpandedGroup(group.id);
                }
              }}
              style={({ pressed }) => ({ flex: 1, flexDirection: 'row', gap: 12, alignItems: 'center', opacity: pressed ? 0.84 : 1 })}
            >
              <Avatar uri={group.friendAvatarUrl} size={42} borderColor={colors.border.subtle} backgroundColor={colors.bg.muted} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: colors.text.secondary, fontWeight: '900', fontSize: 16 }} numberOfLines={1}>
                  {group.friendName}
                </Text>
                <Text style={{ marginTop: 3, color: colors.text.muted, fontWeight: '700' }} numberOfLines={1}>
                  {group.friendUsername ? `@${group.friendUsername} · ` : ''}{summaryLineForGroup(group)}
                </Text>
              </View>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} ${group.friendName}'s activity`}
              onPress={() => toggleExpandedGroup(group.id)}
              hitSlop={8}
              style={({ pressed }) => ({ width: 38, height: 38, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}
            >
              <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.text.muted as any} />
            </Pressable>
          </View>

          <Animated.View style={{ opacity, height: expanded ? undefined : 0, overflow: 'hidden' }}>
            <View style={{ marginTop: 10, gap: 16 }}>
              {listenedItems.length > 0 && (
                <View>
                  <Text style={{ marginBottom: 3, color: colors.text.muted, fontSize: 11, fontWeight: '900', letterSpacing: 0.8, textTransform: 'uppercase' }}>Listened to</Text>
                  <View>
                    {listenedItems.map((it) => {
                      const key = socialItemKey(it);
                      const isInList = !!(key && inListSet.has(key));
                      return (
                      <Pressable
                        key={it.id}
                        onPress={() => openSocialItem(it)}
                        onLongPress={() => openSocialItemMenu(it)}
                        delayLongPress={RELEASE_LONG_PRESS_MS}
                        style={({ pressed }) => ({
                          width: '100%',
                          paddingVertical: 11,
                          borderTopWidth: 1,
                          borderTopColor: colors.border.subtle,
                          opacity: pressed ? 0.9 : 1,
                          transform: [{ scale: pressed ? 0.992 : 1 }],
                        })}
                      >
                        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                          <View style={{ width: 52, height: 52, borderRadius: 10, overflow: 'hidden', backgroundColor: colors.bg.muted }}>
                            {!!it.artworkUrl ? (
                              <Image source={{ uri: it.artworkUrl }} style={{ width: 52, height: 52 }} />
                            ) : (
                              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                                <Text style={{ color: colors.text.muted, fontWeight: '900' }}>♪</Text>
                              </View>
                            )}
                          </View>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={{ color: colors.text.secondary, fontWeight: '800', fontSize: 14 }} numberOfLines={1} ellipsizeMode="tail">
                              {it.title || 'Untitled'}
                            </Text>
                            {!!it.artistName && (
                                <Text style={{ marginTop: 2, color: colors.text.muted, fontSize: 12 }} numberOfLines={1} ellipsizeMode="tail">
                                {it.artistName}
                              </Text>
                            )}
                            <View style={{ marginTop: 5, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                              <Text style={{ color: colors.text.muted, fontSize: 11 }}>
                                {contextLineForItem(it)}
                              </Text>
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={isInList ? 'Added to listen list' : 'Add to listen list'}
                                accessibilityState={{ disabled: isInList }}
                                onPress={(e) => {
                                  (e as any)?.stopPropagation?.();
                                  (e as any)?.preventDefault?.();
                                  onAddSocial(it);
                                }}
                                disabled={isInList}
                                style={(state) => {
                                  const focused = 'focused' in state && !!state.focused;
                                  return {
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    gap: 4,
                                    paddingHorizontal: 8,
                                    paddingVertical: 4,
                                    borderRadius: 999,
                                    borderWidth: 1,
                                    borderColor: focused ? colors.accent.primary : colors.border.subtle,
                                    backgroundColor: isInList ? colors.bg.muted : 'transparent',
                                    opacity: state.pressed ? 0.8 : (isInList ? 0.6 : 1),
                                  };
                                }}
                              >
                                <Ionicons name={isInList ? 'checkmark' : 'add'} size={12} color={colors.text.secondary as any} />
                                <Text style={{ color: colors.text.secondary, fontSize: 10, fontWeight: '800' }}>
                                  {isInList ? 'Added' : 'Add'}
                                </Text>
                              </Pressable>
                            </View>
                          </View>
                        </View>
                      </Pressable>
                    )})}
                  </View>
                </View>
              )}

              {ratedItems.length > 0 && (
                <View>
                  <Text style={{ marginBottom: 3, color: colors.text.muted, fontSize: 11, fontWeight: '900', letterSpacing: 0.8, textTransform: 'uppercase' }}>Rated</Text>
                  <View>
                    {ratedItems.map((it) => {
                      const key = socialItemKey(it);
                      const isInList = !!(key && inListSet.has(key));
                      return (
                      <Pressable
                        key={it.id}
                        onPress={() => openSocialItem(it)}
                        onLongPress={() => openSocialItemMenu(it)}
                        delayLongPress={RELEASE_LONG_PRESS_MS}
                        style={({ pressed }) => ({
                          flexDirection: 'row',
                          gap: 12,
                          alignItems: 'center',
                          paddingVertical: 11,
                          borderTopWidth: 1,
                          borderTopColor: colors.border.subtle,
                          opacity: pressed ? 0.9 : 1,
                          transform: [{ scale: pressed ? 0.992 : 1 }],
                        })}
                      >
                        <View style={{ width: 38, height: 38, borderRadius: 10, overflow: 'hidden', backgroundColor: colors.bg.muted }}>
                          {!!it.artworkUrl && <Image source={{ uri: it.artworkUrl }} style={{ width: 38, height: 38 }} />}
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={{ color: colors.text.secondary, fontWeight: '800' }} numberOfLines={1} ellipsizeMode="tail">
                            {it.title || 'Untitled'}
                          </Text>
                          {!!it.artistName && (
                            <Text style={{ marginTop: 2, color: colors.text.muted }} numberOfLines={1} ellipsizeMode="tail">
                              {it.artistName}
                            </Text>
                          )}
                          <Text style={{ marginTop: 2, color: colors.text.muted, fontSize: 11 }}>
                            {contextLineForItem(it)}
                          </Text>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          {typeof it.rating === 'number' && (
                            <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.bg.muted, borderWidth: 1, borderColor: colors.border.subtle }}>
                              <Text style={{ color: colors.text.secondary, fontWeight: '900', fontSize: 12 }}>{it.rating}/10</Text>
                            </View>
                          )}
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={isInList ? 'Added to listen list' : 'Add to listen list'}
                            accessibilityState={{ disabled: isInList }}
                            onPress={(e) => {
                              (e as any)?.stopPropagation?.();
                              (e as any)?.preventDefault?.();
                              onAddSocial(it);
                            }}
                            disabled={isInList}
                            style={(state) => {
                              const focused = 'focused' in state && !!state.focused;
                              return {
                                flexDirection: 'row',
                                alignItems: 'center',
                                gap: 6,
                                paddingHorizontal: 10,
                                paddingVertical: 6,
                                borderRadius: 999,
                                borderWidth: 1,
                                borderColor: focused ? colors.accent.primary : colors.border.subtle,
                                backgroundColor: isInList ? colors.bg.muted : 'transparent',
                                opacity: state.pressed ? 0.85 : (isInList ? 0.6 : 1),
                              };
                            }}
                          >
                            <Ionicons name={isInList ? 'checkmark' : 'add'} size={12} color={colors.text.secondary as any} />
                            <Text style={{ color: colors.text.secondary, fontWeight: '800', fontSize: 11 }}>
                              {isInList ? 'Added' : 'Add'}
                            </Text>
                          </Pressable>
                        </View>
                      </Pressable>
                    )})}
                  </View>
                </View>
              )}
            </View>
          </Animated.View>
        </View>
      </View>
    );
  };

  const filterOptions = [
    { key: 'all', label: 'All' },
    { key: 'new', label: 'New this week' },
    { key: 'album', label: 'Albums & EPs' },
    { key: 'single', label: 'Singles' },
  ];

  const renderModeSwitch = (compact = false) => (
    <View style={{
      flexDirection: 'row',
      padding: compact ? 2 : 3,
      borderRadius: compact ? 12 : 13,
      backgroundColor: colors.bg.muted,
      borderWidth: 1,
      borderColor: colors.border.subtle,
      gap: compact ? 3 : 4,
    }}>
      {([
        { key: 'artist', label: 'Releases' },
        { key: 'social', label: 'Following' },
      ] as const).map(({ key, label }) => {
        const selected = mode === key;
        return (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => {
              if (mode === key) return;
              H.tap();
              onChangeMode(key);
            }}
            style={({ pressed }) => ({
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <View style={{
              minWidth: compact ? 76 : 0,
              paddingHorizontal: compact ? 12 : 14,
              paddingVertical: compact ? 7 : 8,
              borderRadius: compact ? 10 : 11,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: selected ? colors.accent.primary : 'transparent',
            }}>
              <Text style={{ color: selected ? colors.text.inverted : colors.text.secondary, fontWeight: '800', fontSize: compact ? 12 : 13 }}>{label}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );

  const renderCompactControls = () => (
    <View style={{
      backgroundColor: `${colors.bg.primary}ee`,
      borderWidth: 1,
      borderColor: colors.border.subtle,
      borderRadius: 18,
      padding: 8,
      shadowColor: colors.shadow.light,
      shadowOpacity: 0.22,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 10 },
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {renderModeSwitch(true)}
        {mode === 'social' && hasExpandableGroups ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={allExpanded ? 'Collapse all' : 'Expand all'}
            onPress={() => { if (allExpanded) collapseAll(); else expandAll(); }}
            style={({ pressed }) => ({
              marginLeft: 'auto',
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 999,
              backgroundColor: colors.bg.muted,
              borderWidth: 1,
              borderColor: colors.border.subtle,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Text style={{ color: colors.text.secondary, fontWeight: '800', fontSize: 12 }}>
              {allExpanded ? 'Collapse' : 'Expand'}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {mode === 'artist' ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingTop: 8 }}
        >
          {filterOptions.map(({ key, label }) => (
            <Chip
              key={key}
              label={label}
              selected={filter === key}
              onPress={() => setFilter(key as any)}
              style={{ paddingHorizontal: 12, minHeight: 32 }}
            />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );

  const renderWaveHeader = () => (
    <View style={{ paddingTop: insets.top + 8 }}>
      <FeedHeader
        subtitle={mode === 'artist' ? 'Fresh music from artists you follow' : 'What the people you follow are listening to'}
        mode={mode}
        onModeChange={onChangeMode}
      >
        {mode === 'artist' && newCount > 0 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: accentSoft, borderWidth: 1, borderColor: colors.accent.primary }}>
              <Text style={{ color: colors.accent.primary, fontWeight: '800', fontSize: 12 }}>{newCount} new this week</Text>
            </View>
          </View>
        ) : null}
      </FeedHeader>

      {mode === 'artist' && (
        <View style={{ marginBottom: 6 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
            {filterOptions.map(({ key, label }) => {
              const selected = filter === key;
              return (
                <Chip
                  key={key}
                  label={label}
                  selected={selected}
                  onPress={() => setFilter(key as any)}
                  style={{ paddingHorizontal: 13, minHeight: 34 }}
                />
              );
            })}
          </ScrollView>
        </View>
      )}
    </View>
  );

  return (
    <Screen edges={['left', 'right']} style={{ paddingTop: 0 }}>
      {mode === 'artist' && loading ? (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 112 }}
          onScroll={(e) => updateStickyControls(e.nativeEvent.contentOffset.y)}
          scrollEventThrottle={16}
        >
          {renderWaveHeader()}
          <View style={{ marginTop: 8 }}>
          {[0, 1, 2].map(i => (
            <View key={i} style={{ height: 91, overflow: 'hidden', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: colors.border.subtle }}>
              <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                <View style={{ width: 64, height: 64, borderRadius: 11, backgroundColor: colors.bg.muted }} />
                <View style={{ flex: 1, gap: 8 }}>
                  <View style={{ height: 12, borderRadius: 6, backgroundColor: colors.bg.muted, width: '70%' }} />
                  <View style={{ height: 10, borderRadius: 6, backgroundColor: colors.bg.muted, width: '40%' }} />
                  <View style={{ height: 10, borderRadius: 6, backgroundColor: colors.bg.muted, width: '55%' }} />
                </View>
                <View style={{ width: 60, height: 29, borderRadius: 999, backgroundColor: colors.bg.muted }} />
              </View>
            </View>
          ))}
          </View>
        </ScrollView>
      ) : (
        mode === 'artist' ? (
        <SectionList
          ref={artistListRef}
          sections={sections}
          keyExtractor={(i) => String(i.id ?? i.spotify_url ?? i.apple_url ?? `${i.title}__${i.artist_id}`)}
          ListHeaderComponent={renderWaveHeader}
          contentContainerStyle={{ paddingBottom: 112 }}
          onLayout={attemptRestoreScroll}
          onContentSizeChange={attemptRestoreScroll}
          stickySectionHeadersEnabled={false}
          onScroll={(e) => {
            if (restoreTargetRef.current.mode === 'artist') return;
            const offset = e.nativeEvent.contentOffset.y;
            artistScrollOffsetRef.current = offset;
            updateStickyControls(offset);
          }}
          scrollEventThrottle={16}
          ListEmptyComponent={(
            <View style={{ marginTop: 16, borderWidth: 1, borderColor: colors.border.subtle, borderRadius: 14, padding: 16, backgroundColor: colors.bg.secondary }}>
              <View style={{ alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: accentSoft, borderWidth: 1, borderColor: colors.accent.primary }}>
                <Text style={{ color: colors.accent.primary, fontWeight: '800' }}>{followedCount === 0 ? 'Get started' : 'Nothing new'}</Text>
              </View>
              {followedCount === 0 ? (
                <>
                  <Text style={{ marginTop: 12, color: colors.text.secondary, fontSize: 16, fontWeight: '700' }}>Follow some artists to get release updates.</Text>
                  <Text style={{ marginTop: 6, color: colors.text.muted }}>Head to Discover and add a few favourites. We will pull in new drops automatically.</Text>
                  <Pressable onPress={() => router.push('/(tabs)/discover' as any)} style={{ marginTop: 12, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.accent.primary }}>
                    <Text style={{ color: colors.text.inverted, fontWeight: '800', textAlign: 'center' }}>Go to Discover</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Text style={{ marginTop: 12, color: colors.text.secondary, fontSize: 16, fontWeight: '700' }}>No new releases right now.</Text>
                  <Text style={{ marginTop: 6, color: colors.text.muted }}>Check back soon, or follow more artists to see more updates.</Text>
                  <Pressable onPress={() => router.push('/(tabs)/discover' as any)} style={{ marginTop: 12, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.bg.muted, borderWidth: 1, borderColor: colors.border.subtle }}>
                    <Text style={{ color: colors.text.secondary, fontWeight: '800', textAlign: 'center' }}>Discover artists</Text>
                  </Pressable>
                </>
              )}
            </View>
          )}
          refreshing={refreshing}
          onRefresh={onRefresh}
          renderSectionHeader={({ section: { title } }) => (
            <View style={{ marginTop: 18, marginBottom: 2 }}>
              <Text style={{ color: colors.text.muted, fontSize: 11, fontWeight: '900', letterSpacing: 0.8, textTransform: 'uppercase' }}>
                {(() => {
                  if (title === 'Unknown date') return 'Earlier';
                  const ts = Date.parse(title);
                  if (!Number.isNaN(ts)) {
                    const days = (Date.now() - ts) / (24 * 60 * 60 * 1000);
                    if (days < 7) return `This week · ${title}`;
                  }
                  return title;
                })()}
              </Text>
            </View>
          )}
          renderItem={({ item }) => {
            // derive album id from spotify_url to fetch artwork via /lookup if desired
            // quick-and-dirty thumb from open.spotify.com image CDN is not public; prefer lookup later
            const key = item.spotify_url ?? (item.title && item.artist_name ? `${item.title}__${item.artist_name}` : null);
            const isDone = !!(key && doneSet.has(key));
            const isInList = !!(key && inListSet.has(key));
            const providerId =
              (item as any).provider_id ??
              item.spotify_id ??
              (item as any).apple_id ??
              (item as any).external_id ??
              null;
            const rowId = providerId || item.spotify_url || item.apple_url || key || item.id;
            const releaseId =
              providerId ||
              item.spotify_id ||
              (item as any).apple_id ||
              (item as any).external_id ||
              parseSpotifyUrlOrId(item.spotify_url || '')?.id ||
              extractAppleId(item.apple_url) ||
              rowId;
            const onOpen = () => {
              if (releaseId) goToRelease(releaseId);
            };
            const menuPayload = {
              id: rowId,
              item_type: itemTypeOf(item) === 'album' ? 'album' : 'track',
              provider: item.spotify_url ? 'spotify' : 'apple',
              provider_id: providerId || rowId,
              title: item.title,
              artist_name: item.artist_name ?? null,
              release_date: item.release_date ?? null,
              spotify_url: item.spotify_url ?? null,
              apple_url: item.apple_url ?? null,
              artwork_url: item.artwork_url ?? item.image_url ?? null,
              done_at: isDone ? new Date().toISOString() : null,
              rating: null,
              created_at: null,
              artist_id: item.artist_id ?? null,
              in_list: isInList || !!added[item.id],
            } as any;
            // Prefetch cover if present
            if (item.image_url) {
              Image.prefetch(item.image_url).catch(() => {});
            }
            const saved = isInList || !!added[item.id];
            const saveLabel = isDone ? 'Listened' : saved ? 'Saved' : 'Save';
          return (
            <Pressable
              style={({ pressed }) => ({
                marginHorizontal: 2,
                paddingVertical: 13,
                borderBottomWidth: 1,
                borderBottomColor: colors.border.subtle,
                opacity: pressed ? 0.9 : 1,
                transform: [{ scale: pressed ? 0.994 : 1 }],
              })}
              onPress={onOpen}
              onLongPress={() => setMenuRow(menuPayload)}
              delayLongPress={RELEASE_LONG_PRESS_MS}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                {item.image_url ? (
                  <Image source={{ uri: item.image_url }} style={{ width: 64, height: 64, borderRadius: 11, backgroundColor: colors.bg.muted, marginRight: 13 }} />
                ) : (
                  <View style={{ width: 64, height: 64, borderRadius: 11, backgroundColor: colors.bg.muted, alignItems: 'center', justifyContent: 'center', marginRight: 13 }}>
                    <Text style={{ color: colors.text.muted, fontWeight: '800' }}>{(item.artist_name ?? '?').slice(0, 1).toUpperCase()}</Text>
                  </View>
                )}
                <View style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                  <Text style={{ color: colors.accent.primary, fontSize: 10, fontWeight: '900', letterSpacing: 0.8, textTransform: 'uppercase' }} numberOfLines={1}>
                    {[isNew(item.release_date) ? 'New' : null, itemTypeOf(item)].filter(Boolean).join('  ·  ')}
                  </Text>
                  <Text style={{ marginTop: 3, fontWeight: '800', color: colors.text.secondary, fontSize: 16 }} numberOfLines={1}>{item.title}</Text>
                  {!!item.artist_name && <Text style={{ marginTop: 2, color: colors.text.secondary, fontSize: 13 }} numberOfLines={1}>{item.artist_name}</Text>}
                </View>
                <View style={{ alignItems: 'center', gap: 2 }}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={saveLabel}
                    disabled={saved}
                    onPress={(e) => {
                      (e as any)?.stopPropagation?.();
                      if (!saved) void onAdd(item);
                    }}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 5,
                      minWidth: 64,
                      paddingHorizontal: 10,
                      paddingVertical: 7,
                      borderRadius: 999,
                      backgroundColor: saved ? colors.bg.muted : accentSoft,
                      opacity: pressed ? 0.8 : 1,
                      justifyContent: 'center',
                    })}
                  >
                    <Ionicons name={saved ? 'checkmark' : 'add'} size={14} color={saved ? colors.text.muted as any : colors.accent.primary as any} />
                    <Text style={{ color: saved ? colors.text.muted : colors.accent.primary, fontWeight: '800', fontSize: 12 }}>{saveLabel}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={`More options for ${item.title}`} onPress={(e) => { (e as any)?.stopPropagation?.(); setMenuRow(menuPayload); }} style={{ minWidth: 44, minHeight: 32, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: colors.text.secondary, fontWeight: '800' }}>•••</Text>
                  </Pressable>
                </View>
              </View>
            </Pressable>
          );
        }}
      />
        ) : (
          socialLoading ? (
            <ScrollView
              contentContainerStyle={{ paddingBottom: 112 }}
              onScroll={(e) => updateStickyControls(e.nativeEvent.contentOffset.y)}
              scrollEventThrottle={16}
            >
              {renderWaveHeader()}
              <View style={{ marginTop: 14 }}>
              {[0, 1, 2, 3].map((i) => (
                <View key={i} style={{ height: 72, overflow: 'hidden', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border.subtle }}>
                  <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                    <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: colors.bg.muted }} />
                    <View style={{ flex: 1, gap: 8 }}>
                      <View style={{ height: 10, borderRadius: 6, backgroundColor: colors.bg.muted, width: '62%' }} />
                      <View style={{ height: 10, borderRadius: 6, backgroundColor: colors.bg.muted, width: '48%' }} />
                    </View>
                  </View>
                </View>
              ))}
              </View>
            </ScrollView>
          ) : (
            <View style={{ flex: 1, minHeight: 0 }}>
              <FlatList
                ref={socialListRef}
                data={socialFeedRows}
                keyExtractor={(i) => i.id}
                ListHeaderComponent={() => (
                  <>
                    {renderWaveHeader()}
                    {mode === 'social' ? (
                      <View style={{ height: SOCIAL_HEADER_HEIGHT, justifyContent: 'center', marginBottom: 4 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Pressable accessibilityRole="button" accessibilityLabel="Find people" onPress={() => router.push('/profile/people')} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4, paddingVertical: 8, opacity: pressed ? 0.82 : 1 })}>
                            <Ionicons name="person-add-outline" size={15} color={colors.accent.primary as any} />
                            <Text style={{ color: colors.accent.primary, fontWeight: '800', fontSize: 12 }}>Find people</Text>
                          </Pressable>
                          {hasExpandableGroups ? <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={allExpanded ? 'Collapse all' : 'Expand all'}
                            accessibilityHint="Expands or collapses all social activity groups"
                            onPress={() => { if (allExpanded) collapseAll(); else expandAll(); }}
                            hitSlop={6}
                            style={(state) => {
                              const focused = 'focused' in state && !!state.focused;
                              return {
                                paddingHorizontal: 4,
                                paddingVertical: 8,
                                borderBottomWidth: focused ? 1 : 0,
                                borderBottomColor: colors.accent.primary,
                                opacity: state.pressed ? 0.85 : 1,
                              };
                            }}
                          >
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                              <Ionicons name={allExpanded ? 'chevron-up' : 'chevron-down'} size={14} color={colors.text.secondary as any} />
                              <Text style={{ color: colors.text.secondary, fontWeight: '800', fontSize: 12 }}>
                                {allExpanded ? 'Collapse all' : 'Expand all'}
                              </Text>
                            </View>
                          </Pressable> : null}
                        </View>
                      </View>
                    ) : null}
                  </>
                )}
                contentContainerStyle={{ paddingBottom: 112 }}
                onLayout={attemptRestoreScroll}
                onContentSizeChange={attemptRestoreScroll}
                onScroll={(e) => {
                  if (restoreTargetRef.current.mode === 'social') return;
                  const offset = e.nativeEvent.contentOffset.y;
                  socialScrollOffsetRef.current = offset;
                  updateStickyControls(offset);
                }}
                scrollEventThrottle={16}
                refreshing={socialRefreshing}
                onRefresh={onRefreshSocial}
                ListEmptyComponent={(
                  <View style={{ marginTop: 16, borderWidth: 1, borderColor: colors.border.subtle, borderRadius: 14, padding: 16, backgroundColor: colors.bg.secondary }}>
                    <View style={{ alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.bg.muted, borderWidth: 1, borderColor: colors.border.subtle }}>
                      <Text style={{ color: colors.text.secondary, fontWeight: '800' }}>No activity yet</Text>
                    </View>
                    <Text style={{ marginTop: 12, color: colors.text.secondary, fontSize: 16, fontWeight: '700' }}>
                      {socialError ? 'Your Wave isn’t available yet.' : 'Ripple activity will appear here.'}
                    </Text>
                    <Text style={{ marginTop: 6, color: colors.text.muted }}>
                      {socialError
                        ? (socialError.includes('get_social_activity')
                          ? 'Run the `get_social_activity` RPC migration in Supabase, then pull to refresh.'
                          : socialError)
                        : 'No likes, comments, or messaging — just lightweight listening updates.'}
                    </Text>
                  </View>
                )}
                renderItem={({ item }) => {
                  if (item.kind === 'separator') {
                    return (
                      <View style={{ paddingHorizontal: 2, paddingTop: 12, paddingBottom: 6 }}>
                        <Text style={{ color: colors.text.muted, fontWeight: '900', letterSpacing: 0.2 }}>{item.label}</Text>
                      </View>
                    );
                  }

                  const g = item.group;
                  return <SocialGroupCard group={g} expanded={expandedSocialGroupIds.has(g.id)} />;
                }}
              />
            </View>
          )
        )
      )}
      <Snackbar
        visible={snack.visible}
        message={snack.message}
        onAction={snack.listenId ? async () => {
          try {
            if (snack.listenId) {
              const res = await removeListen(snack.listenId);
              if (!res.ok) throw new Error(res.message || 'Undo failed');
              if (snack.feedId) setAdded(prev => ({ ...prev, [snack.feedId!]: false }));
              H.success();
            }
          } catch (e) {
            H.error();
          } finally {
            setSnack({ visible: false, message: '', listenId: null, feedId: null });
          }
        } : undefined}
        onTimeout={() => setSnack({ visible: false, message: '', listenId: null, feedId: null })}
      />
      <StatusMenu
        row={menuRow as any}
        visible={!!menuRow}
        onClose={() => setMenuRow(null)}
        onChanged={() => { load(); }}
      />
      {stickyControlsVisible ? (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            top: insets.top + 8,
            left: 16,
            right: 16,
            zIndex: 20,
          }}
        >
          {renderCompactControls()}
        </View>
      ) : null}
    </Screen>
  );
}
