import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
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
import ListenViewSwitcher from '../../components/ListenViewSwitcher';
import { bulkListenAction } from '../../lib/listenBulk';

import {
  addUpcomingToListen,
  fetchListenList,
  fetchUpcomingClient,
  getDefaultPlayer,
  reconcileListenUpcoming,
  removeListen,
  setDefaultPlayer as saveDefaultPlayer,
  type ListenPlayer,
  type ListenRow,
  type UpcomingItem,
} from '../../lib/listen';
import { goToRelease } from '../../lib/navigation';

import AsyncStorage from '@react-native-async-storage/async-storage';
import Chip from '../../components/Chip';
import { H } from '../../components/haptics';
import PlayerToggle from '../../components/PlayerToggle';
import RatingModal from '../../components/RatingModal';
import StatusMenu from '../../components/StatusMenu';
import Snackbar from '../../components/Snackbar';
import SwipeRow from '../../components/SwipeRow';
import { RELEASE_LONG_PRESS_MS } from '../../hooks/useReleaseActions';
import { off as offEvent, on as onEvent } from '../../lib/events';
import { useSession } from '../../lib/session';
import { markListened } from '../../lib/markListened';
import { beginListenedActivity, listenedActivityRevision, mergeListenedActivity, forgetListenedActivityRow } from '../../lib/listenedActivity';
import { useListenedActivity } from '../../hooks/useListenedActivity';
import { isSavePending, listenSaveRevision, mergeListenSavePreviews } from '../../lib/listenSavePreview';
import { spotifyLookup, spotifySearch } from '../../lib/spotify';
import { toast } from '../../lib/toast';
import { getAdvancedRatingsEnabled } from '../../lib/user';
import { useTheme } from '../../theme/useTheme';


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
  const { user } = useSession();
  return <ListenContent key={user?.id ?? 'signed-out'} />;
}

