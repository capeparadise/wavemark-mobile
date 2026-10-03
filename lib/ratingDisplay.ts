export type RatingDetails = { production?: number; vocals?: number; lyrics?: number; replay?: number; artwork?: number };

export function offersArtworkRating(itemType?: string, individualTrack = false): boolean {
  // Singles share the stored 'track' type; tracklist controls explicitly opt out.
  return !individualTrack && ['album', 'single', 'track'].includes(itemType || '');
}

// Artwork is optional and never participates in the music total.
export function ratingDetailsForSubmit(details: RatingDetails, advanced: boolean, artworkEnabled: boolean): RatingDetails | null {
  const next = advanced ? { production: 7, vocals: 7, lyrics: 7, replay: 7, ...details } : { ...details };
  if (!artworkEnabled) delete next.artwork;
  // Keep the key for releases even when cleared: callers must persist removal.
  return advanced || artworkEnabled ? { ...next, ...(artworkEnabled ? { artwork: details.artwork } : {}) } : null;
}

// The overall rating remains the canonical sorting/statistics value.
// Never manufacture category scores for legacy/simple ratings.
export function advancedRatingTotal(overall: number | null | undefined, details?: RatingDetails | null): number | null {
  const values = [overall, details?.production, details?.vocals, details?.lyrics, details?.replay];
  if (!values.every(v => typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 10)) return null;
  return (values as number[]).reduce((sum, value) => sum + value, 0);
}

export function ratingLabel(overall: number, details: RatingDetails | null | undefined, advanced: boolean): string {
  const total = advanced ? advancedRatingTotal(overall, details) : null;
  return total === null ? `${overall}/10` : `${total}/50 · Overall ${overall}/10`;
}
