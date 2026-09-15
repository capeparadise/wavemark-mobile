import type { SpotifyResult } from './spotify';

const normalized = (value?: string | null) => String(value || '').normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Keep edition/remix suffixes: a same-name artist or another edition is not a safe match.
export function spotifyOpenMatch(
  item: { title: string; artist_name: string | null; item_type: string },
  result: SpotifyResult | null,
): string | null {
  const type = item.item_type === 'album' ? 'album' : 'track';
  if (!result || result.type !== type || !/^[A-Za-z0-9]{22}$/.test(result.id)) return null;
  if (!normalized(item.artist_name) || normalized(item.title) !== normalized(result.title)) return null;
  if (![result.artist, ...(result.artistNames || [])].some(name => normalized(name) === normalized(item.artist_name))) return null;
  return `https://open.spotify.com/${type}/${result.id}`;
}