function ListenContent() {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const { user } = useSession();
  const [rows, setRows] = useState<ListenRow[]>(() => user?.id ? mergeListenSavePreviews(user.id, []) : []);
  const activityRevision = useListenedActivity();
  const [activityRead, setActivityRead] = useState(-1);
  const activeUserRef = useRef(user?.id);
  activeUserRef.current = user?.id;
  useEffect(() => () => { activeUserRef.current = undefined; }, []);
  const loadedUserRef = useRef<string | undefined>(undefined);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const bulkLock = useRef(false);
  useEffect(() => { setSelected(new Set()); setSelecting(false); }, [user?.id]);
  const toggleSelection = (item: ListenRow) => {
    if(bulkLock.current || item.done_at || isSavePending(item))return;
    setSelected(previous => { const next=new Set(previous); if(next.has(item.id))next.delete(item.id);else if(next.size<100)next.add(item.id); return next; });
  };
  const performBulk = (action: 'listened' | 'remove') => {
    if(bulkLock.current || !selected.size)return;
    const ids=[...selected];
    Alert.alert(action==='remove' ? 'Remove selected items?' : 'Mark selected as listened?',
      action==='remove' ? 'Only saved items without ratings or reviews will be removed. Listening history is protected.' : 'These items will move to History. You can rate them individually later.',
      [{text:'Cancel',style:'cancel'},{text:action==='remove'?'Remove':'Mark listened',style:action==='remove'?'destructive':'default',onPress:async()=>{
        if(bulkLock.current)return;bulkLock.current=true;setBulkBusy(true);
        const previews = action === 'listened' && user?.id
          ? rows.filter(row => ids.includes(row.id)).map(row => ({ row, preview: beginListenedActivity(user.id, row, true) }))
          : [];
        try {
          const changed=await bulkListenAction(ids,action);
          previews.forEach(({row, preview}) => changed.includes(row.id) ? preview.confirm(row) : preview.rollback());
          if (action === 'remove') changed.forEach(forgetListenedActivityRow);
          setRows(current=>action==='remove' ? current.filter(row=>!changed.includes(row.id)) : current.map(row=>changed.includes(row.id)?{...row,done_at:new Date().toISOString()}:row));
          setSelected(new Set());setSelecting(false);
          toast(`${changed.length} ${action==='remove'?'removed':'marked as listened'}${changed.length<ids.length?' · Other items were kept unchanged':''}`);
          void load({force:true});
        }catch(e:any){previews.forEach(({preview}) => preview.rollback());Alert.alert('Could not update selection',e.message);}
        finally{bulkLock.current=false;setBulkBusy(false);}
      }}]);
  };
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
  const [snack, setSnack] = useState<{ visible: boolean; row?: ListenRow; message?: string }>({ visible: false });
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
  useEffect(() => { setSelected(new Set()); }, [typeFilter, filterKey]);

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
    loadedUserRef.current = undefined;
    lastFetchRef.current = 0;
    setRows(user?.id ? mergeListenSavePreviews(user.id, []) : []);
    setUpcoming([]);
    (async () => {
      if (!user?.id) return;
      try {
        const raw = await AsyncStorage.getItem(`${LISTEN_CACHE_KEY}_${user.id}`);
        if (raw && mounted) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && loadedUserRef.current !== user.id) setRows(mergeListenSavePreviews(user.id, parsed as ListenRow[]));
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

  // Stay subscribed even while another tab is visible. Lazy first mounts also
  // read the same account-scoped overlays above, so no save event can be missed.
  useEffect(() => {
    const update = (account?: string) => {
      if (account && account === user?.id) setRows(current => mergeListenSavePreviews(account, current));
    };
    onEvent('listen:save-preview', update);
    if (user?.id) update(user.id);
    return () => offEvent('listen:save-preview', update);
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
    const account = user?.id;
    const readRevision = listenSaveRevision();
    const activityReadRevision = listenedActivityRevision();
    if (rows.length === 0 && !refreshing) setLoading(true);
    try {
      // Upcoming-release lookup must not hold the saved list behind another request.
      void fetchUpcomingClient().then(soon => {
        if (activeUserRef.current !== account) return;
        setUpcoming(soon);
        if (account) void AsyncStorage.setItem(`${UPCOMING_CACHE_KEY}_${account}`, JSON.stringify(soon)).catch(() => {});
      }).catch(() => {});
      const data = await fetchListenList();
      if (activeUserRef.current !== account) return;
      loadedUserRef.current = account;
      setRows(account ? mergeListenSavePreviews(account, data, readRevision) : []);
      setActivityRead(activityReadRevision);
      lastFetchRef.current = Date.now();
      if (user?.id) {
        try { await AsyncStorage.setItem(`${LISTEN_CACHE_KEY}_${user.id}`, JSON.stringify(data)); } catch {}
      }
    } catch {
      // Keep cached rows and pending saves on transient network failure.
    } finally {
      inFlightRef.current = false;
      setLoading(false);
      // A save can finish while this read is running. Its forced refresh would
      // otherwise be dropped by the in-flight lock, leaving stale data cached.
      if (activeUserRef.current === account && (readRevision !== listenSaveRevision() || activityReadRevision !== listenedActivityRevision())) {
        void load({ force: true });
      }
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
    const unsub = (navigation as any).addListener('tabPress', () => { load({ force: true }); });
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

    const res = await markListened(row, user?.id, nextDone);
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

  const chooseDefaultPlayer = useCallback(async (player: ListenPlayer) => {
    setDefaultPlayer(player);
    await saveDefaultPlayer(player);
  }, []);

  const onOpen = (item: ListenRow) => {
    goToRelease(item.id, { preferredPlayer: defaultPlayer });
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
    // The external-store revision invalidates this memo when another screen acts.
    void activityRevision;
    let list = mergeListenedActivity(user?.id, rows, filterKey === 'done' ? 'history' : 'list', activityRead);

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
  }, [rows, filterKey, sortKey, typeFilter, singleMap, kindMap, user?.id, activityRead, activityRevision]);

  const selectableRows = useMemo(
    () => visibleRows.filter(row => !row.done_at && !isSavePending(row)).slice(0, 100),
    [visibleRows],
  );
  const allVisibleSelected = selectableRows.length > 0
    && selectableRows.every(row => selected.has(row.id));
  const toggleSelectAll = () => {
    if (bulkBusy || !selectableRows.length) return;
    if (allVisibleSelected) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(selectableRows.map(row => row.id)));
    if (visibleRows.filter(row => !row.done_at).length > 100) {
      toast('Selected the first 100 items');
    }
  };

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
        const persistedArtwork = typeof r.artwork_url === 'string' && r.artwork_url.trim()
          ? r.artwork_url.trim()
          : null;
        if (persistedArtwork) {
          if (!artMap[key]) {
            setArtMap(prev => {
              if (prev[key]) return prev;
              const next = { ...prev, [key]: persistedArtwork };
              try {
                const store: any = {};
                Object.entries(next).forEach(([k,v]) => { store[k] = { url: v, ts: Date.now() }; });
                AsyncStorage.setItem(ART_CACHE_KEY, JSON.stringify(store)).catch(()=>{});
              } catch {}
              return next;
            });
          }
          continue;
        }
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
            <View style={{ flex: 1, marginRight: 12 }}><ListenViewSwitcher value="releases" /></View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <PlayerToggle value={defaultPlayer} onChange={chooseDefaultPlayer} />
              <Pressable
                disabled={bulkBusy}
                accessibilityRole="button"
                accessibilityLabel={selecting ? 'Exit multi-select' : 'Select multiple releases'}
                accessibilityState={{ selected: selecting, disabled: bulkBusy }}
                onPress={() => { setSelecting(!selecting); setSelected(new Set()); }}
                hitSlop={6}
                style={({ pressed }) => ({
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1,
                  borderColor: selecting ? colors.accent.primary : colors.border.subtle,
                  backgroundColor: selecting ? `${colors.accent.primary}20` : colors.bg.secondary,
                  opacity: bulkBusy ? 0.5 : pressed ? 0.72 : 1,
                })}
              >
                <Ionicons name={selecting ? 'checkbox' : 'checkbox-outline'} size={22} color={selecting ? colors.accent.primary : colors.text.secondary} />
              </Pressable>
            </View>
          </View>

          {/* Content-type filter chips */}
          {selecting && (
            <View
              style={{
                marginVertical: 6,
                padding: 12,
                gap: 10,
                borderRadius: 18,
                borderWidth: 1,
                borderColor: colors.border.subtle,
                backgroundColor: colors.bg.secondary,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ color: colors.text.secondary, fontWeight: '800' }}>
                  {selected.size} selected
                </Text>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityLabel={allVisibleSelected ? 'Clear all selections' : 'Select all visible items'}
                  accessibilityState={{ checked: allVisibleSelected, disabled: bulkBusy || !selectableRows.length }}
                  disabled={bulkBusy || !selectableRows.length}
                  onPress={toggleSelectAll}
                  hitSlop={8}
                  style={({ pressed }) => ({
                    minHeight: 36,
                    paddingHorizontal: 8,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 7,
                    opacity: bulkBusy || !selectableRows.length ? 0.45 : pressed ? 0.68 : 1,
                  })}
                >
                  <Ionicons
                    name={allVisibleSelected ? 'checkbox' : 'square-outline'}
                    size={20}
                    color={colors.accent.primary}
                  />
                  <Text style={{ color: colors.accent.primary, fontWeight: '800' }}>
                    {allVisibleSelected ? 'Clear all' : 'Select all'}
                  </Text>
                </Pressable>
              </View>

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Mark selected items as listened"
                  disabled={bulkBusy || !selected.size}
                  onPress={() => performBulk('listened')}
                  style={({ pressed }) => ({
                    flex: 1,
                    minHeight: 44,
                    borderRadius: 13,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 7,
                    backgroundColor: colors.accent.primary,
                    opacity: bulkBusy || !selected.size ? 0.38 : pressed ? 0.78 : 1,
                  })}
                >
                  <Ionicons name="checkmark-circle-outline" size={19} color={colors.text.inverted} />
                  <Text style={{ color: colors.text.inverted, fontWeight: '800' }}>
                    {bulkBusy ? 'Updating…' : 'Mark listened'}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Remove selected items from Listen List"
                  disabled={bulkBusy || !selected.size}
                  onPress={() => performBulk('remove')}
                  style={({ pressed }) => ({
                    flex: 1,
                    minHeight: 44,
                    borderRadius: 13,
                    borderWidth: 1,
                    borderColor: '#ff6b6b55',
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 7,
                    backgroundColor: '#ff6b6b10',
                    opacity: bulkBusy || !selected.size ? 0.38 : pressed ? 0.72 : 1,
                  })}
                >
                  <Ionicons name="trash-outline" size={18} color="#ff6b6b" />
                  <Text style={{ color: '#ff6b6b', fontWeight: '800' }}>Remove</Text>
                </Pressable>
              </View>
            </View>
          )}
          <View style={{ paddingVertical: 10, paddingHorizontal: 4, flexDirection: 'row', gap: 8 }}>
            <Chip label="All" selected={typeFilter === 'all'} onPress={() => setTypeFilter('all')} />
            <Chip label="Albums" selected={typeFilter === 'album'} onPress={() => setTypeFilter('album')} />
            <Chip label="Singles" selected={typeFilter === 'single'} onPress={() => setTypeFilter('single')} />
          </View>

          <FlatList
            data={visibleRows}
            keyExtractor={(r) => r.id}
            contentContainerStyle={{ paddingBottom: 112 }}
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
                disabled={selecting || bulkBusy || isSavePending(item) || !!mutatingRef.current[item.id]}
                onHapticTap={H.tap}
                onHapticSuccess={H.success}
                onHapticError={H.error}
              >
                <View style={{ marginHorizontal: 2, borderBottomWidth: 1, borderBottomColor: colors.border.subtle }}>
                  <Pressable
                    disabled={isSavePending(item)}
                    accessibilityRole={selecting ? 'checkbox' : 'button'}
                    accessibilityState={selecting ? {checked:selected.has(item.id),disabled:!!item.done_at || bulkBusy} : undefined}
                    accessibilityLabel={item.title}
                    onPress={() => selecting ? toggleSelection(item) : onOpen(item)}
                    onLongPress={() => {if(!selecting)setMenuRow(item);}}
                    delayLongPress={RELEASE_LONG_PRESS_MS}
                    style={({ pressed }) => ({
                      paddingVertical: 14,
                      opacity: pressed ? 0.92 : 1,
                      transform: [{ scale: pressed ? 0.995 : 1 }],
                    })}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                      {/* cover art */}
                      {selecting ? (
                        <View
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: 7,
                            borderWidth: item.done_at || selected.has(item.id) ? 0 : 1.5,
                            borderColor: colors.border.muted,
                            backgroundColor: item.done_at
                              ? colors.bg.muted
                              : selected.has(item.id)
                                ? colors.accent.primary
                                : 'transparent',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {item.done_at ? (
                            <Ionicons name="remove" size={15} color={colors.text.muted} />
                          ) : selected.has(item.id) ? (
                            <Ionicons name="checkmark" size={17} color={colors.text.inverted} />
                          ) : null}
                        </View>
                      ) : null}
                      {(() => {
                        const key = artKeyFor(item);
                        const persistedArtwork = typeof item.artwork_url === 'string' && item.artwork_url.trim()
                          ? item.artwork_url.trim()
                          : null;
                        const url = persistedArtwork || artMap[key];
                        const size = 62;
                        return (
                          <View style={{ width: size, height: size, borderRadius: 11, backgroundColor: colors.bg.muted, overflow: 'hidden' }}>
                            {url ? (
                              <Image source={{ uri: url }} style={{ width: size, height: size }} />
                            ) : (
                              <Shimmer w={size} h={size} r={11} />
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
                            <Text style={{ fontSize: 10, fontWeight: '900', letterSpacing: 0.8, color: colors.accent.primary, marginBottom: 4 }}>
                              {label}
                            </Text>
                          );
                        })()}
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <Text style={{ fontWeight: '800', fontSize: 16, flex: 1, color: colors.text.secondary }} numberOfLines={2}>
                            {item.title}
                          </Text>
                          <Stars value={item.rating} />
                          <Pressable
                            disabled={isSavePending(item)}
                            onPress={() => selecting ? toggleSelection(item) : setMenuRow(item)}
                            hitSlop={8}
                            style={{ paddingHorizontal: 6, paddingVertical: 6 }}
                          >
                            {isSavePending(item) ? <ActivityIndicator size="small" color={colors.text.muted} /> : <Text style={{ fontSize: 18, color: colors.text.muted }}>⋯</Text>}
                          </Pressable>
                        </View>
                        <Text style={{ color: colors.text.muted, marginTop: 4, fontSize: 13 }} numberOfLines={1}>
                          {item.artist_name}
                        </Text>
                      </View>
                      {/* listened indicator removed; keep swipe-to-listened only */}
                    </View>
                  </Pressable>
                </View>
              </SwipeRow>
            )}
          />
      <RatingModal
        visible={ratingVisible}
        title={ratingTarget ? `Rate ${ratingTarget.title}` : 'Rate'}
        initial={ratingTarget?.rating ?? 0}
        initialDetails={ratingTarget?.rating_details as any}
        initialReview={ratingTarget?.review}
        itemType={ratingTarget?.item_type}
        advanced={advancedRatings}
        statusLabel={ratingTarget?.done_at ? 'Marked as listened' : undefined}
        onUndoStatus={ratingTarget?.done_at ? async () => {
          if (!ratingTarget) return;
          // Optimistic revert
          optimisticMark(ratingTarget.id, false);
          closeRating();
          const res = await markListened(ratingTarget, user?.id, false);
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
        onSubmit={async (stars, details, review) => {
          if (!ratingTarget) return closeRating();
          const target = ratingTarget;
          const options = { doneAt: ratingTarget.done_at || new Date().toISOString() };
          const { setRating, setRatingDetailed } = await import('../../lib/listen');
          const res = details
            ? await setRatingDetailed(target.id, stars, details, review, options)
            : await setRating(target.id, stars, review, options);
          if (!res.ok) {
            Alert.alert('Could not save rating', res.message || 'Try again.');
            return;
          }
          // Apply the confirmed write immediately; load() normally has a 15s throttle.
          setRows(curr => curr.map(row => row.id === target.id
            ? { ...row, ...res.row, done_at: options.doneAt }
            : row));
          closeRating();
          H.success();
          setSnack({ visible: true, message: 'Rated and marked as listened' });
          void load({ force: true });
        }}
      />
      <StatusMenu
        row={menuRow}
        visible={!!menuRow}
        onClose={() => setMenuRow(null)}
        onRate={(row) => {
          setMenuRow(null);
          setTimeout(() => openRating(row), 350);
        }}
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
            message={snack.message || 'Marked listened'}
            actionLabel="Undo"
            onAction={snack.row ? async () => {
              const r = snack.row;
              setSnack({ visible: false });
              if (!r) return;

              // optimistic undo locally
              setRows(curr => curr.map(x => x.id === r.id ? { ...x, done_at: null } : x));
              H.tap();
              const res = await markListened(r, user?.id, false);
              if (!res.ok) {
                // restore listened state if undo fails
                setRows(curr => curr.map(x => x.id === r.id ? { ...x, done_at: new Date().toISOString() } : x));
                H.error();
                Alert.alert('Undo failed', res.message || 'Please try again.');
                return;
              }
              H.success();
            } : undefined}
            onTimeout={() => setSnack({ visible: false })}
          />
        </>
      )}
    </Screen>
  );
}
