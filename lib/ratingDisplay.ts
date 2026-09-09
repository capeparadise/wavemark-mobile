export type RatingDetails = { production?: number; vocals?: number; lyrics?: number; replay?: number };

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
