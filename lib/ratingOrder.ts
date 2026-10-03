export const defaultRatingOrder = ['overall', 'advanced', 'artwork', 'notes'] as const;
export const defaultAdvancedOrder = ['production', 'vocals', 'lyrics', 'replay'] as const;
export type AdvancedSection = typeof defaultAdvancedOrder[number];
export type RatingSection = typeof defaultRatingOrder[number] | AdvancedSection;
export const ratingSectionLabels: Record<RatingSection, string> = {
  overall: 'Overall impression', advanced: 'Advanced ratings', production: 'Production', vocals: 'Vocals / Performance',
  lyrics: 'Lyrics / Writing', replay: 'Replay value', artwork: 'Artwork', notes: 'Your note',
};
export function normalizeRatingOrder(input: unknown): (typeof defaultRatingOrder[number])[] {
  // Preserve the position of the first advanced category from older flat orders.
  const mapped = Array.isArray(input) ? input.map(key => (defaultAdvancedOrder as readonly unknown[]).includes(key) ? 'advanced' : key) : [];
  const valid = mapped.filter((key): key is typeof defaultRatingOrder[number] => defaultRatingOrder.includes(key));
  return [...new Set([...valid, ...defaultRatingOrder])];
}
export function normalizeAdvancedOrder(input: unknown): AdvancedSection[] {
  const valid = Array.isArray(input) ? input.filter((key): key is AdvancedSection => defaultAdvancedOrder.includes(key)) : [];
  return [...new Set([...valid, ...defaultAdvancedOrder])];
}
export function moveRatingSection(order: RatingSection[], key: RatingSection, direction: -1 | 1): RatingSection[] {
  const next = [...order];
  const from = next.indexOf(key), to = from + direction;
  if (from < 0 || to < 0 || to >= next.length) return next;
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

export function dropRatingSection(order: RatingSection[], key: RatingSection, target: number): RatingSection[] {
  const next = [...order];
  const from = next.indexOf(key);
  if (from < 0 || !Number.isFinite(target)) return next;
  next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, Math.round(target))), 0, key);
  return next;
}
