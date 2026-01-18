// lib/appleResolver.ts
// Robust Apple URL resolver using iTunes Lookup API.

const LOOKUP = 'https://itunes.apple.com/lookup';

export type ResolvedAppleUrl = {
  url: string;
  storefront: string; // lowercase storefront used
  kind: 'track' | 'album';
  trackId?: string;
  albumId?: string;
  artistName?: string;
};

async function fetchJSON(url: string): Promise<any | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// Try one storefront with given params
async function lookupOnce(params: Record<string,string>, country: string): Promise<ResolvedAppleUrl | null> {
  const url = LOOKUP + '?' + new URLSearchParams({ ...params, country });
  const data = await fetchJSON(url);
  const item = (data?.results ?? [])[0];
  if (!item) return null;
  const trackUrl: string | undefined = item.trackViewUrl;
  const albumUrl: string | undefined = item.collectionViewUrl;
  const storefront = country.toLowerCase();
  if (trackUrl) {
    const canonical = trackUrl.replace('itunes.apple.com','music.apple.com') + (trackUrl.includes('?') ? '&' : '?') + 'app=music';
    return { url: canonical, storefront, kind: 'track', trackId: String(item.trackId), albumId: item.collectionId ? String(item.collectionId) : undefined };
  }
  if (albumUrl) {
    const canonical = albumUrl.replace('itunes.apple.com','music.apple.com') + (albumUrl.includes('?') ? '&' : '?') + 'app=music';
    return { url: canonical, storefront, kind: 'album', albumId: String(item.collectionId) };
  }
  return null;
}

// Targeted strict track resolver for cases where normal search returns wrong artist (e.g., numeric artist names like 11:11)
export async function resolveAppleTrackStrict(title: string, artist: string, storefront: string): Promise<ResolvedAppleUrl | null> {
  const country = storefront.toUpperCase();
  const base = 'https://itunes.apple.com/search';
  const term = title.trim();
  const qs = new URLSearchParams({ term, country, entity: 'musicTrack', attribute: 'songTerm', limit: '50', media: 'music' });
  const url = base + '?' + qs.toString();
  const data = await fetchJSON(url);
  const results: any[] = Array.isArray(data?.results) ? data.results : [];
  if (!results.length) return null;
  const wantArtistCompressed = compressDigits(artist);
  const normTokens = tokenize(title);
  let best: any = null; let bestScore = 0;
  for (const r of results) {
    if (r.wrapperType !== 'track') continue;
    const gotArtist = r.artistName || '';
    if (compressDigits(gotArtist) !== wantArtistCompressed) continue;
    const gotTitleTokens = tokenize(r.trackName || '');
    const coverage = normTokens.filter(t => gotTitleTokens.includes(t)).length / (normTokens.length || 1);
    if (coverage === 1) { best = r; bestScore = coverage; break; }
    if (coverage > bestScore && coverage >= 0.6) { best = r; bestScore = coverage; }
  }
  if (best && best.trackViewUrl) {
    const canonical = best.trackViewUrl.replace('itunes.apple.com','music.apple.com') + (best.trackViewUrl.includes('?') ? '&' : '?') + 'app=music';
    return {
      url: canonical,
      storefront: country.toLowerCase(),
      kind: 'track',
      trackId: String(best.trackId),
      albumId: best.collectionId ? String(best.collectionId) : undefined,
      artistName: best.artistName,
    };
  }
  return null;
}

async function searchOnce(term: string, country: string, entities: string[], limit = 10): Promise<any[]> {
  const base = 'https://itunes.apple.com/search';
  const all: any[] = [];
  for (const entity of entities) {
    const qs = new URLSearchParams({ term, country, entity, limit: String(limit), media: 'music' });
    const url = base + '?' + qs.toString();
    const data = await fetchJSON(url);
    const results = Array.isArray(data?.results) ? data.results : [];
    for (const r of results) all.push(r);
  }
  return all;
}

