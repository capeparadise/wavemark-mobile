import React, { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, Text, View } from 'react-native';
import { openArtist } from '../lib/openArtist';
import { parseSpotifyUrlOrId, spotifyLookup } from '../lib/spotify';
import { emit } from '../lib/events';
import {
  ensureListenRowForSearch,
  markDone,
  markDoneByProvider,
  openByDefaultPlayer,
  removeListen,
  removeListenByProvider,
  setRating,
  setRatingDetailed,
  type ListenRow,
} from '../lib/listen';
import { useTheme } from '../theme/useTheme';
import RatingModal from './RatingModal';

export type ReleaseActionSheetRow = ListenRow & {
  artist_id?: string | null;
  artistId?: string | null;
  in_list?: boolean;
};

export type ReleaseActionSheetProps = {
  row: ReleaseActionSheetRow | null;
  visible: boolean;
  onClose: () => void;
  onChanged?: (update?: { type: 'mark' | 'remove' | 'rate'; row: ListenRow; done?: boolean }) => void;
};

function isUuid(s?: string | null) {
  return !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

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

export default function ReleaseActionSheet({ row, visible, onClose, onChanged }: ReleaseActionSheetProps) {
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const [ratingVisible, setRatingVisible] = useState(false);
  const [ratingRow, setRatingRow] = useState<ListenRow | null>(null);

  const run = async (fn: () => Promise<any>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      onClose();
    } catch (e: any) {
      Alert.alert('Action failed', e?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const ctx = useMemo(() => {
    if (!row) return null;
    const anyRow: any = row;
    const done = !!row.done_at;

    const provider: 'spotify' | 'apple' =
      anyRow.provider === 'apple' || (!!anyRow.apple_url && !anyRow.spotify_url)
        ? 'apple'
        : 'spotify';

    const provider_id =
      anyRow.provider_id ||
      anyRow.spotify_id ||
      anyRow.apple_id ||
      anyRow.providerId ||
      (provider === 'spotify' ? spotifyKey(anyRow.id || null, anyRow.spotify_url || null) : null) ||
      (!isUuid(anyRow.id) ? anyRow.id : null) ||
      null;

    const inList =
      typeof anyRow.in_list === 'boolean'
        ? anyRow.in_list
        : isUuid(anyRow.id) || !!anyRow.created_at;

    const artistId =
      (typeof anyRow.artist_id === 'string' ? anyRow.artist_id : null) ||
      (typeof anyRow.artistId === 'string' ? anyRow.artistId : null) ||
      null;

    const artistName =
      (typeof anyRow.artist_name === 'string' ? anyRow.artist_name : null) ||
      (typeof anyRow.artistName === 'string' ? anyRow.artistName : null) ||
      (typeof anyRow.artist === 'string' ? anyRow.artist : null) ||
      null;

    return { done, provider, provider_id, inList, artistId, artistName };
  }, [row]);

  if (!row || !ctx) return null;

  const ensureRow = async () => {
    if (isUuid(row.id)) {
      return row as ListenRow;
    }
    const res = await ensureListenRowForSearch(row);
    if (!res.ok || !res.row) throw new Error(res.message || 'Could not save item');
    return res.row as ListenRow;
  };

  const resolveAndOpenArtist = async () => {
    const directId = (ctx.artistId || '').trim();
    if (/^[A-Za-z0-9]{22}$/.test(directId)) {
      openArtist(directId, { name: ctx.artistName });
      return;
    }

    if (ctx.provider !== 'spotify') {
      Alert.alert('Artist unavailable', 'This item does not have a Spotify artist id.');
      return;
    }

    const direct = (() => {
      if (typeof (row as any).spotify_url === 'string') {
        return parseSpotifyUrlOrId((row as any).spotify_url);
      }
      if (typeof row.id === 'string' && /^[A-Za-z0-9]{22}$/.test(row.id) && !isUuid(row.id)) {
        return { id: row.id, lookupType: 'album' as const };
      }
      return null;
    })();

    const tryLookup = async (id: string, lookupType: 'album' | 'track') => {
      const results = await spotifyLookup(id, lookupType);
      const first = results?.[0];
      const artistId = first?.artistId ?? null;
      const name = first?.artist ?? ctx.artistName ?? null;
      if (artistId && /^[A-Za-z0-9]{22}$/.test(artistId)) {
        openArtist(artistId, { name });
        return true;
      }
      return false;
    };

    try {
      if (direct) {
        const ok = await tryLookup(direct.id, direct.lookupType);
        if (ok) return;
        if (direct.lookupType === 'album') {
          const ok2 = await tryLookup(direct.id, 'track');
          if (ok2) return;
        } else {
          const ok2 = await tryLookup(direct.id, 'album');
          if (ok2) return;
        }
      } else if (ctx.provider_id && /^[A-Za-z0-9]{22}$/.test(ctx.provider_id)) {
        const ok = await tryLookup(ctx.provider_id, 'album');
        if (ok) return;
        const ok2 = await tryLookup(ctx.provider_id, 'track');
        if (ok2) return;
      }
    } catch {}

    Alert.alert('Artist unavailable', 'Could not resolve an artist id for this item.');
  };

  const onAdd = async () => {
    await ensureRow();
    onChanged?.();
    emit('listen:updated');
    emit('listen:refresh');
  };

  const onMark = async (done: boolean) => {
    const providerId = ctx.provider_id;
    if (!isUuid(row.id) && providerId) {
      await run(async () => {
        const { data: mdData, error: mdErr } = await markDoneByProvider({ provider: ctx.provider, provider_id: providerId, makeDone: done });
        if (mdErr) throw new Error(mdErr.message || 'Could not update item');
        if (!mdData) {
          const created = await ensureRow();
          await markDone(created.id, done);
          onChanged?.({ type: 'mark', row: { ...created, done_at: done ? new Date().toISOString() : null } as any, done });
        } else {
          onChanged?.({ type: 'mark', row: { ...(row as any), done_at: done ? new Date().toISOString() : null } as any, done });
        }
        emit('listen:updated');
        emit('listen:refresh');
      });
      if (done) {
        const r = await ensureRow();
        setRatingRow({ ...r, done_at: new Date().toISOString() });
        setRatingVisible(true);
      }
      return;
    }

    const r = await ensureRow();
      await run(async () => {
        await markDone(r.id, done);
        onChanged?.({ type: 'mark', row: { ...r, done_at: done ? new Date().toISOString() : null } as ListenRow, done });
        emit('listen:updated');
      });
    if (done) {
      setRatingRow({ ...r, done_at: new Date().toISOString() });
      setRatingVisible(true);
    }
  };

  const onRemove = async () => {
    if (!ctx.inList) return;
    if (isUuid(row.id)) {
      await run(async () => {
        await removeListen(row.id);
        onChanged?.({ type: 'remove', row: row as ListenRow });
        emit('listen:updated');
        emit('listen:refresh');
      });
      return;
    }
    if (ctx.provider_id) {
      await run(async () => {
        const res = await removeListenByProvider({ provider: ctx.provider, provider_id: ctx.provider_id! });
        if (!res.ok) throw new Error(res.message || 'Could not remove item');
        onChanged?.({ type: 'remove', row: row as ListenRow });
        emit('listen:updated');
        emit('listen:refresh');
      });
    }
  };

  const onOpenLink = async () => {
    try {
      const r = await ensureRow();
      await openByDefaultPlayer(r);
    } catch (e: any) {
      Alert.alert('Could not open', e?.message || 'Try again.');
    }
  };

  const actions = [
    ...(ctx.artistId || ctx.provider === 'spotify'
      ? [{ label: 'View artist profile', onPress: () => run(resolveAndOpenArtist) }]
      : []),
    ...(ctx.done
      ? [{ label: 'Add back to Listen List', onPress: () => onMark(false) }]
      : [{ label: 'Mark as listened', onPress: () => onMark(true) }]),
    {
      label: (typeof (row as any).rating === 'number' && !Number.isNaN((row as any).rating)) ? 'Change rating' : 'Rate',
      onPress: async () => {
        const r = await ensureRow();
        setRatingRow(r);
        setRatingVisible(true);
      },
    },
    { label: 'Open in music app', onPress: onOpenLink },
    ...(ctx.inList ? [] : [{ label: 'Add to Listen List', onPress: () => run(onAdd) }]),
    ...(ctx.inList
      ? [
          {
            label: ctx.done ? 'Remove from history' : 'Remove from Listen List',
            onPress: onRemove,
            destructive: true,
          },
        ]
      : []),
  ];

  return (
    <>
      <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
        <Pressable style={{ flex: 1, backgroundColor: colors.overlay.dim }} onPress={onClose} />
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: colors.bg.primary,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            padding: 16,
            paddingBottom: 22,
            gap: 8,
          }}
        >
          {actions.map((a) => (
            <Pressable
              key={a.label}
              disabled={busy}
              onPress={a.onPress}
              style={{
                paddingVertical: 12,
                paddingHorizontal: 6,
                borderRadius: 12,
                backgroundColor: colors.bg.muted,
              }}
            >
              <Text style={{ fontSize: 16, fontWeight: '700', color: a.destructive ? '#b91c1c' : colors.text.secondary }}>
                {a.label}
              </Text>
            </Pressable>
          ))}
          <Pressable onPress={onClose} style={{ paddingVertical: 12, paddingHorizontal: 6 }}>
            <Text style={{ textAlign: 'center', fontSize: 16, fontWeight: '600', color: colors.text.secondary }}>Cancel</Text>
          </Pressable>
        </View>
      </Modal>

      <RatingModal
        visible={ratingVisible}
        title={ratingRow ? `Rate ${ratingRow.title}` : 'Rate'}
        initial={ratingRow?.rating ?? 0}
        initialDetails={ratingRow?.rating_details as any}
        advanced={false}
        onCancel={() => setRatingVisible(false)}
        onSubmit={async (stars, details) => {
          setRatingVisible(false);
          const target = ratingRow || (row as ListenRow);
          setBusy(true);
          try {
            if (details && Object.keys(details || {}).length) {
              await setRatingDetailed(target.id, stars, details);
            } else {
              await setRating(target.id, stars);
            }
            onChanged?.({ type: 'rate', row: { ...target, rating: stars } as ListenRow });
            emit('listen:refresh');
            onClose();
          } catch (e: any) {
            Alert.alert('Could not save rating', e?.message || 'Please try again.');
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}
