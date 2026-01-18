// lib/openExternal.ts
// Central Apple Music opener using canonical URL formatting.

import { Linking } from 'react-native';
import { buildAppleAlbumLink, buildAppleTrackLink, normalizeIncomingAppleUrl } from './appleLinks';
import { lookupAppleByISRC, lookupAppleTrack } from './appleLookup';

type OpenAppleAlbum = { kind: 'album'; appleAlbumId?: string; storefront?: string };
type OpenAppleTrack = { kind: 'track'; appleTrackId?: string; appleAlbumId?: string; storefront?: string; isrc?: string };
type OpenAppleRaw = { kind: 'raw'; url: string; storefront?: string };
export type OpenAppleParams = OpenAppleAlbum | OpenAppleTrack | OpenAppleRaw;

async function safeOpen(url: string): Promise<boolean> {
  try { await Linking.openURL(url); return true; } catch { return false; }
}

export async function openInAppleMusicUnified(params: OpenAppleParams): Promise<boolean> {
  const storefront = (params.storefront || 'gb').toLowerCase();
  try {
    if (params.kind === 'raw') {
      const fixed = normalizeIncomingAppleUrl(params.url, storefront) || params.url;
      return await safeOpen(fixed);
    }
    if (params.kind === 'album') {
      if (!params.appleAlbumId) throw new Error('Missing album id');
      return await safeOpen(buildAppleAlbumLink(params.appleAlbumId, storefront));
    }
    // Track
    let trackId = params.appleTrackId || null;
    let albumId = params.appleAlbumId || null;
    if (!trackId && params.isrc) {
      const hit = await lookupAppleByISRC(params.isrc, storefront.toUpperCase());
      if (hit?.trackId) trackId = String(hit.trackId);
      if (hit?.collectionId) albumId = String(hit.collectionId);
    }
    if (trackId && !albumId) {
      const t = await lookupAppleTrack(trackId, storefront.toUpperCase());
      if (t?.collectionId) albumId = String(t.collectionId);
    }
    if (!trackId && !albumId) throw new Error('No Apple IDs');
    return await safeOpen(buildAppleTrackLink(trackId || '', albumId || undefined, storefront));
  } catch (e) {
    // Fallback: open Apple Music homepage to avoid silent failure
    await safeOpen('https://music.apple.com');
    return false;
  }
}