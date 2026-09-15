// Verified cross-catalogue identities, never inferred from a name-only search.
// ADÉLA: https://open.spotify.com/artist/2qanRMyA5bNuTvz1dK45OP
// Apple: https://music.apple.com/artist/1765924916
const appleToSpotify: Record<string, string> = {
  '1765924916': '2qanRMyA5bNuTvz1dK45OP',
};

export function verifiedSpotifyArtistId(appleArtistId: string): string | null {
  return appleToSpotify[appleArtistId] ?? null;
}
