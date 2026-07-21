import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Alert, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import GlassCard from '../../components/GlassCard';
import { formatDate } from '../../lib/date';
import { addToListFromSearch, getDefaultPlayer, openByDefaultPlayer, type ListenPlayer, type ListenRow } from '../../lib/listen';
import { type SimpleAlbum } from '../../lib/recommend';
import { parseSpotifyUrlOrId, spotifyLookup, spotifyResolveRelease, spotifySearch, type SpotifyResult } from '../../lib/spotify';
import { buildAlbumUrl, buildTrackUrl, fetchAllAlbums, fetchCollectionById, fetchCollectionTracksById, fetchTrackById } from '../../lib/apple';
import { artistAlbums } from '../../lib/spotifyArtist';
import { supabase } from '../../lib/supabase';
import { openArtist } from '../../lib/openArtist';
import { useTheme } from '../../theme/useTheme';
import { goToRelease } from '../../lib/navigation';
import { normalizeReleasePresentationType, parseTrackCount, releasePresentationLabel, type ReleasePresentationType, type ReleaseTrack } from '../../lib/releaseModel';

export const options = { title: 'Release', headerShown: false };

type ReleaseDetails = {
  id: string;
  provider: 'spotify' | 'apple' | 'unknown';
  providerId?: string | null;
  title: string;
  artistName?: string | null;
  artistId?: string | null;
  releaseDate?: string | null;
  releaseType?: ReleasePresentationType | 'album' | 'ep' | 'track' | 'compilation' | null;
  totalTracks?: number | null;
  tracks?: ReleaseTrack[];
  artworkUrl?: string | null;
  spotifyUrl?: string | null;
  spotifyId?: string | null;
  appleUrl?: string | null;
  appleId?: string | null;
  appleTrackId?: string | null;
  appleAlbumId?: string | null;
  appleStorefront?: string | null;
  isrc?: string | null;
  itemType?: 'album' | 'track';
};

const isUuid = (s?: string | null) => !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab]{1}[0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);

const extractAppleId = (value: string): number | null => {
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value);
  try {
    const u = new URL(value);
    const qId = u.searchParams.get('i');
    if (qId && /^\d+$/.test(qId)) return Number(qId);
    const album = u.pathname.match(/\/album\/[^/]+\/(\d+)/);
    if (album?.[1]) return Number(album[1]);
    const song = u.pathname.match(/\/song\/[^/]+\/(\d+)/);
    if (song?.[1]) return Number(song[1]);
  } catch {}
  return null;
};

