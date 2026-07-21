export type ReleasePresentationType = 'single' | 'project';

export type ReleaseTrack = {
  id?: string | null;
  provider?: 'spotify' | 'apple' | 'unknown';
  providerId?: string | null;
  title: string;
  artist?: string | null;
  trackNumber?: number | null;
  durationMs?: number | null;
  spotifyUrl?: string | null;
  appleUrl?: string | null;
};

export function parseTrackCount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return null;
}

export function normalizeReleasePresentationType(
  trackCount?: number | string | null,
  fallback?: string | null
): ReleasePresentationType {
  const count = parseTrackCount(trackCount);
  if (count != null) return count === 1 ? 'single' : 'project';

  const normalized = String(fallback || '').trim().toLowerCase();
  if (normalized === 'single' || normalized === 'track') return 'single';
  return 'project';
}

export function releasePresentationLabel(type?: ReleasePresentationType | string | null) {
  return normalizeReleasePresentationType(null, type) === 'single' ? 'SINGLE' : 'PROJECT';
}
