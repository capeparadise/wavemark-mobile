import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, FlatList, Image, LayoutAnimation, Linking, Platform, Pressable, SectionList, Text, UIManager, View } from 'react-native';
import Avatar from '../../components/Avatar';
import { H } from '../../components/haptics';
import Screen from '../../components/Screen';
import Snackbar from '../../components/Snackbar';
import GlassCard from '../../components/GlassCard';
import StatusMenu from '../../components/StatusMenu';
import FeedHeader, { type FeedMode } from '../../components/feed/FeedHeader';
import { formatDate } from '../../lib/date';
import { off, on } from '../../lib/events';
import { FN_BASE } from '../../lib/fnBase';
import { fetchFeedForArtists, listFollowedArtists, type FeedItem } from '../../lib/follow';
import { addToListFromSearch, fetchListenList, removeListen } from '../../lib/listen';
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
  actorAvatarUrl: string | null;
  createdAt: string;
  title: string;
  artistName?: string | null;
  rating?: number | null;
  spotifyUrl?: string | null;
  appleUrl?: string | null;
  artworkUrl?: string | null;
  itemType?: 'album' | 'track' | null;
};

const hashString = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(31, h) + s.charCodeAt(i) | 0;
  return Math.abs(h);
};

const FEED_MODE_KEY = (uid: string) => `wavemark:feed-mode:${uid}`;