const releaseTimestamp = (value?: string | null) => {
  if (!value) return 0;
  let normalized = String(value);
  if (/^\d{4}$/.test(normalized)) normalized = `${normalized}-07-01`;
  else if (/^\d{4}-\d{2}$/.test(normalized)) normalized = `${normalized}-15`;
  const timestamp = Date.parse(normalized);
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const formatDuration = (durationMs?: number | null) => {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0) return null;
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

export default function ReleaseScreen() {
  const { colors } = useTheme();
  const params = useLocalSearchParams<{
    id?: string;
    spotifyId?: string;
    spotifyUrl?: string;
    title?: string;
    artistName?: string;
    imageUrl?: string;
    type?: string;
    artistId?: string;
    releaseDate?: string;
    preferredPlayer?: string;
    totalTracks?: string;
  }>();
  const getParam = (v: string | string[] | undefined) => Array.isArray(v) ? v[0] : v;
  const releaseId = String(getParam(params.id) || '').trim();
  const spotifyIdParam = String(getParam(params.spotifyId) || '').trim();
  const artistIdParam = String(getParam(params.artistId) || '').trim();
  const spotifyUrlParam = String(getParam(params.spotifyUrl) || '').trim();
  const titleParam = String(getParam(params.title) || '').trim();
  const artistNameParam = String(getParam(params.artistName) || '').trim();
  const imageUrlParam = String(getParam(params.imageUrl) || '').trim();
  const typeParam = String(getParam(params.type) || '').trim();
  const releaseDateParam = String(getParam(params.releaseDate) || '').trim();
  const preferredPlayerParam = String(getParam(params.preferredPlayer) || '').trim();
  const totalTracksParam = String(getParam(params.totalTracks) || '').trim();
  const paramKey = [
    releaseId,
    spotifyIdParam,
    spotifyUrlParam,
    titleParam,
    artistNameParam,
    imageUrlParam,
    typeParam,
    artistIdParam,
    releaseDateParam,
    totalTracksParam,
  ].join('|');
  const lastParamKeyRef = React.useRef<string>('');
  const paramDetail = useMemo<ReleaseDetails | null>(() => {
    const spotifyUrl = spotifyUrlParam || null;
    const spotifyId = spotifyIdParam || null;
    const title = titleParam || null;
    const artistName = artistNameParam || null;
    const imageUrl = imageUrlParam || null;
    const type = (typeParam || '').toLowerCase();
    const artistId = artistIdParam || null;
    const releaseDate = releaseDateParam || null;
    const totalTracks = parseTrackCount(totalTracksParam);
    if (!spotifyUrl && !spotifyId && !title && !artistName && !imageUrl) return null;
    const isTrack = type === 'track';
    const releaseType = normalizeReleasePresentationType(totalTracks, isTrack ? 'single' : type);
    return {
      id: releaseId || String(spotifyId || ''),
      provider: 'spotify',
      providerId: spotifyId || releaseId || null,
      title: title || 'Release',
      artistName,
      artistId,
      releaseDate,
      releaseType,
      totalTracks,
      tracks: [],
      artworkUrl: imageUrl,
      spotifyUrl,
      spotifyId: spotifyId || null,
      appleUrl: null,
      appleId: null,
      appleTrackId: null,
      appleAlbumId: null,
      appleStorefront: null,
      isrc: null,
      itemType: isTrack ? 'track' : 'album',
    };
  }, [
    releaseId,
    spotifyIdParam,
    spotifyUrlParam,
    titleParam,
    artistNameParam,
    imageUrlParam,
    typeParam,
    artistIdParam,
    releaseDateParam,
    totalTracksParam,
  ]);

  const [release, setRelease] = useState<ReleaseDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [preferredPlayer, setPreferredPlayer] = useState<ListenPlayer>('spotify');
  const [moreByArtist, setMoreByArtist] = useState<SimpleAlbum[]>([]);
  const [moreByArtistLoading, setMoreByArtistLoading] = useState(false);
  const [savedTrackIds, setSavedTrackIds] = useState<Set<string>>(new Set());
  const [savingTrackIds, setSavingTrackIds] = useState<Set<string>>(new Set());
  const skeletonTiles = useMemo(() => Array.from({ length: 5 }, (_, i) => i), []);
  const lastMoreByKeyRef = React.useRef<string>('');

  const releaseKey = String(release?.spotifyId || release?.providerId || spotifyIdParam || releaseId || '').trim();
  const artistKey = String(release?.artistId || artistIdParam || '').trim();
  const artistNameKey = String(release?.artistName || artistNameParam || '').trim().toLowerCase();
  const moreByKey = artistKey || artistNameKey ? `${release?.provider || 'unknown'}:${artistKey || artistNameKey}:${releaseKey}` : '';
  const releaseTracks = useMemo(() => release?.tracks ?? [], [release?.tracks]);

  const sameIds = useCallback((a: SimpleAlbum[], b: SimpleAlbum[]) => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      const ak = String(a[i]?.id || a[i]?.spotifyUrl || a[i]?.title || '');
      const bk = String(b[i]?.id || b[i]?.spotifyUrl || b[i]?.title || '');
      if (ak !== bk) return false;
    }
    return true;
  }, []);

  const trackProviderId = useCallback((track: ReleaseTrack) => {
    return String(track.providerId || track.id || '').trim();
  }, []);

  const trackSaveKey = useCallback((track: ReleaseTrack) => {
    const provider = track.provider === 'apple' ? 'apple' : 'spotify';
    const providerId = trackProviderId(track);
    return providerId ? `${provider}:${providerId}` : '';
  }, [trackProviderId]);

  useEffect(() => {
    if (preferredPlayerParam === 'apple' || preferredPlayerParam === 'spotify') {
      setPreferredPlayer(preferredPlayerParam);
      return;
    }
    getDefaultPlayer().then(setPreferredPlayer).catch(() => {});
  }, [preferredPlayerParam]);

  useEffect(() => {
    const urls = moreByArtist.map((it) => it.imageUrl).filter(Boolean) as string[];
    urls.slice(0, 6).forEach((url) => {
      Image.prefetch(url).catch(() => {});
    });
  }, [moreByArtist]);

  useEffect(() => {
    let active = true;
    const loadSavedTracks = async () => {
      const trackKeys = releaseTracks
        .map((track) => ({ key: trackSaveKey(track), provider: track.provider === 'apple' ? 'apple' : 'spotify', providerId: trackProviderId(track) }))
        .filter((item) => !!item.key && !!item.providerId);
      if (!trackKeys.length) {
        setSavedTrackIds(new Set());
        return;
      }
      try {
        const { data: auth } = await supabase.auth.getUser();
        const user = auth?.user ?? null;
        if (!user) {
          if (active) setSavedTrackIds(new Set());
          return;
        }
        const spotifyIds = trackKeys.filter((item) => item.provider === 'spotify').map((item) => item.providerId);
        const appleIds = trackKeys.filter((item) => item.provider === 'apple').map((item) => item.providerId);
        const found = new Set<string>();

        if (spotifyIds.length) {
          const { data } = await supabase
            .from('listen_list')
            .select('provider,provider_id,spotify_id')
            .eq('user_id', user.id)
            .eq('provider', 'spotify')
            .in('provider_id', spotifyIds);
          (data || []).forEach((row: any) => {
            const providerId = String(row.provider_id || row.spotify_id || '').trim();
            if (providerId) found.add(`spotify:${providerId}`);
          });
        }

        if (appleIds.length) {
          const { data } = await supabase
            .from('listen_list')
            .select('provider,provider_id,apple_id,apple_track_id')
            .eq('user_id', user.id)
            .eq('provider', 'apple')
            .in('provider_id', appleIds);
          (data || []).forEach((row: any) => {
            const providerId = String(row.provider_id || row.apple_track_id || row.apple_id || '').trim();
            if (providerId) found.add(`apple:${providerId}`);
          });
        }

        if (active) setSavedTrackIds(found);
      } catch {
        if (active) setSavedTrackIds(new Set());
      }
    };

    loadSavedTracks();
    return () => {
      active = false;
    };
  }, [releaseTracks, trackProviderId, trackSaveKey]);

  useEffect(() => {
    if (!paramDetail) return;
    if (lastParamKeyRef.current === paramKey) return;
    lastParamKeyRef.current = paramKey;
    setRelease(paramDetail);
    setLoading(false);
  }, [paramDetail, paramKey]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!paramDetail) setLoading(true);
      setError(null);
      setAdded(false);
      if (!releaseId) {
        setError('Missing release id');
        if (!paramDetail) setLoading(false);
        return;
      }

      let detail: ReleaseDetails | null = paramDetail ? { ...paramDetail } : null;

      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user ?? null;

      const mapListenRow = (row: any): ReleaseDetails => {
        const provider: 'spotify' | 'apple' = row.provider === 'apple' || (!!row.apple_url && !row.spotify_url) ? 'apple' : 'spotify';
        const itemType = row.item_type === 'album' ? 'album' : 'track';
        const releaseType = normalizeReleasePresentationType(null, itemType === 'track' ? 'single' : 'project');
        return {
          id: String(row.id || releaseId),
          provider,
          providerId: row.provider_id ?? row.spotify_id ?? row.apple_id ?? releaseId,
          title: row.title || 'Untitled',
          artistName: row.artist_name ?? null,
          artistId: row.artist_id ?? null,
          releaseDate: row.release_date ?? null,
          releaseType,
          totalTracks: null,
          tracks: [],
          artworkUrl: row.artwork_url ?? null,
          spotifyUrl: row.spotify_url ?? null,
          spotifyId: row.spotify_id ?? null,
          appleUrl: row.apple_url ?? null,
          appleId: row.apple_id ?? null,
          appleTrackId: row.apple_track_id ?? null,
          appleAlbumId: row.apple_album_id ?? null,
          appleStorefront: row.apple_storefront ?? null,
          isrc: null,
          itemType,
        };
      };

      try {
        if (user) {
          if (isUuid(releaseId)) {
            const { data, error: rowErr } = await supabase
              .from('listen_list')
              .select('*')
              .eq('user_id', user.id)
              .eq('id', releaseId)
              .maybeSingle();
            if (!rowErr && data) {
              detail = mapListenRow(data);
              if (active) setAdded(true);
            }
          }

          if (!detail) {
            const { data, error: rowErr } = await supabase
              .from('listen_list')
              .select('*')
              .eq('user_id', user.id)
              .or(`provider_id.eq.${releaseId},spotify_id.eq.${releaseId},apple_id.eq.${releaseId}`)
              .maybeSingle();
            if (!rowErr && data) {
              detail = mapListenRow(data);
              if (active) setAdded(true);
            }
          }
        }
      } catch {}

      if (!detail || (detail.provider === 'spotify' && detail.itemType === 'album')) {
        const spotifyInput = detail?.spotifyUrl || detail?.spotifyId || detail?.providerId || paramDetail?.spotifyUrl || paramDetail?.spotifyId || releaseId;
        const parsed = parseSpotifyUrlOrId(String(spotifyInput || ''));
        const applySpotifyResult = (r: SpotifyResult, currentDetail: ReleaseDetails | null): ReleaseDetails => {
          const totalTracks = parseTrackCount(r.totalTracks) ?? parseTrackCount(r.tracks?.length);
          const releaseType = normalizeReleasePresentationType(totalTracks, r.type === 'track' ? 'single' : r.albumType);
          return {
            id: currentDetail?.id || releaseId,
            provider: 'spotify',
            providerId: r.id,
            title: r.title || 'Untitled',
            artistName: r.artist ?? null,
            artistId: r.artistId ?? null,
            releaseDate: r.releaseDate ?? null,
            releaseType,
            totalTracks,
            tracks: r.tracks ?? [],
            artworkUrl: r.imageUrl ?? null,
            spotifyUrl: r.spotifyUrl ?? null,
            spotifyId: r.id,
            appleUrl: null,
            appleId: null,
            appleTrackId: null,
            appleAlbumId: null,
            appleStorefront: null,
            isrc: r.isrc ?? null,
            itemType: r.type === 'track' ? 'track' : 'album',
          };
        };
        if (parsed) {
          try {
            let results = await spotifyLookup(parsed.id, parsed.lookupType);
            if (!results?.length && parsed.lookupType === 'album') {
              results = await spotifyLookup(parsed.id, 'track');
            }
            const r = results?.[0];
            if (r) {
              detail = applySpotifyResult(r, detail);
            }
          } catch {}
        }
        const shouldResolveAlbumTracks =
          (!detail || (detail.provider === 'spotify' && detail.itemType === 'album' && (detail.tracks?.length ?? 0) < 2));
        if (shouldResolveAlbumTracks) {
          const resolveTitle = String(detail?.title || titleParam || '').trim();
          const resolveArtist = String(detail?.artistName || artistNameParam || '').trim();
          if (resolveTitle) {
            try {
              const resolved = await spotifyResolveRelease('album', resolveTitle, resolveArtist || undefined);
              if (resolved) detail = applySpotifyResult(resolved, detail);
            } catch {}
          }
        }
      }

      if (!detail || (detail.provider === 'apple' && detail.itemType === 'album')) {
        const appleId = extractAppleId(String(detail?.appleAlbumId || detail?.appleId || detail?.providerId || releaseId));
        if (appleId) {
          try {
            const album = await fetchCollectionById(appleId);
            if (album) {
              const tracks = await fetchCollectionTracksById(album.collectionId).catch(() => []);
              const totalTracks = parseTrackCount(album.trackCount) ?? parseTrackCount(tracks.length);
              const releaseType = normalizeReleasePresentationType(totalTracks, 'project');
              detail = {
                id: releaseId,
                provider: 'apple',
                providerId: String(album.collectionId),
                title: album.collectionName || 'Untitled',
                artistName: album.artistName ?? null,
                artistId: String(album.artistId),
                releaseDate: album.releaseDate ?? null,
                releaseType,
                totalTracks,
                tracks,
                artworkUrl: album.artworkUrl ?? null,
                spotifyUrl: null,
                spotifyId: null,
                appleUrl: buildAlbumUrl(album.collectionId, album.collectionName),
                appleId: String(album.collectionId),
                appleTrackId: null,
                appleAlbumId: String(album.collectionId),
                appleStorefront: null,
                isrc: null,
                itemType: 'album',
              };
            }
            if (!detail) {
              const track = await fetchTrackById(appleId);
              if (track) {
                detail = {
                  id: releaseId,
                  provider: 'apple',
                  providerId: String(track.trackId),
                  title: track.trackName || 'Untitled',
                  artistName: track.artistName ?? null,
                  artistId: String(track.artistId),
                  releaseDate: track.releaseDate ?? null,
                  releaseType: 'single',
                  totalTracks: 1,
                  tracks: [],
                  artworkUrl: track.artworkUrl ?? null,
                  spotifyUrl: null,
                  spotifyId: null,
                  appleUrl: buildTrackUrl(track.trackId, track.trackName),
                  appleId: String(track.trackId),
                  appleTrackId: String(track.trackId),
                  appleAlbumId: null,
                  appleStorefront: null,
                  isrc: null,
                  itemType: 'track',
                };
              }
            }
          } catch {}
        }
      }

      if (!detail && paramDetail) {
        detail = paramDetail;
      }

      if (!detail) {
        setError('Could not load this release.');
        if (!paramDetail) setLoading(false);
        return;
      }

      if (!active) return;
      setRelease(detail);
      if (!paramDetail) setLoading(false);
    };

    load();

    return () => {
      active = false;
    };
  }, [releaseId]);

  const loadMoreByArtist = useCallback(async () => {
    const artistName = String(release?.artistName || '').trim();
    if (!release || (!artistKey && !artistName)) {
      setMoreByArtist([]);
      return;
    }

    setMoreByArtistLoading(true);
    const currentIds = new Set(
      [
        release.id,
        releaseId,
        release.providerId,
        release.spotifyId,
        release.appleId,
      ]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    );
    const currentUrlSet = new Set(
      [release.spotifyUrl, release.appleUrl]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    );
    const currentTitleKey = `${(release.title || '').trim().toLowerCase()}::${String(release.releaseDate || '').trim()}`;

    try {
      let nextItems: SimpleAlbum[] = [];

      if (release.provider === 'spotify' && /^[A-Za-z0-9]{22}$/.test(artistKey)) {
        const albums = await artistAlbums(artistKey, 'from_token').catch(() => artistAlbums(artistKey, 'GB')).catch(() => []);
        nextItems = albums.map((item) => ({
          id: item.id,
          title: item.title,
          artist: item.artist,
          artistId: artistKey,
          releaseDate: item.releaseDate ?? null,
          spotifyUrl: item.spotifyUrl ?? null,
          imageUrl: item.imageUrl ?? null,
          type: normalizeReleasePresentationType(item.totalTracks ?? null, item.type),
          totalTracks: item.totalTracks ?? null,
        }));
      }

      if (!nextItems.length && release.provider === 'spotify' && artistName) {
        const norm = (value: string | null | undefined) => String(value || '')
          .toLowerCase()
          .normalize('NFKD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, ' ')
          .trim();
        const wantedArtist = norm(artistName);
        const results = await spotifySearch(artistName, 'album,track').catch(() => []);
        const grouped = new Map<string, { album?: SpotifyResult; tracks: SpotifyResult[] }>();
        results
          .filter((item) => item.type === 'album' || item.type === 'track')
          .filter((item) => {
            if (artistKey && item.artistId) return item.artistId === artistKey;
            return norm(item.artist) === wantedArtist;
          })
          .forEach((item) => {
            const key = String(item.albumId || item.id || `${norm(item.title)}::${item.releaseDate || ''}::${item.imageUrl || ''}`).trim();
            if (!key) return;
            const group = grouped.get(key) ?? { tracks: [] };
            if (item.type === 'album') group.album = item;
            else group.tracks.push(item);
            grouped.set(key, group);
          });

        const groupedItems: (SimpleAlbum | null)[] = await Promise.all(Array.from(grouped.entries()).map(async ([albumId, group]) => {
          const album = group.album ?? (albumId && /^[A-Za-z0-9]{22}$/.test(albumId)
            ? await spotifyLookup(albumId, 'album').then((items) => items[0] ?? null).catch(() => null)
            : null);
          const fallback = group.tracks[0];
          const source = album ?? fallback;
          if (!source) return null;
          return {
            id: album?.id ?? albumId,
            title: album?.title ?? source.title,
            artist: album?.artist ?? source.artist ?? artistName,
            artistId: album?.artistId ?? source.artistId ?? (artistKey || null),
            releaseDate: album?.releaseDate ?? source.releaseDate ?? null,
            spotifyUrl: album?.spotifyUrl ?? source.spotifyUrl ?? null,
            imageUrl: album?.imageUrl ?? source.imageUrl ?? null,
            type: normalizeReleasePresentationType(album?.totalTracks ?? null, album?.albumType ?? source.type),
            totalTracks: album?.totalTracks ?? null,
          } satisfies SimpleAlbum;
        }));
        nextItems = groupedItems.filter((item): item is SimpleAlbum => item != null);
      } else if (release.provider === 'apple') {
        const appleArtistId = extractAppleId(artistKey) ?? (/^\d+$/.test(artistKey) ? Number(artistKey) : null);
        if (appleArtistId) {
          const albums = await fetchAllAlbums(appleArtistId);
          nextItems = albums.map((item) => ({
            id: String(item.collectionId),
            title: item.collectionName,
            artist: item.artistName,
            artistId: String(item.artistId),
            releaseDate: item.releaseDate ?? null,
            spotifyUrl: null,
            imageUrl: item.artworkUrl ?? null,
            type: normalizeReleasePresentationType(item.trackCount ?? null, 'project'),
            totalTracks: item.trackCount ?? null,
          }));
        }
      }

      nextItems = nextItems
        .filter((item) => {
          const itemIds = [item.id, item.spotifyUrl].map((value) => String(value || '').trim()).filter(Boolean);
          if (itemIds.some((value) => currentIds.has(value) || currentUrlSet.has(value))) return false;
          const itemTitleKey = `${(item.title || '').trim().toLowerCase()}::${String(item.releaseDate || '').trim()}`;
          return itemTitleKey !== currentTitleKey;
        })
        .sort((a, b) => releaseTimestamp(b.releaseDate) - releaseTimestamp(a.releaseDate));

      const deduped: SimpleAlbum[] = [];
      const seen = new Set<string>();
      nextItems.forEach((item) => {
        const normalizedTitle = (item.title || '').trim().toLowerCase();
        const releaseLevelKey = normalizedTitle ? [
          normalizedTitle,
          (item.artist || '').trim().toLowerCase(),
        ].join('::') : '';
        const key = [releaseLevelKey, item.id, item.spotifyUrl]
          .map((value) => String(value || '').trim())
          .find(Boolean);
        if (!key || seen.has(key)) return;
        seen.add(key);
        deduped.push(item);
      });

      const limited = deduped.slice(0, 5);
      setMoreByArtist((prev) => (sameIds(prev, limited) ? prev : limited));
    } catch {
      setMoreByArtist((prev) => (prev.length ? prev : []));
    } finally {
      setMoreByArtistLoading(false);
    }
  }, [artistKey, release, releaseId, sameIds]);

  useEffect(() => {
    if (!moreByKey) {
      setMoreByArtist([]);
      return;
    }
    if (lastMoreByKeyRef.current === moreByKey) return;
    lastMoreByKeyRef.current = moreByKey;
    loadMoreByArtist();
  }, [loadMoreByArtist, moreByKey]);

  const metaLine = useMemo(() => {
    if (!release) return null;
    const typeLabel = release.releaseType ? releasePresentationLabel(release.releaseType) : null;
    const year = release.releaseDate ? String(release.releaseDate).slice(0, 4) : null;
    const parts = [typeLabel, year].filter(Boolean);
    return parts.length ? parts.join(' · ') : null;
  }, [release]);

  const onAdd = useCallback(async () => {
    if (!release || adding || added) return;
    setAdding(true);
    try {
      const type = release.itemType === 'album' ? 'album' : 'single';
      const res = await addToListFromSearch({
        type,
        title: release.title,
        artist: release.artistName ?? null,
        releaseDate: release.releaseDate ?? null,
        spotifyUrl: release.spotifyUrl ?? null,
        appleUrl: release.appleUrl ?? null,
        imageUrl: release.artworkUrl ?? null,
        providerId: release.providerId ?? null,
        isrc: release.isrc ?? null,
      });
      if (res.ok) {
        setAdded(true);
      } else {
        Alert.alert('Could not add', res.message || 'Please try again.');
      }
    } finally {
      setAdding(false);
    }
  }, [adding, added, release]);

  const onSaveTrack = useCallback(async (track: ReleaseTrack) => {
    if (!release) return;
    const key = trackSaveKey(track);
    const providerId = trackProviderId(track);
    if (!key || !providerId || savedTrackIds.has(key) || savingTrackIds.has(key)) return;

    setSavingTrackIds((prev) => new Set(prev).add(key));
    try {
      const provider = track.provider === 'apple' ? 'apple' : 'spotify';
      const spotifyUrl = provider === 'spotify'
        ? (track.spotifyUrl || (providerId ? `https://open.spotify.com/track/${providerId}` : null))
        : null;
      const appleUrl = provider === 'apple' ? (track.appleUrl ?? null) : null;
      const res = await addToListFromSearch({
        type: 'track',
        title: track.title,
        artist: track.artist ?? release.artistName ?? null,
        releaseDate: release.releaseDate ?? null,
        spotifyUrl,
        appleUrl,
        artworkUrl: release.artworkUrl ?? null,
        providerId,
      });
      if (res.ok) {
        setSavedTrackIds((prev) => new Set(prev).add(key));
      } else {
        Alert.alert('Could not save track', res.message || 'Please try again.');
      }
    } finally {
      setSavingTrackIds((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, [release, savedTrackIds, savingTrackIds, trackProviderId, trackSaveKey]);

  const onOpenExternal = useCallback(async () => {
    if (!release) return;
    if (preferredPlayer === 'spotify' && release.spotifyUrl) {
      try {
        await Linking.openURL(release.spotifyUrl);
        return;
      } catch {}
    }
    const row: ListenRow = {
      id: release.id,
      item_type: release.itemType === 'album' ? 'album' : 'track',
      provider: release.provider === 'apple' ? 'apple' : 'spotify',
      provider_id: release.providerId ?? null,
      title: release.title,
      artist_name: release.artistName ?? null,
      artwork_url: release.artworkUrl ?? null,
      release_date: release.releaseDate ?? null,
      apple_url: release.appleUrl ?? null,
      apple_id: release.appleId ?? null,
      apple_track_id: release.appleTrackId ?? null,
      apple_album_id: release.appleAlbumId ?? null,
      apple_storefront: release.appleStorefront ?? null,
      isrc: release.isrc ?? null,
      spotify_url: release.spotifyUrl ?? null,
      spotify_id: release.spotifyId ?? null,
      done_at: null,
    };
    const ok = await openByDefaultPlayer(row, preferredPlayer);
    if (!ok) {
      Alert.alert(
        'Could not open',
        preferredPlayer === 'apple'
          ? 'Could not open an Apple Music link for this release.'
          : 'Try switching your default player in Settings.'
      );
    }
  }, [release, preferredPlayer]);

  const onOpenArtist = useCallback(async () => {
    if (!release) return;
    const artistId = String(release.artistId || '').trim();
    if (artistId) {
      if (/^[A-Za-z0-9]{22}$/.test(artistId)) {
        openArtist(artistId, { name: release.artistName ?? null });
        return;
      }
      if (/^\d+$/.test(artistId)) {
        router.push({
          pathname: '/artist/[id]',
          params: { id: artistId, name: release.artistName ?? undefined },
        });
        return;
      }
    }

    if (release.provider === 'spotify') {
      const candidate = release.spotifyId || release.providerId || '';
      if (/^[A-Za-z0-9]{22}$/.test(candidate)) {
        try {
          let results = await spotifyLookup(candidate, 'album');
          if (!results?.length) results = await spotifyLookup(candidate, 'track');
          const resolved = results?.[0]?.artistId ?? null;
          if (resolved) {
            openArtist(resolved, { name: release.artistName ?? null });
            return;
          }
        } catch {}
      }
    }

    if (release.provider === 'apple') {
      const candidate = release.appleId || release.providerId || '';
      const appleId = extractAppleId(String(candidate));
      if (appleId) {
        try {
          const album = await fetchCollectionById(appleId);
          if (album?.artistId) {
            router.push({
              pathname: '/artist/[id]',
              params: { id: String(album.artistId), name: release.artistName ?? undefined },
            });
            return;
          }
          const track = await fetchTrackById(appleId);
          if (track?.artistId) {
            router.push({
              pathname: '/artist/[id]',
              params: { id: String(track.artistId), name: release.artistName ?? undefined },
            });
            return;
          }
        } catch {}
      }
    }

    Alert.alert('Artist unavailable', 'Could not resolve an artist profile for this release.');
  }, [release]);

  const openLabel = preferredPlayer === 'apple' ? 'Open in Apple Music' : 'Open in Spotify';
  const primaryCtaLabel = added ? openLabel : adding ? 'Adding...' : 'Add to Listen list';
  const onPrimaryCtaPress = added ? onOpenExternal : onAdd;
  const heroArtworkSize = 220;
  const moreByLabel = release?.artistName ? `More by ${release.artistName}` : 'More by this artist';

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg.primary }}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {release?.artworkUrl ? (
          <Image
            source={{ uri: release.artworkUrl }}
            style={StyleSheet.absoluteFill}
            blurRadius={28}
          />
        ) : null}
        <LinearGradient
          colors={['rgba(5,8,14,0.18)', 'rgba(7,10,16,0.74)', 'rgba(7,10,16,0.96)']}
          locations={[0, 0.38, 1]}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={['rgba(0,0,0,0.62)', 'rgba(0,0,0,0.18)', 'transparent']}
          locations={[0, 0.38, 1]}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 320 }}
        />
      </View>

      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={{ paddingBottom: 44 }}>
          <View style={{ paddingHorizontal: 20, paddingTop: 14 }}>
            <Pressable
              onPress={() => router.back()}
              hitSlop={10}
              style={({ pressed }) => ({
                width: 42,
                height: 42,
                borderRadius: 21,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.overlay.dim,
                borderWidth: 1,
                borderColor: colors.overlay.softLight,
                opacity: pressed ? 0.9 : 1,
              })}
            >
              <Ionicons name="chevron-back" size={20} color={colors.text.inverted} />
            </Pressable>
          </View>

          {loading && !release ? (
            <View style={{ paddingVertical: 48, alignItems: 'center' }}>
              <ActivityIndicator />
            </View>
          ) : (
            <>
              {error ? (
                <Text style={{ color: colors.text.muted, paddingHorizontal: 20 }}>{error}</Text>
              ) : null}

              <View style={{ paddingHorizontal: 20, paddingTop: 18 }}>
                <View style={{ alignItems: 'center' }}>
                  <View
                    style={{
                      width: heroArtworkSize,
                      height: heroArtworkSize,
                      borderRadius: 30,
                      overflow: 'hidden',
                      backgroundColor: colors.bg.muted,
                      borderWidth: 1,
                      borderColor: colors.overlay.softLight,
                    }}
                  >
                    {release?.artworkUrl ? (
                      <Image source={{ uri: release.artworkUrl }} style={{ width: heroArtworkSize, height: heroArtworkSize }} />
                    ) : (
                      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ color: colors.text.muted, fontWeight: '900', fontSize: 40 }}>{(release?.title || 'R').slice(0, 1)}</Text>
                      </View>
                    )}
                  </View>
                </View>

                <View style={{ marginTop: 22, alignItems: 'center' }}>
                  <Text style={{ fontSize: 31, lineHeight: 36, fontWeight: '900', color: colors.text.inverted, textAlign: 'center' }} numberOfLines={3}>
                    {release?.title || 'Release'}
                  </Text>
                  {release?.artistName ? (
                    <Pressable onPress={onOpenArtist} disabled={!release?.artistName} hitSlop={8} style={{ marginTop: 10 }}>
                      <Text style={{ color: colors.text.subtle, fontWeight: '700', fontSize: 16 }} numberOfLines={1}>
                        {release.artistName}
                      </Text>
                    </Pressable>
                  ) : null}
                  {metaLine ? (
                    <Text style={{ color: colors.text.subtle, marginTop: 12, fontWeight: '700', fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase' }}>
                      {metaLine}
                    </Text>
                  ) : null}
                  {!!release?.releaseDate ? (
                    <Text style={{ color: colors.text.muted, marginTop: 6, fontSize: 13 }}>
                      {formatDate(release.releaseDate)}
                    </Text>
                  ) : null}
                </View>
              </View>

              <View style={{ paddingHorizontal: 20, marginTop: 24 }}>
                <Pressable
                  onPress={onPrimaryCtaPress}
                  disabled={adding}
                  style={({ pressed }) => ({
                    paddingVertical: 15,
                    borderRadius: 16,
                    backgroundColor: colors.accent.primary,
                    borderWidth: 1,
                    borderColor: colors.accent.primary,
                    opacity: pressed ? 0.92 : 1,
                  })}
                >
                  <Text style={{ textAlign: 'center', fontWeight: '800', color: colors.text.inverted }}>
                    {primaryCtaLabel}
                  </Text>
                </Pressable>

                {!added ? (
                  <Pressable
                    onPress={onOpenExternal}
                    style={({ pressed }) => ({
                      alignSelf: 'center',
                      marginTop: 12,
                      paddingHorizontal: 16,
                      paddingVertical: 10,
                      borderRadius: 999,
                      backgroundColor: 'transparent',
                      borderWidth: 1,
                      borderColor: colors.overlay.softLight,
                      opacity: pressed ? 0.88 : 1,
                    })}
                  >
                    <Text style={{ textAlign: 'center', fontWeight: '700', color: colors.text.subtle, fontSize: 13 }}>{openLabel}</Text>
                  </Pressable>
                ) : null}
              </View>

              {releaseTracks.length >= 2 ? (
                <View style={{ marginTop: 30, paddingHorizontal: 20 }}>
                  <Text style={{ fontSize: 19, fontWeight: '800', color: colors.text.inverted, marginBottom: 12 }}>
                    Tracklist
                  </Text>
                  <GlassCard style={{ paddingVertical: 6, paddingHorizontal: 0, borderRadius: 20 }}>
                    {releaseTracks.map((track, index) => {
                      const duration = formatDuration(track.durationMs);
                      const trackNumber = track.trackNumber ?? index + 1;
                      const saveKey = trackSaveKey(track);
                      const trackSaved = !!saveKey && savedTrackIds.has(saveKey);
                      const trackSaving = !!saveKey && savingTrackIds.has(saveKey);
                      return (
                        <View
                          key={`${track.id || track.title}-${index}`}
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 12,
                            paddingHorizontal: 14,
                            paddingVertical: 10,
                            borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                            borderTopColor: colors.border.subtle,
                          }}
                        >
                          <Text style={{ width: 24, textAlign: 'right', color: colors.text.muted, fontWeight: '800', fontSize: 12 }}>
                            {trackNumber}
                          </Text>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={{ color: colors.text.secondary, fontWeight: '800' }} numberOfLines={1}>
                              {track.title}
                            </Text>
                            {track.artist ? (
                              <Text style={{ color: colors.text.muted, marginTop: 3, fontSize: 12 }} numberOfLines={1}>
                                {track.artist}
                              </Text>
                            ) : null}
                          </View>
                          {duration ? (
                            <Text style={{ color: colors.text.muted, fontSize: 12, fontWeight: '700' }}>
                              {duration}
                            </Text>
                          ) : null}
                          <Pressable
                            onPress={() => onSaveTrack(track)}
                            disabled={!saveKey || trackSaved || trackSaving}
                            hitSlop={8}
                            style={({ pressed }) => ({
                              minWidth: 58,
                              paddingHorizontal: 10,
                              paddingVertical: 7,
                              borderRadius: 999,
                              alignItems: 'center',
                              justifyContent: 'center',
                              backgroundColor: trackSaved ? colors.bg.muted : `${colors.bg.muted}cc`,
                              borderWidth: 1,
                              borderColor: `${colors.border.subtle}66`,
                              opacity: pressed ? 0.9 : 1,
                            })}
                          >
                            <Text style={{ color: colors.text.secondary, fontSize: 12, fontWeight: '800' }}>
                              {trackSaved ? 'Saved' : trackSaving ? 'Saving' : 'Save'}
                            </Text>
                          </Pressable>
                        </View>
                      );
                    })}
                  </GlassCard>
                </View>
              ) : null}

              <View style={{ marginTop: 34, paddingHorizontal: 20 }}>
                <Text style={{ fontSize: 19, fontWeight: '800', color: colors.text.inverted, marginBottom: 12 }}>
                  {moreByLabel}
                </Text>
                {moreByArtistLoading && moreByArtist.length === 0 ? (
                  <View style={{ rowGap: 10 }}>
                    {skeletonTiles.map((item) => (
                      <View key={`skeleton-${item}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 }}>
                        <View style={{ width: 56, height: 56, borderRadius: 14, backgroundColor: colors.bg.muted }} />
                        <View style={{ flex: 1 }}>
                          <View style={{ height: 12, backgroundColor: colors.bg.muted, borderRadius: 6, width: '64%' }} />
                          <View style={{ height: 10, backgroundColor: colors.bg.muted, borderRadius: 6, marginTop: 8, width: '34%' }} />
                        </View>
                      </View>
                    ))}
                  </View>
                ) : moreByArtist.length === 0 ? (
                  <GlassCard style={{ padding: 18, borderRadius: 20 }}>
                    <Text style={{ color: colors.text.secondary, fontWeight: '800', fontSize: 15 }}>No more releases yet</Text>
                    <Text style={{ color: colors.text.muted, marginTop: 6, lineHeight: 20 }}>
                      We do not have other releases for this artist right now.
                    </Text>
                  </GlassCard>
                ) : (
                  <View style={{ rowGap: 10 }}>
                    {moreByArtist.map((item) => (
                      <GlassCard key={item.id} asChild style={{ padding: 0, borderRadius: 18 }}>
                        <Pressable
                          onPress={() =>
                            goToRelease(item.id, {
                              spotifyId: item.id ?? null,
                              title: item.title,
                              artistName: item.artist,
                              imageUrl: item.imageUrl ?? null,
                              artistId: item.artistId ?? null,
                              releaseDate: item.releaseDate ?? null,
                              type: item.type ?? null,
                              totalTracks: item.totalTracks ?? null,
                              spotifyUrl: item.spotifyUrl ?? null,
                            })
                          }
                          style={({ pressed }) => ({
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 12,
                            padding: 12,
                            opacity: pressed ? 0.9 : 1,
                          })}
                        >
                          <View style={{ width: 56, height: 56, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.bg.muted }}>
                            {item.imageUrl ? (
                              <Image source={{ uri: item.imageUrl }} style={{ width: 56, height: 56 }} />
                            ) : (
                              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                                <Text style={{ color: colors.text.muted, fontWeight: '900' }}>{(item.title || '?').slice(0, 1)}</Text>
                              </View>
                            )}
                          </View>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={{ color: colors.text.secondary, fontWeight: '700' }} numberOfLines={1}>
                              {item.title}
                            </Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                              <Text style={{ color: colors.text.muted, fontSize: 10, fontWeight: '900', letterSpacing: 0.8 }} numberOfLines={1}>
                                {releasePresentationLabel(item.type)}
                              </Text>
                              {item.releaseDate ? (
                                <Text style={{ color: colors.text.muted, fontSize: 12, flexShrink: 1 }} numberOfLines={1}>
                                  {formatDate(item.releaseDate)}
                                </Text>
                              ) : null}
                            </View>
                          </View>
                          <Ionicons name="chevron-forward" size={16} color={colors.text.muted} />
                        </Pressable>
                      </GlassCard>
                    ))}
                  </View>
                )}
              </View>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
