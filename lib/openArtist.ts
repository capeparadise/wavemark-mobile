import { router } from 'expo-router';

export function openArtist(artistId: string, opts?: {
  name?: string | null;
  highlight?: string | null;
  highlightTitle?: string | null;
  highlightArtist?: string | null;
  highlightDate?: string | null;
  highlightImageUrl?: string | null;
  highlightSpotifyUrl?: string | null;
  highlightType?: string | null;
}) {
  const id = String(artistId || '').trim();
  if (!/^[A-Za-z0-9]{22}$/.test(id)) return;
  router.push({
    pathname: '/artist/[id]/mini',
    params: {
      id,
      name: opts?.name ? String(opts.name) : undefined,
      highlight: opts?.highlight ? String(opts.highlight) : undefined,
      highlightTitle: opts?.highlightTitle ? String(opts.highlightTitle) : undefined,
      highlightArtist: opts?.highlightArtist ? String(opts.highlightArtist) : undefined,
      highlightDate: opts?.highlightDate ? String(opts.highlightDate) : undefined,
      highlightImageUrl: opts?.highlightImageUrl ? String(opts.highlightImageUrl) : undefined,
      highlightSpotifyUrl: opts?.highlightSpotifyUrl ? String(opts.highlightSpotifyUrl) : undefined,
      highlightType: opts?.highlightType ? String(opts.highlightType) : undefined,
    },
  });
}