export default function FeedTab() {
  const { colors } = useTheme();
  const { user } = useSession();
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
  const [filter, setFilter] = useState<'all' | 'album' | 'single' | 'ep' | 'new'>('all');
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [doneKeys, setDoneKeys] = useState<string[]>([]);
  const [inListKeys, setInListKeys] = useState<string[]>([]);
  const [menuRow, setMenuRow] = useState<any | null>(null);
  const [snack, setSnack] = useState<{ visible: boolean; message: string; listenId?: string | null; feedId?: string | null }>({ visible: false, message: '', listenId: null, feedId: null });
  const artistListRef = useRef<any>(null);
  const socialListRef = useRef<any>(null);
  const artistScrollOffsetRef = useRef(0);
  const socialScrollOffsetRef = useRef(0);
  const restoreTargetRef = useRef<{ mode: FeedMode | null; offset: number }>({ mode: null, offset: 0 });
  const rowsRef = useRef<Item[]>([]);
  const socialRowsRef = useRef<SocialActivityItem[]>([]);
  const accentSoft = colors.accent.primary + '1a';
  const successSoft = colors.accent.success + '1a';
  const palette = useMemo(() => ([
    { bg: colors.bg.secondary, border: colors.border.subtle, text: colors.text.secondary },
    { bg: colors.bg.muted, border: colors.border.subtle, text: colors.text.secondary },
    { bg: accentSoft, border: colors.accent.primary, text: colors.text.secondary },
    { bg: successSoft, border: colors.accent.success, text: colors.text.secondary },
  ]), [accentSoft, colors, successSoft]);

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
    setExpandedSocialGroupIds(new Set());
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
      setRows(data);
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
    return () => { setExpandedSocialGroupIds(new Set()); };
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
    const ts = Date.parse(d);
    if (Number.isNaN(ts)) return false;
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
      const ta = Date.parse(a);
      const tb = Date.parse(b);
      return (Number.isNaN(tb) ? 0 : tb) - (Number.isNaN(ta) ? 0 : ta);
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
      await fetch(`${FN_BASE}/check-new-releases`);
    } catch {
      // Silent failure; the feed will still refresh from whatever is already in `new_release_feed`.
    }
  };

  const newCount = useMemo(() => filteredRows.filter(r => isNew(r.release_date)).length, [filteredRows]);
  const avatarStack = useMemo(() => rows.filter(r => !!r.image_url).slice(0, 5), [rows]);

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

  const openSocialItem = useCallback((item: SocialActivityItem) => {
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

  const SocialGroupCard = ({ group, expanded }: { group: SocialGroup; expanded: boolean }) => {
    const opacity = useRef(new Animated.Value(expanded ? 1 : 0)).current;
    useEffect(() => {
      Animated.timing(opacity, { toValue: expanded ? 1 : 0, duration: 170, useNativeDriver: true }).start();
    }, [expanded, opacity]);

    const listenedItems = useMemo(() => group.items.filter((x) => x.kind !== 'rated'), [group.items]);
    const ratedItems = useMemo(() => group.items.filter((x) => x.kind === 'rated'), [group.items]);

    const expandedBg = expanded ? (colors.bg.muted) : undefined;
    const outerPad = expanded ? 16 : 12;

    return (
      <GlassCard style={{ padding: 0, backgroundColor: expandedBg }}>
        <View style={{ marginHorizontal: 2, marginVertical: 6, padding: outerPad }}>
          <Pressable
            onPress={() => toggleExpandedGroup(group.id)}
            style={({ pressed }) => ({
              transform: [{ scale: pressed ? 0.996 : 1 }],
            })}
          >
            <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
              <Avatar uri={group.friendAvatarUrl} size={42} borderColor={colors.border.subtle} backgroundColor={colors.bg.muted} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: colors.text.secondary, fontWeight: '900', fontSize: 16 }} numberOfLines={1}>
                  {group.friendName}
                </Text>
                <Text style={{ marginTop: 4, color: colors.text.muted, fontWeight: '700' }} numberOfLines={1}>
                  {summaryLineForGroup(group)}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', justifyContent: 'center', gap: 6 }}>
                <Text style={{ color: colors.text.muted, fontSize: 12, fontWeight: '700' }}>{group.dateLabel}</Text>
                <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.text.muted as any} />
              </View>
            </View>
          </Pressable>

          <Animated.View style={{ opacity, height: expanded ? undefined : 0, overflow: 'hidden' }}>
            <View style={{ marginTop: 8, gap: 14 }}>
              {listenedItems.length > 0 && (
                <View style={{ gap: 10 }}>
                  <Text style={{ color: colors.text.muted, fontWeight: '800', letterSpacing: 0.2 }}>Listened to</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 }}>
                    {listenedItems.map((it) => (
                      <Pressable
                        key={it.id}
                        onPress={() => openSocialItem(it)}
                        style={({ pressed }) => ({
                          width: '48%',
                          padding: 10,
                          borderRadius: 14,
                          backgroundColor: colors.bg.secondary,
                          borderWidth: 1,
                          borderColor: colors.border.subtle,
                          opacity: pressed ? 0.9 : 1,
                          transform: [{ scale: pressed ? 0.98 : 1 }],
                        })}
                      >
                        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                          <View style={{ width: 44, height: 44, borderRadius: 10, overflow: 'hidden', backgroundColor: colors.bg.muted }}>
                            {!!it.artworkUrl ? (
                              <Image source={{ uri: it.artworkUrl }} style={{ width: 44, height: 44 }} />
                            ) : (
                              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                                <Text style={{ color: colors.text.muted, fontWeight: '900' }}>♪</Text>
                              </View>
                            )}
                          </View>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={{ color: colors.text.secondary, fontWeight: '800', fontSize: 12 }} numberOfLines={1}>
                              {it.title || 'Untitled'}
                            </Text>
                            {!!it.artistName && (
                              <Text style={{ marginTop: 2, color: colors.text.muted, fontSize: 11 }} numberOfLines={1}>
                                {it.artistName}
                              </Text>
                            )}
                            <Text style={{ marginTop: 2, color: colors.text.muted, fontSize: 10 }}>
                              {contextLineForItem(it)}
                            </Text>
                          </View>
                        </View>
                      </Pressable>
                    ))}
                  </View>
                </View>
              )}

              {ratedItems.length > 0 && (
                <View style={{ gap: 10 }}>
                  <Text style={{ color: colors.text.muted, fontWeight: '800', letterSpacing: 0.2 }}>Rated</Text>
                  <View style={{ gap: 10 }}>
                    {ratedItems.map((it) => (
                      <Pressable
                        key={it.id}
                        onPress={() => openSocialItem(it)}
                        style={({ pressed }) => ({
                          flexDirection: 'row',
                          gap: 12,
                          alignItems: 'center',
                          paddingVertical: 8,
                          paddingHorizontal: 10,
                          borderRadius: 14,
                          backgroundColor: colors.bg.secondary,
                          borderWidth: 1,
                          borderColor: colors.border.subtle,
                          opacity: pressed ? 0.9 : 1,
                          transform: [{ scale: pressed ? 0.99 : 1 }],
                        })}
                      >
                        <View style={{ width: 38, height: 38, borderRadius: 10, overflow: 'hidden', backgroundColor: colors.bg.muted }}>
                          {!!it.artworkUrl && <Image source={{ uri: it.artworkUrl }} style={{ width: 38, height: 38 }} />}
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={{ color: colors.text.secondary, fontWeight: '800' }} numberOfLines={1}>
                            {it.title || 'Untitled'}
                          </Text>
                          {!!it.artistName && (
                            <Text style={{ marginTop: 2, color: colors.text.muted }} numberOfLines={1}>
                              {it.artistName}
                            </Text>
                          )}
                          <Text style={{ marginTop: 2, color: colors.text.muted, fontSize: 11 }}>
                            {contextLineForItem(it)}
                          </Text>
                        </View>
                        {typeof it.rating === 'number' && (
                          <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.bg.muted, borderWidth: 1, borderColor: colors.border.subtle }}>
                            <Text style={{ color: colors.text.secondary, fontWeight: '900', fontSize: 12 }}>{it.rating}/10</Text>
                          </View>
                        )}
                      </Pressable>
                    ))}
                  </View>
                </View>
              )}
            </View>
          </Animated.View>
        </View>
      </GlassCard>
    );
  };

  const filterOptions = [
    { key: 'all', label: 'All' },
    { key: 'album', label: 'Albums' },
    { key: 'single', label: 'Singles' },
    { key: 'ep', label: 'EPs' },
    { key: 'new', label: 'New this week' },
  ];

  return (
    <Screen>
      <FeedHeader
        subtitle={mode === 'artist' ? 'New releases from artists you follow' : 'Ripple activity from your network'}
        mode={mode}
        onModeChange={onChangeMode}
        rightAccessory={(
          <View style={{ flexDirection: 'row' }}>
            {avatarStack.map((r, idx) => (
              <Image key={r.id} source={{ uri: r.image_url! }} style={{ width: 34, height: 34, borderRadius: 999, borderWidth: 2, borderColor: colors.border.strong, marginLeft: idx === 0 ? 0 : -10, backgroundColor: colors.bg.elevated }} />
            ))}
            {avatarStack.length === 0 && (
              <View style={{ width: 34, height: 34, borderRadius: 999, backgroundColor: colors.bg.elevated, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border.strong }}>
                <Text style={{ color: colors.text.muted, fontWeight: '800' }}>?</Text>
              </View>
            )}
          </View>
        )}
      >
        {mode === 'artist' && newCount > 0 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: accentSoft, borderWidth: 1, borderColor: colors.accent.primary }}>
              <Text style={{ color: colors.accent.primary, fontWeight: '800', letterSpacing: 0.3 }}>{newCount} new this week</Text>
            </View>
          </View>
        ) : null}
      </FeedHeader>

      {mode === 'artist' && (
      <View style={{ marginBottom: 8 }}>
        <View style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 10,
          paddingHorizontal: 4,
          paddingVertical: 6,
          maxHeight: filtersExpanded ? undefined : 52,
          overflow: 'hidden',
        }}>
          {filterOptions.map(({ key, label }) => {
            const selected = filter === key;
            return (
              <Pressable key={key} onPress={() => setFilter(key as any)}>
                <View style={{
                  paddingHorizontal: 16,
                paddingVertical: 12,
                borderRadius: 20,
                backgroundColor: selected ? colors.accent.primary : colors.bg.muted,
                minHeight: 40,
                borderWidth: selected ? 0 : 1,
                borderColor: selected ? colors.accent.primary : colors.border.subtle,
                shadowColor: colors.shadow.light,
                shadowOpacity: selected ? 0.12 : 0.04,
                shadowRadius: selected ? 8 : 4,
                shadowOffset: { width: 0, height: 2 },
              }}>
                <Text style={{ color: selected ? colors.text.inverted : colors.text.secondary, fontWeight: '800', lineHeight: 18 }}>{label}</Text>
              </View>
            </Pressable>
          );
          })}
        </View>
        <Pressable
          onPress={() => setFiltersExpanded(v => !v)}
          style={{ alignSelf: 'flex-start', marginLeft: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: colors.bg.muted }}
        >
          <Text style={{ color: colors.text.secondary, fontWeight: '800' }}>{filtersExpanded ? 'Collapse filters' : 'Show all filters'}</Text>
        </Pressable>
      </View>
      )}

      {mode === 'artist' && loading ? (
        <View style={{ marginTop: 8, gap: 12 }}>
          {[0, 1, 2].map(i => (
            <View key={i} style={{ height: 110, borderRadius: 16, backgroundColor: colors.bg.secondary, overflow: 'hidden', padding: 12, borderWidth: 1, borderColor: colors.border.subtle }}>
              <Animated.View style={{ position: 'absolute', inset: 0, backgroundColor: colors.bg.muted, opacity: 0.5 }} />
              <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                <View style={{ width: 56, height: 56, borderRadius: 12, backgroundColor: colors.bg.muted }} />
                <View style={{ flex: 1, gap: 8 }}>
                  <View style={{ height: 12, borderRadius: 6, backgroundColor: colors.bg.muted, width: '70%' }} />
                  <View style={{ height: 10, borderRadius: 6, backgroundColor: colors.bg.muted, width: '40%' }} />
                  <View style={{ height: 10, borderRadius: 6, backgroundColor: colors.bg.muted, width: '55%' }} />
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
                <View style={{ height: 32, borderRadius: 8, backgroundColor: colors.bg.muted, flex: 1 }} />
                <View style={{ height: 32, borderRadius: 8, backgroundColor: colors.bg.muted, flex: 1 }} />
              </View>
            </View>
          ))}
        </View>
      ) : (
        mode === 'artist' ? (
        <SectionList
          ref={artistListRef}
          sections={sections}
          keyExtractor={(i) => String(i.id ?? i.spotify_url ?? i.apple_url ?? `${i.title}__${i.artist_id}`)}
          contentContainerStyle={{ paddingBottom: 24, paddingTop: 8 }}
          onLayout={attemptRestoreScroll}
          onContentSizeChange={attemptRestoreScroll}
          onScroll={(e) => {
            if (restoreTargetRef.current.mode === 'artist') return;
            artistScrollOffsetRef.current = e.nativeEvent.contentOffset.y;
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
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12, marginBottom: 6 }}>
              <View style={{ width: 18, alignItems: 'center' }}>
                <View style={{ width: 2, height: 18, backgroundColor: colors.bg.muted }} />
                <View style={{ width: 10, height: 10, borderRadius: 8, backgroundColor: colors.accent.primary, borderWidth: 2, borderColor: colors.border.subtle, marginTop: -6 }} />
              </View>
              <Text style={{ marginLeft: 8, color: colors.text.secondary, fontSize: 12, fontWeight: '800' }}>
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
            const onOpen = () => {
              if (item.spotify_url) Linking.openURL(item.spotify_url).catch(() => {});
            };
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
            const accent = palette[hashString(item.id) % palette.length];
            const waveHeights = (() => {
              const base = hashString(item.id + (item.title || ''));
              return [base % 8 + 4, (base >> 2) % 10 + 3, (base >> 4) % 8 + 5, (base >> 6) % 9 + 4, (base >> 8) % 7 + 6];
            })();
          return (
            <GlassCard asChild style={{ padding: 0 }}>
              <Pressable
                style={({ pressed }) => ({
                  marginHorizontal: 2,
                  marginVertical: 6,
                  padding: 14,
                  transform: [{ scale: pressed ? 0.99 : 1 }],
                })}
                onPress={onOpen}
                onLongPress={() => setMenuRow(menuPayload)}
                delayLongPress={RELEASE_LONG_PRESS_MS}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  {/* Artwork */}
                  {item.image_url ? (
                    <Image source={{ uri: item.image_url }} style={{ width: 62, height: 62, borderRadius: 12, backgroundColor: colors.bg.muted, marginRight: 12 }} />
                  ) : (
                    <View style={{ width: 62, height: 62, borderRadius: 12, backgroundColor: colors.bg.muted, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                      <Text style={{ color: colors.text.muted, fontWeight: '800' }}>{(item.artist_name ?? '?').slice(0, 1).toUpperCase()}</Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={{ fontWeight: '800', flexShrink: 1, color: colors.text.secondary, fontSize: 16 }} numberOfLines={1}>{item.title}</Text>
                      {isNew(item.release_date) && (
                        <View style={{ paddingHorizontal: 6, paddingVertical: 2, backgroundColor: accentSoft, borderRadius: 999 }}>
                          <Text style={{ color: colors.accent.primary, fontSize: 10, fontWeight: '800', letterSpacing: 0.3 }}>NEW</Text>
                        </View>
                      )}
                      {!!itemTypeOf(item) && (
                        <View style={{ paddingHorizontal: 6, paddingVertical: 2, backgroundColor: accentSoft, borderRadius: 999, borderWidth: 1, borderColor: colors.accent.primary }}>
                          <Text style={{ color: colors.accent.primary, fontSize: 10, fontWeight: '800', letterSpacing: 0.4 }}>{itemTypeOf(item)!.toUpperCase()}</Text>
                        </View>
                      )}
                    </View>
                    {!!item.artist_name && <Text style={{ color: colors.text.secondary }} numberOfLines={1}>{item.artist_name}</Text>}
                    {!!item.release_date && <Text style={{ color: colors.text.muted, marginTop: 2 }}>{formatDate(item.release_date)}</Text>}
                  </View>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 14, justifyContent: 'space-between' }}>
                  <Pressable onPress={onOpen} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ color: colors.text.secondary, fontWeight: '800' }}>Open</Text>
                  </Pressable>
                  <Pressable onPress={() => setMenuRow(menuPayload)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: colors.bg.muted }}>
                    <Text style={{ color: colors.text.secondary, fontWeight: '800' }}>•••</Text>
                  </Pressable>
                </View>
              </Pressable>
            </GlassCard>
          );
        }}
      />
        ) : (
          socialLoading ? (
            <View style={{ marginTop: 16, gap: 10 }}>
              {[0, 1, 2, 3].map((i) => (
                <View key={i} style={{ height: 72, borderRadius: 14, backgroundColor: colors.bg.secondary, overflow: 'hidden', padding: 12, borderWidth: 1, borderColor: colors.border.subtle }}>
                  <Animated.View style={{ position: 'absolute', inset: 0, backgroundColor: colors.bg.muted, opacity: 0.5 }} />
                  <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                    <View style={{ width: 44, height: 44, borderRadius: 10, backgroundColor: colors.bg.muted }} />
                    <View style={{ flex: 1, gap: 8 }}>
                      <View style={{ height: 10, borderRadius: 6, backgroundColor: colors.bg.muted, width: '62%' }} />
                      <View style={{ height: 10, borderRadius: 6, backgroundColor: colors.bg.muted, width: '48%' }} />
                    </View>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <FlatList
              ref={socialListRef}
              data={socialFeedRows}
              keyExtractor={(i) => i.id}
              ListHeaderComponent={mode === 'social' && hasExpandableGroups ? (
                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 10, paddingHorizontal: 6 }}>
                  <Pressable
                    onPress={() => { if (allExpanded) collapseAll(); else expandAll(); }}
                    hitSlop={6}
                    style={({ pressed }) => ({
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: colors.border.subtle,
                      backgroundColor: colors.bg.muted,
                      opacity: pressed ? 0.85 : 1,
                    })}
                  >
                    <Text style={{ color: colors.text.secondary, fontWeight: '700', fontSize: 12 }}>
                      {allExpanded ? 'Collapse all' : 'Expand all'}
                    </Text>
                  </Pressable>
                </View>
              ) : null}
              contentContainerStyle={{ paddingBottom: 24, paddingTop: hasExpandableGroups ? 0 : 8 }}
              onLayout={attemptRestoreScroll}
              onContentSizeChange={attemptRestoreScroll}
              onScroll={(e) => {
                if (restoreTargetRef.current.mode === 'social') return;
                socialScrollOffsetRef.current = e.nativeEvent.contentOffset.y;
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
    </Screen>
  );
}
