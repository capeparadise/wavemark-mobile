import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native';
import Screen from '../../components/Screen';

import {
  fetchListenList,
  getDefaultPlayer,
  markDone,
  openByDefaultPlayer,
  removeListen,
  type ListenRow
} from '../../lib/listen';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { H } from '../../components/haptics';
import PlayerToggle from '../../components/PlayerToggle';
import RatingModal from '../../components/RatingModal';
import Snackbar from '../../components/Snackbar';
import SwipeRow from '../../components/SwipeRow';
import { debugNS } from '../../lib/debug';
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

type Player = 'apple' | 'spotify';

function DefaultBadge({ player }: { player: Player }) {
  return (
    <View
      style={{
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 10,
        backgroundColor: '#eef2ff',
        borderWidth: 1,
        borderColor: '#dbeafe',
      }}
    >
      <Text style={{ fontSize: 12, fontWeight: '700' }}>
        {player === 'apple' ? ' Music' : 'Spotify'}
      </Text>
    </View>
  );
}

export default function ListenTab() {
  const [rows, setRows] = useState<ListenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const prevRowsRef = useRef<ListenRow[]>([]);
  // simple per-row mutation lock to avoid races from rapid gestures
  const mutatingRef = useRef<Record<string, boolean>>({});
  const [defaultPlayer, setDefaultPlayer] = useState<Player>('apple');
  const [ratingTarget, setRatingTarget] = useState<ListenRow | null>(null);
  const [ratingVisible, setRatingVisible] = useState(false);
  const openRating = (row: ListenRow) => { setRatingTarget(row); setRatingVisible(true); };
  const closeRating = () => { setRatingVisible(false); setRatingTarget(null); };
  type FilterKey = 'all' | 'tracks' | 'albums' | 'done';
  type SortKey = 'newest' | 'az' | 'za';

  const [filterKey, setFilterKey] = useState<FilterKey>('all');
  const [sortKey, setSortKey] = useState<SortKey>('newest');
  const [snack, setSnack] = useState<{ visible: boolean; row?: ListenRow }>({ visible: false });

  const FILTER_KEY = 'listen_filter';
  const SORT_KEY = 'listen_sort';

  useEffect(() => {
    (async () => {
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
    const data = await fetchListenList();
    setRows(data);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
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
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
            }
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
                  <View style={{ paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#eee', gap: 6 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Text style={{ fontWeight: '600', flex: 1 }} numberOfLines={2}>
                        {item.title}
                      </Text>
                      <Stars value={item.rating} />
                    </View>
                    <Text style={{ color: '#666' }} numberOfLines={1}>
                      {item.artist_name}
                    </Text>

                    <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
                      <Pressable onPress={() => onOpen(item)}>
                        <Text style={{ color: '#22c55e', fontWeight: '700' }}>Open</Text>
                      </Pressable>
                      <Pressable onPress={() => openRating(item)}>
                        <Text style={{ color: '#64748b' }}>{item.rating ? `★ ${item.rating.toFixed(1)}` : 'Rate'}</Text>
                      </Pressable>
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
