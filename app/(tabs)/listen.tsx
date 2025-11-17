import { useFocusEffect } from '@react-navigation/native';
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

import {
    addUpcomingToListen,
    fetchListenList,
    fetchUpcomingClient,
    getDefaultPlayer,
    markDone,
    openByDefaultPlayer,
    reconcileListenUpcoming,
    removeListen,
    type ListenPlayer,
    type ListenRow,
    type UpcomingItem,
} from '../../lib/listen';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { H } from '../../components/haptics';
import PlayerToggle from '../../components/PlayerToggle';
import RatingModal from '../../components/RatingModal';
import Snackbar from '../../components/Snackbar';
import SwipeRow from '../../components/SwipeRow';
import { debugNS } from '../../lib/debug';
import { spotifyLookup, spotifySearch } from '../../lib/spotify';
import { toast } from '../../lib/toast';

const debug = debugNS('ListenTab');

function Stars({ value }: { value?: number | null }) {
  if (!value && value !== 0) return null;
  return (
    <Text style={{ marginLeft: 8, fontSize: 12, opacity: 0.8 }}>
      ★ {Number(value).toFixed(1)}
    </Text>
  );
}

export default function ListenTab() {
  const [rows, setRows] = useState<ListenRow[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const prevRowsRef = useRef<ListenRow[]>([]);
  // simple per-row mutation lock to avoid races from rapid gestures
  const mutatingRef = useRef<Record<string, boolean>>({});
  const [defaultPlayer, setDefaultPlayer] = useState<ListenPlayer>('apple');
  const [ratingTarget, setRatingTarget] = useState<ListenRow | null>(null);
  const [ratingVisible, setRatingVisible] = useState(false);
  const openRating = (row: ListenRow) => { setRatingTarget(row); setRatingVisible(true); };
  const closeRating = () => { setRatingVisible(false); setRatingTarget(null); };
  type FilterKey = 'all' | 'tracks' | 'albums' | 'done';
  type SortKey = 'newest' | 'az' | 'za';

  const [filterKey, setFilterKey] = useState<FilterKey>('all');
  const [sortKey, setSortKey] = useState<SortKey>('newest');
  const [snack, setSnack] = useState<{ visible: boolean; row?: ListenRow }>({ visible: false });
  // Artwork cache (persisted)
  const [artMap, setArtMap] = useState<Record<string, string>>({});
  const artPending = useRef<Set<string>>(new Set());
  const ART_CACHE_KEY = 'listenArtCacheV1';

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
    return <Animated.View style={{ position: 'absolute', top: 0, left: 0, width: w, height: h, borderRadius: r, backgroundColor: '#e5e7eb', opacity }} />;
  };

  const FILTER_KEY = 'listen_filter';
  const SORT_KEY = 'listen_sort';

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
      if (f === 'all' || f === 'tracks' || f === 'albums' || f === 'done') setFilterKey(f as FilterKey);
      if (s === 'newest' || s === 'az' || s === 'za') setSortKey(s as SortKey);
    })();
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(FILTER_KEY, filterKey).catch(() => {});
  }, [filterKey]);

  useEffect(() => {
    AsyncStorage.setItem(SORT_KEY, sortKey).catch(() => {});
  }, [sortKey]);

  const load = useCallback(async () => {
    setLoading(true);
  const [data, soon] = await Promise.all([fetchListenList(), fetchUpcomingClient()]);
  setRows(data);
  setUpcoming(soon);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        await reconcileListenUpcoming();
        await load();
      })();
    }, [load])
  );

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
    await load();
    setRefreshing(false);
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
      // Open rating modal immediately for this item
      openRating({ ...row, done_at: nowIso } as ListenRow);
      setSnack({ visible: true, row });
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

  // Always hide listened items from the Listen tab
  list = list.filter(r => !r.done_at);

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
  }, [rows, filterKey, sortKey]);

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
          if (r.spotify_id) {
            // Direct lookup by ID
            const res = await spotifyLookup(r.spotify_id, r.item_type);
            const first = res?.[0];
            url = first?.imageUrl ?? null;
          }
          if (!url) {
            // Fallback search by title+artist
            const q = `${r.title} ${r.artist_name ?? ''}`.trim();
            if (q) {
              const res = await spotifySearch(q);
              const match = res.find(x => x.type === r.item_type);
              url = match?.imageUrl ?? null;
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
              borderBottomWidth: 1,
              borderBottomColor: '#eee',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Text style={{ fontSize: 22, fontWeight: '700' }}>Your Listen List</Text>
            <PlayerToggle />
          </View>

          <FlatList
            data={visibleRows}
            keyExtractor={(r) => r.id}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            ListHeaderComponent={upcoming.length ? (
              <View style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee' }}>
                <Text style={{ fontSize: 18, fontWeight: '700', marginBottom: 6 }}>Coming soon</Text>
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
                    <View key={u.id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <View style={{ flex: 1, paddingRight: 12 }}>
                          <Text style={{ fontWeight: '600' }} numberOfLines={1}>{u.title}</Text>
                          {!!u.artist_name && <Text style={{ color: '#6b7280' }} numberOfLines={1}>{u.artist_name}</Text>}
                          <Text style={{ color: '#64748b', marginTop: 2 }}>Releases · {u.release_date} · {fmtCountdown(u.release_date)}</Text>
                        </View>
                        {!!u.source && (
                          <View style={{ marginRight: 10, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0' }}>
                            <Text style={{ fontSize: 12, fontWeight: '700', color: '#334155' }}>{u.source === 'apple' ? 'APPLE' : 'MB'}</Text>
                          </View>
                        )}
                        <Pressable onPress={async () => {
                          const res = await addUpcomingToListen(u);
                          if (!res.ok) { H.error(); Alert.alert(res.message || 'Could not add'); return; }
                          H.success();
                          toast('Added to Listen');
                          await load();
                        }}>
                          <Text style={{ color: '#2563eb', fontWeight: '700' }}>Add</Text>
                        </Pressable>
                      </View>
                    </View>
                  ));
                })()}
              </View>
            ) : null}
            ListEmptyComponent={
              <View style={{ padding: 20 }}>
                <Text style={{ fontSize: 18, fontWeight: '600' }}>
                  Nothing here yet
                </Text>
                <Text style={{ marginTop: 8, color: '#666' }}>
                  Find an artist in Search and tap “Add to Listen List”.
                </Text>
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
                <Pressable onLongPress={() => openRating(item)}>
                  <View style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      {/* cover art */}
                      {(() => {
                        const key = artKeyFor(item);
                        const url = artMap[key];
                        const size = 56;
                        return (
                          <View style={{ width: size, height: size, borderRadius: 8, backgroundColor: '#f3f4f6', overflow: 'hidden' }}>
                            {url ? (
                              <Image source={{ uri: url }} style={{ width: size, height: size }} />
                            ) : (
                              <Shimmer w={size} h={size} r={8} />
                            )}
                          </View>
                        );
                      })()}

                      {/* text & actions */}
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <Text style={{ fontWeight: '600', flex: 1 }} numberOfLines={2}>
                            {item.title}
                          </Text>
                          <Stars value={item.rating} />
                        </View>
                        <Text style={{ color: '#666' }} numberOfLines={1}>
                          {item.artist_name}
                        </Text>
                        <View style={{ flexDirection: 'row', gap: 12, marginTop: 8, alignItems: 'center' }}>
                          <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: '#eef2ff' }}>
                            <Text style={{ fontSize: 10, fontWeight: '800', color: '#3730a3' }}>{item.item_type.toUpperCase()}</Text>
                          </View>
                          <Pressable onPress={() => onOpen(item)}>
                            <Text style={{ color: '#22c55e', fontWeight: '700' }}>Open</Text>
                          </Pressable>
                          <Pressable onPress={() => openRating(item)}>
                            <Text style={{ color: '#64748b' }}>{item.rating ? `★ ${item.rating.toFixed(1)}` : 'Rate'}</Text>
                          </Pressable>
                        </View>
                      </View>
                    </View>
                  </View>
                </Pressable>
              </SwipeRow>
            )}
          />
          <RatingModal
            visible={ratingVisible}
            title={ratingTarget ? `Rate ${ratingTarget.title}` : 'Rate'}
            initial={ratingTarget?.rating ?? 0}
            onCancel={closeRating}
            onSubmit={async (stars) => {
              if (!ratingTarget) return closeRating();
              const { setRating } = await import('../../lib/listen');
              const res = await setRating(ratingTarget.id, stars);
              closeRating();
              await load();
              if (!res.ok) {
                Alert.alert('Could not save rating', res.message || 'Try again.');
              }
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
