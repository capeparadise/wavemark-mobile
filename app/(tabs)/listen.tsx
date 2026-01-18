import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native';
import Screen from '../../components/Screen';
import GlassCard from '../../components/GlassCard';

import {
  addUpcomingToListen,
  fetchListenList,
  fetchUpcomingClient,
  getDefaultPlayer,
  openInSpotify,
  openInAppleMusic,
  markDone,
  openByDefaultPlayer,
  reconcileListenUpcoming,
  removeListen,
  type ListenPlayer,
  type ListenRow,
  type UpcomingItem,
} from '../../lib/listen';

import AsyncStorage from '@react-native-async-storage/async-storage';
import Chip from '../../components/Chip';
import { H } from '../../components/haptics';
import PlayerToggle from '../../components/PlayerToggle';
import RatingModal from '../../components/RatingModal';
import StatusMenu from '../../components/StatusMenu';
import Snackbar from '../../components/Snackbar';
import SwipeRow from '../../components/SwipeRow';
import { RELEASE_LONG_PRESS_MS } from '../../hooks/useReleaseActions';
import { debugNS } from '../../lib/debug';
import { off as offEvent, on as onEvent } from '../../lib/events';
import { useSession } from '../../lib/session';
import { spotifyLookup, spotifySearch } from '../../lib/spotify';
import { toast } from '../../lib/toast';
import { getAdvancedRatingsEnabled } from '../../lib/user';
import { useTheme } from '../../theme/useTheme';

const debug = debugNS('ListenTab');

function Stars({ value }: { value?: number | null }) {
  const { colors } = useTheme();
  if (!value && value !== 0) return null;
  return (
    <Text style={{ marginLeft: 8, fontSize: 12, opacity: 0.8, color: colors.text.muted }}>
      ★ {Number(value).toFixed(1)}
    </Text>
  );
}

