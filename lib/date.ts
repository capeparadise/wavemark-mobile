export function formatDate(input?: string | null): string {
  if (!input) return '';
  const raw = String(input).trim();
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  // Spotify/Apple often use YYYY-MM-DD, sometimes full ISO, YYYY-MM or YYYY.
  const dayMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
  if (dayMatch) {
    const [, y, m, d] = dayMatch;
    const year = Number(y);
    const monthIdx = Number(m) - 1;
    const day = Number(d);
    if (monthIdx < 0 || monthIdx > 11 || day < 1 || day > 31) return '';
    const parsed = new Date(Date.UTC(year, monthIdx, day));
    if (
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== monthIdx ||
      parsed.getUTCDate() !== day
    ) {
      return '';
    }
    return `${day} ${monthNames[monthIdx]} ${y}`;
  }
  if (/^\d{4}-\d{2}$/.test(raw)) {
    const [y, m] = raw.split('-');
    const monthIdx = Number(m) - 1;
    if (monthIdx < 0 || monthIdx > 11) return '';
    return `${monthNames[monthIdx]} ${y}`;
  }
  if (/^\d{4}$/.test(raw)) {
    return raw; // Year only
  }
  return '';
}
