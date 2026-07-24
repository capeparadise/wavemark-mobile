export const DISCOVER_RELEASE_WINDOW_DAYS = 14;

type DateValue = string | null | undefined;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function normalizeDiscoverReleaseDate(value: DateValue, precision?: string | null): string | null {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const normalizedPrecision = String(precision || '').toLowerCase();
  let year: number;
  let month = 1;
  let day = 1;

  const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const ym = raw.match(/^(\d{4})-(\d{2})$/);
  const y = raw.match(/^(\d{4})$/);

  if (ymd) {
    year = Number(ymd[1]);
    month = Number(ymd[2]);
    day = Number(ymd[3]);
  } else if (ym || normalizedPrecision === 'month') {
    const match = ym ?? raw.match(/^(\d{4})-(\d{2})/);
    if (!match) return null;
    year = Number(match[1]);
    month = Number(match[2]);
  } else if (y || normalizedPrecision === 'year') {
    const match = y ?? raw.match(/^(\d{4})/);
    if (!match) return null;
    year = Number(match[1]);
  } else {
    return null;
  }

  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function discoverWindowCutoff(days = DISCOVER_RELEASE_WINDOW_DAYS, now = new Date()): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - Math.max(0, days - 1));
  return date.getTime();
}

export function discoverLocalDateKey(now = new Date()): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function discoverWindowEnd(now = new Date()): number {
  const date = new Date(now);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

export function discoverReleaseDateTimestamp(value: DateValue, precision?: string | null): number {
  const normalized = normalizeDiscoverReleaseDate(value, precision);
  if (!normalized) return 0;
  const [year, month, day] = normalized.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getTime();
}

export function isDiscoverReleaseDateEligible(
  value: DateValue,
  opts?: { precision?: string | null; days?: number; cutoffTs?: number; now?: Date }
): boolean {
  const now = opts?.now ?? new Date();
  const timestamp = discoverReleaseDateTimestamp(value, opts?.precision);
  if (!timestamp) return false;
  const cutoffTs = opts?.cutoffTs ?? discoverWindowCutoff(opts?.days ?? DISCOVER_RELEASE_WINDOW_DAYS, now);
  return timestamp >= cutoffTs && timestamp <= discoverWindowEnd(now);
}

export function filterDiscoverEligibleReleases<T>(
  items: T[],
  opts?: {
    days?: number;
    cutoffTs?: number;
    getDate?: (item: T) => DateValue;
    getPrecision?: (item: T) => string | null | undefined;
  }
): T[] {
  const getDate = opts?.getDate ?? ((item: any) => item?.releaseDate ?? item?.release_date ?? null);
  const getPrecision = opts?.getPrecision ?? ((item: any) => item?.releaseDatePrecision ?? item?.release_date_precision ?? null);
  return (items || []).filter((item) => (
    isDiscoverReleaseDateEligible(getDate(item), {
      days: opts?.days,
      cutoffTs: opts?.cutoffTs,
      precision: getPrecision(item),
    })
  ));
}

export function discoverFreshnessBand(
  value: DateValue,
  opts?: { precision?: string | null; now?: Date; days?: number }
): number {
  const normalized = normalizeDiscoverReleaseDate(value, opts?.precision);
  if (!normalized) return Number.POSITIVE_INFINITY;
  const [year, month, day] = normalized.split('-').map(Number);
  const release = new Date(year, month - 1, day);
  release.setHours(0, 0, 0, 0);
  const today = new Date(opts?.now ?? new Date());
  today.setHours(0, 0, 0, 0);
  const ageDays = Math.floor((today.getTime() - release.getTime()) / (24 * 60 * 60 * 1000));
  const days = opts?.days ?? DISCOVER_RELEASE_WINDOW_DAYS;
  if (ageDays < 0 || ageDays >= days) return Number.POSITIVE_INFINITY;
  if (ageDays === 0) return 0;
  if (ageDays <= 3) return 1;
  if (ageDays <= 7) return 2;
  return 3;
}

export function compareDiscoverReleaseFreshness<T>(
  a: T,
  b: T,
  opts?: {
    now?: Date;
    getDate?: (item: T) => DateValue;
    getPrecision?: (item: T) => string | null | undefined;
    compareWithinBand?: (a: T, b: T) => number;
  }
): number {
  const getDate = opts?.getDate ?? ((item: any) => item?.releaseDate ?? item?.release_date ?? null);
  const getPrecision = opts?.getPrecision ?? ((item: any) => item?.releaseDatePrecision ?? item?.release_date_precision ?? null);
  const now = opts?.now ?? new Date();
  const aBand = discoverFreshnessBand(getDate(a), { precision: getPrecision(a), now });
  const bBand = discoverFreshnessBand(getDate(b), { precision: getPrecision(b), now });
  if (aBand !== bBand) return aBand - bBand;
  const withinBand = opts?.compareWithinBand?.(a, b) ?? 0;
  if (withinBand) return withinBand;
  const dateDiff = discoverReleaseDateTimestamp(getDate(b), getPrecision(b)) - discoverReleaseDateTimestamp(getDate(a), getPrecision(a));
  if (dateDiff) return dateDiff;
  return 0;
}

export function sortDiscoverReleasesByFreshness<T>(
  items: T[],
  opts?: Parameters<typeof compareDiscoverReleaseFreshness<T>>[2]
): T[] {
  return (items || [])
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const freshness = compareDiscoverReleaseFreshness(a.item, b.item, opts);
      if (freshness) return freshness;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}
