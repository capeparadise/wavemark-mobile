export const REVIEW_MAX_LENGTH = 5000;
export const REVIEW_PREVIEW_LENGTH = 280;

export function normalizeReview(value?: string | null): string | null {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;
  return trimmed.slice(0, REVIEW_MAX_LENGTH);
}
