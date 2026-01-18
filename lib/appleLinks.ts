// lib/appleLinks.ts
// Canonical builders and normalizer for Apple Music universal links.

const DEFAULT_STOREFRONT = 'gb'; // fallback storefront

export function buildAppleAlbumLink(albumId: string, storefront: string = DEFAULT_STOREFRONT): string {
  const sf = storefront.toLowerCase();
  return `https://music.apple.com/${sf}/album/${albumId}?app=music`;
}

export function buildAppleTrackLink(trackId: string, albumId?: string, storefront: string = DEFAULT_STOREFRONT): string {
  const sf = storefront.toLowerCase();
  if (albumId) return `https://music.apple.com/${sf}/album/${albumId}?i=${trackId}&app=music`;
  return `https://music.apple.com/${sf}/song/${trackId}?app=music`;
}

// Normalize arbitrary Apple URLs into canonical form (inject storefront + app=music)
export function normalizeIncomingAppleUrl(url: string, storefront: string = DEFAULT_STOREFRONT): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith('music.apple.com')) {
      // Ensure storefront path segment exists and has length 2
      const parts = u.pathname.split('/').filter(Boolean);
      if (!parts[0] || parts[0].length !== 2) {
        parts.unshift(storefront.toLowerCase());
        u.pathname = '/' + parts.join('/');
      }
      if (!u.searchParams.get('app')) u.searchParams.set('app', 'music');
      return u.toString();
    }
    if (u.hostname.endsWith('itunes.apple.com')) {
      const id = u.searchParams.get('id');
      if (id) {
        const path = u.pathname.toLowerCase();
        if (path.includes('/album')) return buildAppleAlbumLink(id, storefront);
        if (path.includes('/song') || path.includes('/music-video')) return buildAppleTrackLink(id, undefined, storefront);
      }
    }
    return null;
  } catch {
    return null;
  }
}