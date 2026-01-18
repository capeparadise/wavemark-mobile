import { router } from 'expo-router';

export function openArtist(artistId: string, opts?: { name?: string | null; highlight?: string | null }) {
  const id = String(artistId || '').trim();
  if (!/^[A-Za-z0-9]{22}$/.test(id)) return;
  router.push({
    pathname: '/artist/[id]/mini',
    params: {
      id,
      name: opts?.name ? String(opts.name) : undefined,
      highlight: opts?.highlight ? String(opts.highlight) : undefined,
    },
  });
}