function ascii(s: string): string {
  return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

function normBase(s: string): string {
  return ascii(s.toLowerCase().replace(/&/g,' and ').replace(/['"’]/g,'').replace(/- single$/i,'').replace(/[^a-z0-9]+/g,' ').trim());
}

function tokenize(s: string): string[] {
  return normBase(s).split(/\s+/).filter(Boolean);
}

function compressDigits(s: string): string {
  return s.toLowerCase().replace(/[^0-9a-z]+/g,'');
}

function scoreCandidate(input: { titleTokens: string[]; artistTokens: string[]; compressedArtist?: string; }, item: any, preferAlbum: boolean): { score: number; kind: 'track' | 'album'; canonical: string | null; trackId?: string; albumId?: string; artistName?: string } {
  const kind: 'track' | 'album' = item.wrapperType === 'track' ? 'track' : (item.wrapperType === 'collection' ? 'album' : 'track');
  if (preferAlbum && kind === 'track' && item.collectionName) {
    // allow track if album not found but penalize slightly
  }
  const itemTitle = kind === 'track' ? (item.trackName || '') : (item.collectionName || '');
  const itemArtist = item.artistName || '';
  const titleTokens = tokenize(itemTitle);
  const artistTokens = tokenize(itemArtist);
  const titleMatchCount = input.titleTokens.filter(t => titleTokens.includes(t)).length;
  const artistMatchCount = input.artistTokens.length === 0 ? 1 : input.artistTokens.filter(t => artistTokens.includes(t)).length;
  const titleCoverage = input.titleTokens.length ? (titleMatchCount / input.titleTokens.length) : 0;
  const artistCoverage = input.artistTokens.length ? (artistMatchCount / input.artistTokens.length) : 0;
  let score = (titleCoverage * 0.7) + (artistCoverage * 0.3);
  // If we expected artist tokens but none matched, discard candidate outright.
  if (input.artistTokens.length > 0 && artistMatchCount === 0) {
    // Allow compressed digit artist match (e.g. "11 11" vs "11:11")
    const compItem = compressDigits(itemArtist);
    if (!(input.compressedArtist && compItem === input.compressedArtist)) {
      score = -1000;
    } else {
      score -= 0.2; // slight penalty but keep candidate
    }
  }
  // Penalize completely different first token
  if (input.titleTokens[0] && titleTokens[0] && input.titleTokens[0] !== titleTokens[0]) score -= 0.1;
  // Prefer exact full coverage
  if (titleCoverage === 1) score += 0.2;
  // Build canonical URL variants
  let canonical: string | null = null;
  const storefront = (item.country || 'US').toLowerCase();
  const trackUrl: string | undefined = item.trackViewUrl;
  const albumUrl: string | undefined = item.collectionViewUrl;
  if (kind === 'track' && trackUrl) {
    canonical = trackUrl.replace('itunes.apple.com','music.apple.com') + (trackUrl.includes('?') ? '&' : '?') + 'app=music';
  } else if (kind === 'album' && albumUrl) {
    canonical = albumUrl.replace('itunes.apple.com','music.apple.com') + (albumUrl.includes('?') ? '&' : '?') + 'app=music';
  } else if (trackUrl) {
    canonical = trackUrl.replace('itunes.apple.com','music.apple.com') + (trackUrl.includes('?') ? '&' : '?') + 'app=music';
  }
  return { score, kind, canonical, trackId: item.trackId ? String(item.trackId) : undefined, albumId: item.collectionId ? String(item.collectionId) : undefined, artistName: item.artistName };
}

export async function resolveAppleUrl(input: {
  appleTrackId?: string | null;
  appleAlbumId?: string | null;
  isrc?: string | null;
  title?: string | null;
  artist?: string | null;
  storefront?: string; // preferred storefront (gb/us etc.)
  itemType?: 'track' | 'album'; // hint to prioritize album vs track search
}): Promise<ResolvedAppleUrl | null> {
  const primary = (input.storefront || 'gb').toUpperCase();
  const order = primary === 'US' ? ['US','GB'] : [primary,'US'];
  for (const country of order) {
    if (input.appleTrackId) {
      const hit = await lookupOnce({ id: String(input.appleTrackId), entity: 'song' }, country);
      if (hit) return hit;
    }
    if (input.appleAlbumId) {
      const hit = await lookupOnce({ id: String(input.appleAlbumId), entity: 'album' }, country);
      if (hit) return hit;
    }
    if (input.isrc) {
      const hit = await lookupOnce({ isrc: input.isrc }, country);
      if (hit) return hit;
    }
    if (input.title && input.artist) {
      // First pass: lookup as song (existing behavior)
      const term = `${input.artist} ${input.title}`;
      const hitSong = await lookupOnce({ term, entity: 'song', limit: '1' }, country);
      if (hitSong) return hitSong;
    }
  }
  // Fallback: full search API (album or track) with accent-insensitive term variants
  if (input.title && input.artist) {
    const rawTerm = `${input.artist} ${input.title}`.trim();
    const variants = Array.from(new Set([rawTerm, ascii(rawTerm)]));
    const preferAlbum = input.itemType === 'album';
  const titleTokens = tokenize(input.title);
  const artistTokens = tokenize(input.artist);
  const compressedArtist = compressDigits(input.artist);
    for (const country of order) {
      for (const v of variants) {
        const entitySets: string[][] = [];
        if (preferAlbum) entitySets.push(['album']);
        entitySets.push(['musicTrack','song']);
        for (const entities of entitySets) {
          const results = await searchOnce(v, country, entities, 10);
          if (!results.length) continue;
          const scored = results.map(r => scoreCandidate({ titleTokens, artistTokens, compressedArtist }, r, preferAlbum)).filter(s => s.canonical);
          scored.sort((a,b) => b.score - a.score);
          const best = scored[0];
          if (best && best.score >= 0.55 && best.canonical) {
            // If we requested a track but only got an album (Single), attempt a focused track lookup
            if (input.itemType === 'track' && best.kind === 'album' && best.albumId) {
              // Run a narrow search just for the song title to fetch trackId
              const narrowTerm = ascii(input.title || '').trim();
              if (narrowTerm) {
                const narrowResults = await searchOnce(narrowTerm, country, ['musicTrack','song'], 5);
                const narrowScored = narrowResults.map(r => scoreCandidate({ titleTokens, artistTokens, compressedArtist }, r, false)).filter(s => s.canonical);
                narrowScored.sort((a,b) => b.score - a.score);
                const trackCandidate = narrowScored.find(c => c.kind === 'track' && c.trackId && c.albumId);
            if (trackCandidate && trackCandidate.score >= 0.50) {
                  return {
              url: trackCandidate.canonical!,
              storefront: country.toLowerCase(),
              kind: 'track',
              trackId: trackCandidate.trackId,
              albumId: trackCandidate.albumId,
              artistName: trackCandidate.artistName,
                  };
                }
              }
            }
            return {
              url: best.canonical,
              storefront: country.toLowerCase(),
              kind: best.kind,
              trackId: best.trackId,
            albumId: best.albumId,
            artistName: best.artistName,
            };
          }
        }
      }
      // ArtistId fallback for track when artist tokens present but earlier searches failed
      if (input.itemType === 'track') {
        const artistTerm = ascii(input.artist || '').trim();
        if (artistTerm) {
          const artistHits = await searchOnce(artistTerm, country, ['musicArtist'], 5);
          const artistId = artistHits.find(a => a && a.artistId)?.artistId;
          if (artistId) {
            const lookupUrl = LOOKUP + '?' + new URLSearchParams({ id: String(artistId), entity: 'song', limit: '25', country });
            const artistSongsData = await fetchJSON(lookupUrl);
            const songs = Array.isArray(artistSongsData?.results) ? artistSongsData.results.filter((r: any) => r.wrapperType === 'track') : [];
            let bestSong: any = null; let bestCoverage = 0;
            for (const s of songs) {
              const sTokens = tokenize(s.trackName || '');
              const coverage = titleTokens.filter(t => sTokens.includes(t)).length / (titleTokens.length || 1);
              if (coverage === 1) { bestSong = s; bestCoverage = coverage; break; }
              if (coverage > bestCoverage && coverage >= 0.6) { bestSong = s; bestCoverage = coverage; }
            }
            if (bestSong && bestCoverage >= 0.6 && bestSong.trackViewUrl) {
              const canonical = bestSong.trackViewUrl.replace('itunes.apple.com','music.apple.com') + (bestSong.trackViewUrl.includes('?') ? '&' : '?') + 'app=music';
              return {
                url: canonical,
                storefront: country.toLowerCase(),
                kind: 'track',
                trackId: String(bestSong.trackId),
                albumId: bestSong.collectionId ? String(bestSong.collectionId) : undefined,
                artistName: bestSong.artistName,
              };
            }
          }
        }
      }
    }
  }
  return null;
}