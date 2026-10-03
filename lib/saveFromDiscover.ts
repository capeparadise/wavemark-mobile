import { addToListFromSearch } from './listen';
import { beginListenSavePreview } from './listenSavePreview';
import { suspendListenedActivity } from './listenedActivity';

export async function saveFromDiscover(input: Parameters<typeof addToListFromSearch>[0], userId?: string) {
  const spotifyId = input.spotifyUrl?.match(/\/(?:track|album)\/([A-Za-z0-9]+)/)?.[1] || input.providerId || null;
  const restoreActivity = userId ? suspendListenedActivity(userId, input.providerId || spotifyId) : undefined;
  const preview = userId ? beginListenSavePreview(userId, {
    item_type: input.type === 'album' ? 'album' : 'track',
    provider: 'spotify', provider_id: input.providerId || spotifyId,
    title: input.title, artist_name: input.artist || null,
    artwork_url: input.imageUrl || input.artworkUrl || input.artworkUrl100 || null,
    spotify_id: spotifyId, spotify_url: input.spotifyUrl || null,
    apple_id: null, apple_url: input.appleUrl || null,
    release_date: input.releaseDate || null,
    upcoming: !!input.releaseDate && input.releaseDate > new Date().toISOString().slice(0, 10),
    created_at: new Date().toISOString(), done_at: null,
  }) : null;
  try {
    const result = await addToListFromSearch(input, userId);
    if (result.ok && result.id) preview?.confirm({ ...result.row, id: result.id });
    else { preview?.rollback(); restoreActivity?.(); }
    return result;
  } catch (error) {
    preview?.rollback();
    restoreActivity?.();
    throw error;
  }
}
