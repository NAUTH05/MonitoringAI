/**
 * Timezone-aware date resolution for search queries.
 *
 * The application runs in Asia/Ho_Chi_Minh (UTC+7, no DST — so a fixed offset is
 * exact, not an approximation). "hôm qua", "tối qua", "7 ngày gần đây" must map
 * to real UTC instants that line up with how `events.timestamp` is stored.
 *
 * The model is never trusted to know the current date: we compute it here and
 * inject it into the prompt.
 */

export const VN_TZ = 'Asia/Ho_Chi_Minh';
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A clock shifted to VN wall time — read it with the UTC getters. */
function vnClock(now: Date): Date {
  return new Date(now.getTime() + VN_OFFSET_MS);
}

/** Real UTC instant for a VN wall-clock date/time. */
function vnWallToUtc(
  year: number,
  month1: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  return new Date(Date.UTC(year, month1 - 1, day, hour, minute, second) - VN_OFFSET_MS);
}

export interface VNParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

export function vnParts(now: Date = new Date()): VNParts {
  const c = vnClock(now);
  return {
    year: c.getUTCFullYear(),
    month: c.getUTCMonth() + 1,
    day: c.getUTCDate(),
    hour: c.getUTCHours(),
    minute: c.getUTCMinutes(),
    weekday: c.getUTCDay(),
  };
}

/** "2026-11-09 10:26 (Asia/Ho_Chi_Minh, Thứ Hai)" — injected into prompts. */
export function describeNowVN(now: Date = new Date()): string {
  const p = vnParts(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  const weekday = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'][p.weekday];
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)} (${VN_TZ}, ${weekday})`;
}

/** Midnight of the VN day containing `now`, as a UTC instant. */
export function startOfDayVN(now: Date = new Date()): Date {
  const p = vnParts(now);
  return vnWallToUtc(p.year, p.month, p.day);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export interface TimeRange {
  startTime: Date;
  endTime: Date;
  /** Human label used in the UI banner ("Hôm qua", "7 ngày gần đây"). */
  label: string;
}

export type TimePreset =
  | 'today'
  | 'yesterday'
  | 'this_morning'
  | 'this_afternoon'
  | 'this_evening'
  | 'last_night'
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'last_month'
  | 'last_1h'
  | 'last_24h'
  | `last_n_days:${number}`;

/** Resolve a preset to a concrete UTC range relative to `now`. */
export function resolvePreset(preset: TimePreset, now: Date = new Date()): TimeRange {
  const todayStart = startOfDayVN(now);
  const tomorrowStart = addDays(todayStart, 1);
  const p = vnParts(now);

  if (preset === 'today') {
    return { startTime: todayStart, endTime: now, label: 'Hôm nay' };
  }
  if (preset === 'yesterday') {
    const start = addDays(todayStart, -1);
    return { startTime: start, endTime: todayStart, label: 'Hôm qua' };
  }
  if (preset === 'this_morning') {
    return {
      startTime: vnWallToUtc(p.year, p.month, p.day, 0),
      endTime: vnWallToUtc(p.year, p.month, p.day, 12),
      label: 'Sáng nay',
    };
  }
  if (preset === 'this_afternoon') {
    return {
      startTime: vnWallToUtc(p.year, p.month, p.day, 12),
      endTime: vnWallToUtc(p.year, p.month, p.day, 18),
      label: 'Chiều nay',
    };
  }
  if (preset === 'this_evening') {
    return {
      startTime: vnWallToUtc(p.year, p.month, p.day, 18),
      endTime: tomorrowStart,
      label: 'Tối nay',
    };
  }
  if (preset === 'last_night') {
    const y = vnParts(addDays(todayStart, -1));
    return {
      startTime: vnWallToUtc(y.year, y.month, y.day, 18),
      endTime: vnWallToUtc(p.year, p.month, p.day, 6),
      label: 'Tối qua',
    };
  }
  if (preset === 'this_week') {
    // Week starts Monday in Vietnam.
    const offset = (p.weekday + 6) % 7;
    const start = addDays(todayStart, -offset);
    return { startTime: start, endTime: now, label: 'Tuần này' };
  }
  if (preset === 'last_week') {
    const offset = (p.weekday + 6) % 7;
    const thisWeekStart = addDays(todayStart, -offset);
    return {
      startTime: addDays(thisWeekStart, -7),
      endTime: thisWeekStart,
      label: 'Tuần trước',
    };
  }
  if (preset === 'this_month') {
    return {
      startTime: vnWallToUtc(p.year, p.month, 1),
      endTime: now,
      label: 'Tháng này',
    };
  }
  if (preset === 'last_month') {
    const prevMonth = p.month === 1 ? 12 : p.month - 1;
    const prevYear = p.month === 1 ? p.year - 1 : p.year;
    return {
      startTime: vnWallToUtc(prevYear, prevMonth, 1),
      endTime: vnWallToUtc(p.year, p.month, 1),
      label: 'Tháng trước',
    };
  }
  if (preset === 'last_1h') {
    return {
      startTime: new Date(now.getTime() - 60 * 60 * 1000),
      endTime: now,
      label: '1 giờ gần đây',
    };
  }
  if (preset === 'last_24h') {
    return {
      startTime: new Date(now.getTime() - DAY_MS),
      endTime: now,
      label: '24 giờ gần đây',
    };
  }
  if (preset.startsWith('last_n_days:')) {
    const n = Math.max(1, Math.min(365, Number(preset.split(':')[1]) || 7));
    return {
      startTime: addDays(todayStart, -(n - 1)),
      endTime: now,
      label: `${n} ngày gần đây`,
    };
  }
  return { startTime: todayStart, endTime: now, label: 'Hôm nay' };
}

/** Parse an ISO-ish string into a Date, returning undefined when unusable. */
export function parseIsoOrUndefined(value: unknown): Date | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** ISO string in UTC for API/DB use, or undefined. */
export function toIsoOrUndefined(value: unknown): string | undefined {
  return parseIsoOrUndefined(value)?.toISOString();
}
