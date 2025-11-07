export function formatDate(input?: string | null): string {
  if (!input) return '';
  // Spotify/Apple often use YYYY-MM-DD, sometimes YYYY-MM or YYYY
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const [y, m, d] = input.split('-');
    return `${d}/${m}/${y}`; // DD/MM/YYYY
  }
  if (/^\d{4}-\d{2}$/.test(input)) {
    const [y, m] = input.split('-');
    return `${m}/${y}`; // MM/YYYY fallback when day missing
  }
  if (/^\d{4}$/.test(input)) {
    return input; // Year only
  }
  return input;
}
