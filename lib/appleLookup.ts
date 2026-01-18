// lib/appleLookup.ts
// Resolve Apple Music IDs via public iTunes Lookup/Search endpoints (no developer token required).

const ITUNES_LOOKUP = 'https://itunes.apple.com/lookup';

export type AppleLookupResult = {
  trackId?: number;
  collectionId?: number; // album id
};

export async function lookupAppleByISRC(isrc: string, country = 'GB'): Promise<AppleLookupResult | null> {
  try {
    const url = ITUNES_LOOKUP + '?' + new URLSearchParams({ isrc, country });
    const res = await fetch(url);
    if (!res.ok) return null;
  const data: any = await res.json();
  const item = (data.results ?? [])[0];
    if (!item) return null;
    return { trackId: item.trackId, collectionId: item.collectionId };
  } catch { return null; }
}

export async function lookupAppleTrack(trackId: string, country = 'GB'): Promise<AppleLookupResult | null> {
  try {
    const url = ITUNES_LOOKUP + '?' + new URLSearchParams({ id: trackId, country });
    const res = await fetch(url);
    if (!res.ok) return null;
  const data: any = await res.json();
  const item = (data.results ?? [])[0];
    if (!item) return null;
    return { trackId: item.trackId, collectionId: item.collectionId };
  } catch { return null; }
}