export default function ListenTab() {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const { user } = useSession();
  const [rows, setRows] = useState<ListenRow[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const prevRowsRef = useRef<ListenRow[]>([]);
  const inFlightRef = useRef(false);
  const lastFetchRef = useRef(0);
  // simple per-row mutation lock to avoid races from rapid gestures
  const mutatingRef = useRef<Record<string, boolean>>({});
  const [defaultPlayer, setDefaultPlayer] = useState<ListenPlayer>('apple');
  const [ratingTarget, setRatingTarget] = useState<ListenRow | null>(null);
  const [ratingVisible, setRatingVisible] = useState(false);
  const openRating = (row: ListenRow) => { setRatingTarget(row); setRatingVisible(true); };
  const closeRating = () => { setRatingVisible(false); setRatingTarget(null); };
  const [advancedRatings, setAdvancedRatings] = useState<boolean>(false);
  useEffect(() => {
    getAdvancedRatingsEnabled().then(setAdvancedRatings).catch(() => setAdvancedRatings(false));
    const handler = (v: boolean) => setAdvancedRatings(!!v);
    onEvent('prefs:advanced_ratings', handler as any);
    return () => { offEvent('prefs:advanced_ratings', handler as any); };
  }, []);
  type FilterKey = 'all' | 'tracks' | 'albums' | 'done';
  type SortKey = 'newest' | 'az' | 'za';

  const [filterKey, setFilterKey] = useState<FilterKey>('all');
  const [sortKey, setSortKey] = useState<SortKey>('newest');
  const [snack, setSnack] = useState<{ visible: boolean; row?: ListenRow }>({ visible: false });
  const [menuRow, setMenuRow] = useState<ListenRow | null>(null);
  // Artwork cache (persisted)
  const [artMap, setArtMap] = useState<Record<string, string>>({});
  // Local cache of inferred item kind per spotify id
  const [kindMap, setKindMap] = useState<Record<string, 'track' | 'album'>>({});
  // Local cache for whether an item is a single (from Spotify albumType)
  const [singleMap, setSingleMap] = useState<Record<string, boolean>>({});
  const artPending = useRef<Set<string>>(new Set());
  const ART_CACHE_KEY = 'listenArtCacheV1';
  const LISTEN_CACHE_KEY = 'listen_cache_v1';
  const UPCOMING_CACHE_KEY = 'listen_upcoming_cache_v1';

  // Shimmer for thumbnails
  const Shimmer = ({ w = 56, h = 56, r = 8 }: { w?: number; h?: number; r?: number }) => {
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
    return <Animated.View style={{ position: 'absolute', top: 0, left: 0, width: w, height: h, borderRadius: r, backgroundColor: colors.bg.muted, opacity }} />;
  };

  const FILTER_KEY = 'listen_filter';
  const SORT_KEY = 'listen_sort';
  // Content type filter (All/Albums/Singles)
  type TypeFilter = 'all' | 'album' | 'single';
  const TYPE_FILTER_KEY = 'listen_type_filter';
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');

  useEffect(() => {
    (async () => {
      // Load persisted artwork cache (7d TTL)
      try {
        const raw = await AsyncStorage.getItem(ART_CACHE_KEY);
        if (raw) {
          const obj = JSON.parse(raw) || {};
          const out: Record<string, string> = {};
          const now = Date.now();
          const TTL = 7*24*60*60*1000;
          Object.entries(obj).forEach(([k, v]: any) => {
            if (v && v.url && typeof v.ts === 'number' && (now - v.ts) < TTL) out[k] = v.url;
          });
          if (Object.keys(out).length) setArtMap(out);
        }
      } catch {}
      const f = await AsyncStorage.getItem(FILTER_KEY);
      const s = await AsyncStorage.getItem(SORT_KEY);
  const tf = await AsyncStorage.getItem(TYPE_FILTER_KEY);
      if (f === 'all' || f === 'tracks' || f === 'albums' || f === 'done') setFilterKey(f as FilterKey);
      if (s === 'newest' || s === 'az' || s === 'za') setSortKey(s as SortKey);
  if (tf === 'all' || tf === 'album' || tf === 'single') setTypeFilter(tf as TypeFilter);
    })();
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!user?.id) return;
      try {
        const raw = await AsyncStorage.getItem(`${LISTEN_CACHE_KEY}_${user.id}`);
        if (raw && mounted) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setRows(parsed as ListenRow[]);
        }
      } catch {}
      try {
        const raw = await AsyncStorage.getItem(`${UPCOMING_CACHE_KEY}_${user.id}`);
        if (raw && mounted) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setUpcoming(parsed as UpcomingItem[]);
        }
      } catch {}
    })();
    return () => { mounted = false; };
  }, [user?.id]);

  useEffect(() => {
    AsyncStorage.setItem(FILTER_KEY, filterKey).catch(() => {});
  }, [filterKey]);

  useEffect(() => {
    AsyncStorage.setItem(SORT_KEY, sortKey).catch(() => {});
  }, [sortKey]);

  useEffect(() => {
    AsyncStorage.setItem(TYPE_FILTER_KEY, typeFilter).catch(() => {});
  }, [typeFilter]);

  const load = useCallback(async (opts?: { force?: boolean }) => {
    if (inFlightRef.current) return;
    const now = Date.now();
    if (!opts?.force && now - lastFetchRef.current < 15000) return;
    inFlightRef.current = true;
    if (rows.length === 0 && !refreshing) setLoading(true);
    try {
      const [data, soon] = await Promise.all([fetchListenList(), fetchUpcomingClient()]);
      setRows(data);
      setUpcoming(soon);
      lastFetchRef.current = Date.now();
      if (user?.id) {
        try { await AsyncStorage.setItem(`${LISTEN_CACHE_KEY}_${user.id}`, JSON.stringify(data)); } catch {}
        try { await AsyncStorage.setItem(`${UPCOMING_CACHE_KEY}_${user.id}`, JSON.stringify(soon)); } catch {}
      }
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [refreshing, rows.length, user?.id]);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        load();
        reconcileListenUpcoming().catch(() => {});
      })();
      // Subscribe to global events that should refresh the list
      const handler = () => load({ force: true });
      onEvent('listen:updated', handler);
      onEvent('listen:refresh', handler);
      return () => {
        offEvent('listen:updated', handler);
        offEvent('listen:refresh', handler);
      };
    }, [load])
  );

  // Also refresh when the tab icon is tapped (even if already focused)
  useEffect(() => {
    const unsub = (navigation as any).addListener('tabPress', () => { load(); });
    return unsub;
  }, [navigation, load]);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        try {
          const p = await getDefaultPlayer();
          if (p === 'apple' || p === 'spotify') setDefaultPlayer(p);
        } catch {
          /* noop */
        }
      })();
    }, [])
  );

  // Load default player on mount and after pull-to-refresh
  useEffect(() => {
    (async () => {
      try {
        const p = await getDefaultPlayer();
        if (p === 'apple' || p === 'spotify') setDefaultPlayer(p);
      } catch {
        /* noop */
      }
    })();
  }, [refreshing]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load({ force: true });
    setRefreshing(false);
  };

  const resetFilters = async () => {
    try {
      await AsyncStorage.multiRemove([FILTER_KEY, SORT_KEY, TYPE_FILTER_KEY]);
    } catch {}
    setFilterKey('all');
    setSortKey('newest');
    setTypeFilter('all');
  };

  const toggleDone = async (row: ListenRow) => {
    if (mutatingRef.current[row.id]) return;
    mutatingRef.current[row.id] = true;

    const prev = rows;
    const nextDone = !row.done_at;
    const nowIso = new Date().toISOString();

    // Optimistic update (no refresh needed)
    setRows(curr => curr.map(r => r.id === row.id ? { ...r, done_at: nextDone ? nowIso : null } : r));
    H.tap();

    const res = await markDone(row.id, nextDone);
    mutatingRef.current[row.id] = false;

    if (!res.ok) {
      setRows(prev); // rollback on error
      H.error();
      Alert.alert('Could not update item', res.message || 'Please try again.');
      return;
    }

    H.success();

    // Show Undo only when marking as Listened
    if (nextDone) {
      // Open rating modal immediately for this item; snackbar suppressed while modal is open
      openRating({ ...row, done_at: nowIso } as ListenRow);
      setSnack({ visible: false });
    } else {
      // optional: toast('Marked not listened');
    }
  };

  const removeItem = async (row: ListenRow) => {
    if (mutatingRef.current[row.id]) return;
    mutatingRef.current[row.id] = true;

    const prev = rows;
    setRows(curr => curr.filter(r => r.id !== row.id)); // optimistic remove
    // H.tap(); // Removed due to missing module

    const ok = await removeListen(row.id);
    mutatingRef.current[row.id] = false;

    if (!ok.ok) {
      setRows(prev); // rollback
      Alert.alert('Could not remove item', ok.message || 'Please try again.');
      H.error();
    }
  };

  // Rating handled via RatingModal on both platforms

  const onOpen = async (item: ListenRow) => {
  // Always re-read from storage in case Settings changed recently
  const latestPref = await getDefaultPlayer();
  debug('latestPref at open', latestPref, 'title =', item.title);
    const ok = await openByDefaultPlayer(item, latestPref);
    if (!ok) {
  toast('Could not open — try switching default player in Settings');
    }
  };

  const optimisticRemove = (id: string) => {
    setRows(curr => curr.filter(r => r.id !== id));
  };

  const optimisticMark = (id: string, done: boolean) => {
    const ts = done ? new Date().toISOString() : null;
    setRows(curr => curr.map(r => r.id === id ? { ...r, done_at: ts } : r));
  };

  // DERIVE filtered + sorted list
  const visibleRows = useMemo(() => {
    let list = rows.slice();

    // Filter
    switch (filterKey) {
      case 'tracks': list = list.filter(r => r.item_type === 'track'); break;
      case 'albums': list = list.filter(r => r.item_type === 'album'); break;
      case 'done':   list = list.filter(r => !!r.done_at); break;
      case 'all':
      default: break;
    }

  // Hide listened items except when explicitly viewing the Done filter
  if (filterKey !== 'done') {
    list = list.filter(r => !r.done_at);
  }

    // Derive content-kind for filtering without extra queries.
    // Safest fallback: treat item_type 'track' as 'single'; 'album' as 'album'
    // unless we have Spotify metadata that says the album is a single/ep.
    const getKind = (r: ListenRow): 'album' | 'single' => {
      // If stored as a track, consider it a single for UX purposes
      if (r.item_type === 'track') return 'single';
      // If we inferred single from Spotify metadata (albumType === 'single' or EP), mark as single
      if (r.spotify_id && singleMap[r.spotify_id] === true) return 'single';
      // If URL clearly points to a Spotify track, treat as single
      if (r.spotify_url && /open\.spotify\.com\/track\//.test(r.spotify_url)) return 'single';
      // If we inferred track-kind earlier, respect that too
      if (r.spotify_id && kindMap[r.spotify_id] === 'track') return 'single';
      // Fallback to album when unknown
      return 'album';
    };

    // Apply type filter
    if (typeFilter === 'album') {
      list = list.filter(r => getKind(r) === 'album');
    } else if (typeFilter === 'single') {
      list = list.filter(r => getKind(r) === 'single');
    }

    // Sort
    list.sort((a, b) => {
      if (sortKey === 'az') return (a.title || '').localeCompare(b.title || '');
      if (sortKey === 'za') return (b.title || '').localeCompare(a.title || '');

      // 'newest': prefer created_at, else rated_at/done_at as weak proxies
      const getT = (r: any) =>
        (r.created_at && Date.parse(r.created_at)) ||
        (r.rated_at && Date.parse(r.rated_at)) ||
        (r.done_at && Date.parse(r.done_at)) ||
        0;

      return getT(b) - getT(a);
    });

    return list;
  }, [rows, filterKey, sortKey, typeFilter, singleMap, kindMap]);

  // Helper: build a stable cache key
  const artKeyFor = (r: ListenRow) => {
    if (r.spotify_id) return `sp:${r.item_type}:${r.spotify_id}`;
    if (r.apple_id) return `ap:${r.item_type}:${r.apple_id}`;
    const a = (r.artist_name || '').trim().toLowerCase();
    const t = (r.title || '').trim().toLowerCase();
    return `t:${r.item_type}:${a}|${t}`;
  };

  // Fetch artwork for visible rows best-effort
  useEffect(() => {
    (async () => {
      const toFetch = visibleRows.slice(0, 40); // cap to keep it light
      for (const r of toFetch) {
        const key = artKeyFor(r);
        if (artMap[key]) continue;
        if (artPending.current.has(key)) continue;
        artPending.current.add(key);
        try {
          let url: string | null = null;
          let inferredKind: 'track' | 'album' | null = null;
          let isSingle: boolean | null = null;
          const lookupType: 'track' | 'album' = r.item_type === 'album' ? 'album' : 'track';
          if (r.spotify_id) {
            // Direct lookup by ID
            const res = await spotifyLookup(r.spotify_id, lookupType);
            const first = res?.[0];
            url = first?.imageUrl ?? null;
            {
              const albumType = String((first as any)?.albumType ?? '').toLowerCase();
              const singleLike = (first?.type === 'track') || albumType === 'single' || albumType === 'ep';
              inferredKind = singleLike ? 'track' : 'album';
              isSingle = singleLike ? true : null;
            }
          }
          if (!url) {
            // Fallback search by title+artist
            const q = `${r.title} ${r.artist_name ?? ''}`.trim();
            if (q) {
              const res = await spotifySearch(q);
              const match = res.find(x => x.type === lookupType);
              url = match?.imageUrl ?? null;
              const albumTypeM = String((match as any)?.albumType ?? '').toLowerCase();
              const singleLikeM = (match?.type === 'track') || albumTypeM === 'single' || albumTypeM === 'ep';
              inferredKind = singleLikeM ? 'track' : (match ? 'album' : inferredKind);
              if (isSingle == null) isSingle = singleLikeM ? true : null;
            }
          }
          if (url) {
            setArtMap(prev => {
              const next = { ...prev, [key]: url as string };
              // Persist with ts
              try {
                const store: any = {};
                Object.entries(next).forEach(([k,v]) => { store[k] = { url: v, ts: Date.now() }; });
                AsyncStorage.setItem(ART_CACHE_KEY, JSON.stringify(store)).catch(()=>{});
              } catch {}
              return next;
            });
          }
          if (inferredKind && r.spotify_id) {
            setKindMap(prev => ({ ...prev, [r.spotify_id!]: inferredKind! }));
          }
          if (r.spotify_id && isSingle != null) {
            setSingleMap(prev => ({ ...prev, [r.spotify_id!]: !!isSingle }));
          }
        } catch {}
        finally {
          artPending.current.delete(key);
          // trigger redraw to stop shimmer if needed
          setArtMap(prev => ({ ...prev }));
        }
      }
    })();
  }, [visibleRows]);

  return (
    <Screen>
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator />
        </View>
      ) : (
        <>
          <View
            style={{
              paddingVertical: 12,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Text style={{ fontSize: 22, fontWeight: '700', color: colors.text.secondary }}>Your Listen List</Text>
            <PlayerToggle />
          </View>

          {/* Content-type filter chips */}
          <View style={{ paddingVertical: 10, paddingHorizontal: 4, flexDirection: 'row', gap: 8 }}>
            <Chip label="All" selected={typeFilter === 'all'} onPress={() => setTypeFilter('all')} />
            <Chip label="Albums" selected={typeFilter === 'album'} onPress={() => setTypeFilter('album')} />
            <Chip label="Singles" selected={typeFilter === 'single'} onPress={() => setTypeFilter('single')} />
          </View>

          <FlatList
            data={visibleRows}
            keyExtractor={(r) => r.id}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            ListHeaderComponent={upcoming.length ? (
              <View style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border.subtle }}>
                <Text style={{ fontSize: 18, fontWeight: '700', marginBottom: 6, color: colors.text.secondary }}>Coming soon</Text>
                {(() => {
                  const map = new Map<string, UpcomingItem>();
                  for (const r of upcoming) {
                    const key = `${r.artist_id}|${(r.title || '').trim().toLowerCase()}|${r.release_date}`;
                    const existing = map.get(key);
                    if (!existing) { map.set(key, r); continue; }
                    const prefer = existing.source === 'apple' ? existing : r;
                    const other = existing.source === 'apple' ? r : existing;
                    map.set(key, prefer ?? other);
                  }
                  const today = new Date();
                  const sorted = Array.from(map.values()).sort((a,b) => a.release_date.localeCompare(b.release_date));
                  const fmtCountdown = (iso: string) => {
                    const d = new Date(iso + 'T00:00:00');
                    const diff = Math.ceil((d.getTime() - new Date(today.toDateString()).getTime()) / 86400000);
                    if (diff <= 0) return 'Today';
                    if (diff === 1) return 'Tomorrow';
                    return `In ${diff} days`;
                  };
                  return sorted.slice(0, 8).map((u) => (
                    <View key={u.id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border.subtle }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <View style={{ flex: 1, paddingRight: 12 }}>
                          <Text style={{ fontWeight: '600', color: colors.text.secondary }} numberOfLines={1}>{u.title}</Text>
                          {!!u.artist_name && <Text style={{ color: colors.text.muted }} numberOfLines={1}>{u.artist_name}</Text>}
                          <Text style={{ color: colors.text.muted, marginTop: 2 }}>Releases · {u.release_date} · {fmtCountdown(u.release_date)}</Text>
                        </View>
                        {!!u.source && (
                          <View style={{ marginRight: 10, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, backgroundColor: colors.bg.muted, borderWidth: 1, borderColor: colors.border.subtle }}>
                            <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text.secondary }}>{u.source === 'apple' ? 'APPLE' : 'MB'}</Text>
                          </View>
                        )}
                        <Pressable onPress={async () => {
                          const res = await addUpcomingToListen(u);
                          if (!res.ok) { H.error(); Alert.alert(res.message || 'Could not add'); return; }
                          H.success();
                          toast('Added to Listen');
                          await load();
                        }}>
                          <Text style={{ color: colors.accent.primary, fontWeight: '700' }}>Add</Text>
                        </Pressable>
                      </View>
                    </View>
                  ));
                })()}
              </View>
            ) : null}
            ListEmptyComponent={
              <View style={{ padding: 20, alignItems: 'center' }}>
                {!user ? (
                  <>
                    <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text.secondary }}>Sign in to see your Listen list</Text>
                    <Text style={{ marginTop: 6, color: colors.text.muted, textAlign: 'center' }}>
                      You’re not signed in. Please log in to load your items.
                    </Text>
                    <Pressable onPress={() => (navigation as any).navigate('login')} style={{ marginTop: 12, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.accent.primary }}>
                      <Text style={{ color: colors.text.inverted, fontWeight: '700' }}>Go to Login</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text.secondary }}>No items to show</Text>
                    <Text style={{ marginTop: 6, color: colors.text.muted, textAlign: 'center' }}>
                      Try resetting filters, or view listened items.
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                      <Pressable onPress={resetFilters} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.bg.muted }}>
                        <Text style={{ color: colors.text.secondary, fontWeight: '700', fontSize: 12 }}>Reset Filters</Text>
                      </Pressable>
                      <Pressable onPress={() => setFilterKey('done')} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.bg.muted }}>
                        <Text style={{ color: colors.text.secondary, fontWeight: '700', fontSize: 12 }}>Show Done</Text>
                      </Pressable>
                    </View>
                    <Text style={{ marginTop: 16, color: colors.text.muted, fontSize: 12 }}>
                      Tip: Add from Search via “Add to Listen List”.
                    </Text>
                  </>
                )}
              </View>
            }
            renderItem={({ item }) => (
              <SwipeRow
                isDone={!!item.done_at}
                onToggleDone={() => toggleDone(item)}
                onRemove={() => removeItem(item)}
                disabled={!!mutatingRef.current[item.id]}
                onHapticTap={H.tap}
                onHapticSuccess={H.success}
                onHapticError={H.error}
              >
                <GlassCard asChild style={{ marginHorizontal: 12, marginVertical: 4, padding: 0 }}>
                  <Pressable
                    onPress={() => onOpen(item)}
                    onLongPress={() => setMenuRow(item)}
                    delayLongPress={RELEASE_LONG_PRESS_MS}
                    style={({ pressed }) => ({
                      padding: 12,
                      opacity: pressed ? 0.92 : 1,
                      transform: [{ scale: pressed ? 0.995 : 1 }],
                    })}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                      {/* cover art */}
                      {(() => {
                        const key = artKeyFor(item);
                        const url = artMap[key];
                        const size = 54;
                        return (
                          <View style={{ width: size, height: size, borderRadius: 12, backgroundColor: colors.bg.muted, overflow: 'hidden' }}>
                            {url ? (
                              <Image source={{ uri: url }} style={{ width: size, height: size }} />
                            ) : (
                              <Shimmer w={size} h={size} r={12} />
                            )}
                          </View>
                        );
                      })()}

                      {/* text & actions */}
                      <View style={{ flex: 1, opacity: item.done_at ? 0.85 : 1 }}>
                        {/* subtle caption for item type (detect singles via spotify_url) */}
                        {(() => {
                          const label = (() => {
                            // Prefer Spotify metadata to decide single vs album
                            const isSingle = (item.spotify_id && singleMap[item.spotify_id] === true)
                              || (item.spotify_url && /open\.spotify\.com\/track\//.test(item.spotify_url))
                              || item.item_type === 'track';
                            return isSingle ? 'SINGLE' : 'ALBUM';
                          })();
                          return (
                            <Text style={{ fontSize: 10, fontWeight: '800', color: colors.text.muted, marginBottom: 6 }}>
                              {label}
                            </Text>
                          );
                        })()}
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <Text style={{ fontWeight: '600', fontSize: 16, flex: 1, color: colors.text.secondary }} numberOfLines={2}>
                            {item.title}
                          </Text>
                          <Stars value={item.rating} />
                          <Pressable
                            onPress={() => setMenuRow(item)}
                            hitSlop={8}
                            style={{ paddingHorizontal: 6, paddingVertical: 6 }}
                          >
                            <Text style={{ fontSize: 18, color: colors.text.muted }}>⋯</Text>
                          </Pressable>
                        </View>
                        <Text style={{ color: colors.text.muted, marginTop: 6 }} numberOfLines={1}>
                          {item.artist_name}
                        </Text>
                      </View>
                      {/* listened indicator removed; keep swipe-to-listened only */}
                    </View>
                  </Pressable>
                </GlassCard>
              </SwipeRow>
            )}
          />
      <RatingModal
        visible={ratingVisible}
        title={ratingTarget ? `Rate ${ratingTarget.title}` : 'Rate'}
        initial={ratingTarget?.rating ?? 0}
        initialDetails={ratingTarget?.rating_details as any}
        advanced={advancedRatings}
        statusLabel={ratingTarget?.done_at ? 'Marked as listened' : undefined}
        onUndoStatus={ratingTarget?.done_at ? async () => {
          if (!ratingTarget) return;
          // Optimistic revert
          optimisticMark(ratingTarget.id, false);
          closeRating();
          const res = await markDone(ratingTarget.id, false);
          if (!res.ok) {
            // rollback
            optimisticMark(ratingTarget.id, true);
            Alert.alert('Could not undo', res.message || 'Try again.');
          } else {
            await load();
          }
        } : undefined}
        onCancel={closeRating}
        onRateLater={() => {
          closeRating();
          try { router.push('/profile/pending'); } catch {}
          // eslint-disable-next-line no-console
          console.log('[rating] rate_later');
        }}
        onSubmit={async (stars, details) => {
          if (!ratingTarget) return closeRating();
          if (advancedRatings && details) {
            const { setRatingDetailed } = await import('../../lib/listen');
            const res = await setRatingDetailed(ratingTarget.id, stars, details);
            closeRating();
            await load();
            if (!res.ok) {
              Alert.alert('Could not save rating', res.message || 'Try again.');
            }
            return;
          }
          const { setRating } = await import('../../lib/listen');
          const res = await setRating(ratingTarget.id, stars);
          closeRating();
          await load();
          if (!res.ok) {
            Alert.alert('Could not save rating', res.message || 'Try again.');
          }
        }}
      />
      <StatusMenu
        row={menuRow}
        visible={!!menuRow}
        onClose={() => setMenuRow(null)}
        onChanged={(update) => {
          if (!update) return load();
          if (update.type === 'remove') {
            setRows(curr => curr.filter(r => r.id !== update.row.id));
            return;
          }
          if (update.type === 'mark') {
            setRows(curr => curr.map(r => r.id === update.row.id ? { ...r, done_at: update.done ? update.row.done_at : null } : r));
            return;
          }
          if (update.type === 'rate') {
            setRows(curr => curr.map(r => r.id === update.row.id ? { ...r, rating: update.row.rating } : r));
            return;
          }
          load();
        }}
      />
          <Snackbar
            visible={snack.visible}
            message="Marked listened"
            actionLabel="Undo"
            onAction={async () => {
              const r = snack.row;
              setSnack({ visible: false });
              if (!r) return;

              // optimistic undo locally
              setRows(curr => curr.map(x => x.id === r.id ? { ...x, done_at: null } : x));
              H.tap();
              const res = await markDone(r.id, false);
              if (!res.ok) {
                // restore listened state if undo fails
                setRows(curr => curr.map(x => x.id === r.id ? { ...x, done_at: new Date().toISOString() } : x));
                H.error();
                Alert.alert('Undo failed', res.message || 'Please try again.');
                return;
              }
              H.success();
            }}
            onTimeout={() => setSnack({ visible: false })}
          />
        </>
      )}
    </Screen>
  );
}
