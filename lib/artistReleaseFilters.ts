export type ArtistReleaseScope = 'all' | 'own' | 'featured';
export function matchesArtistRelease(
  item: { albumGroup?: string | null; presentationType: string },
  scope: ArtistReleaseScope,
  format: 'all' | 'single' | 'project',
) {
  const featured = item.albumGroup?.toLowerCase() === 'appears_on';
  return (scope === 'all' || (scope === 'featured' ? featured : !featured))
    && (format === 'all' || item.presentationType === format);
}
