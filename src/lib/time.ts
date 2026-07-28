/**
 * Parses a clock time into seconds since midnight. Accepts "HH:MM", "HH:MM:SS",
 * and 12-hour forms with a meridiem such as "4:10 AM" or "12:30 PM" (both of which
 * appear in real race KML cut-off labels). Returns null if unparseable.
 */
export function parseClockTimeToSeconds(value: string): number | null {
  // \s covers the non-breaking spaces that Google My Maps often embeds in names.
  const m = value.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AaPp])\.?[Mm]\.?)?$/);
  if (!m) return null;

  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const s = m[3] ? parseInt(m[3], 10) : 0;
  const meridiem = m[4]?.toLowerCase();

  if (meridiem) {
    if (h < 1 || h > 12) return null;
    if (meridiem === 'a') {
      if (h === 12) h = 0; // 12:xx AM is midnight
    } else if (h !== 12) {
      h += 12; // 12:xx PM stays at 12
    }
  } else if (h > 23) {
    return null;
  }

  if (min > 59 || s > 59) return null;

  return h * 3600 + min * 60 + s;
}

/** Formats seconds (may exceed 86400 for multi-day events) back to "HH:MM:SS", wrapped to a 24h clock. */
export function secondsToClockTime(totalSeconds: number): string {
  const rolled = Math.round(((totalSeconds % 86400) + 86400) % 86400) % 86400;
  const h = Math.floor(rolled / 3600);
  const m = Math.floor((rolled % 3600) / 60);
  const s = rolled % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/**
 * How long a station stands open, from its two clock times.
 *
 * A window that closes at an earlier clock time than it opened has run past midnight —
 * a night stage, or a race whose tail finishes after twelve — so it is carried into the
 * next day rather than reported as negative.
 */
export function windowSeconds(openClock: string, closeClock: string): number | null {
  const open = parseClockTimeToSeconds(openClock);
  const close = parseClockTimeToSeconds(closeClock);
  if (open === null || close === null) return null;
  return close >= open ? close - open : close + 86400 - open;
}

/** A duration as "6h 20m", or "45m" under the hour. Rounded to the nearest minute. */
export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
