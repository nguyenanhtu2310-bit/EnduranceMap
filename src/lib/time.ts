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

/**
 * Shapes a clock time as it is typed, so a 24-hour field behaves like one.
 *
 * A native time input renders in the browser's locale, which puts AM and PM in front of
 * operators who work in 24-hour time and cannot be turned off from HTML. Typing into a
 * plain text field instead means doing the separator by hand: digits only, and the colon
 * appears once there are enough of them.
 */
export function maskClockInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

/**
 * Settles a typed clock time into "HH:MM", or rejects it.
 *
 * Accepts what people actually type — "7:5", "0705", "7.05" — and refuses what cannot be
 * a time, so a half-finished entry is never stored as though it were one.
 */
export function normalizeClockTime(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;

  const digits = text.replace(/\D/g, '');
  let hours: number;
  let minutes: number;

  const separated = text.match(/^(\d{1,2})\D(\d{1,2})/);
  if (separated) {
    hours = Number(separated[1]);
    minutes = Number(separated[2]);
  } else if (digits.length === 3) {
    hours = Number(digits.slice(0, 1));
    minutes = Number(digits.slice(1));
  } else if (digits.length === 4) {
    hours = Number(digits.slice(0, 2));
    minutes = Number(digits.slice(2));
  } else {
    return null;
  }

  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** Weekday names, indexed the way `Date.getDay()` does. */
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * A time on the event's clock, carrying the day it falls on.
 *
 * An ultra does not fit in a day, and a clock time on its own stops meaning anything
 * once it does not: a station that opens at 06:31 and closes at 06:49 is either eighteen
 * minutes' work or twenty-four hours and eighteen minutes of it, and nothing on the page
 * says which. On a card where the 100 miles starts Friday and everything else starts
 * Saturday, the same ambiguity reaches the start times too.
 *
 * Given the event's first date the day is named — "Sat 06:31" — because a crew chief
 * reading a sheet at four in the morning should not be counting days off a race brief.
 * Without one it falls back to counting them, which is still better than hiding them.
 */
export function formatEventClock(totalSeconds: number, raceDate?: string): string {
  const rounded = Math.round(totalSeconds);
  const day = Math.floor(rounded / 86400);
  const clock = secondsToClockTime(rounded).slice(0, 5);

  if (raceDate) {
    // Parsed as local midnight rather than UTC, so a date never lands on the day before.
    const date = new Date(`${raceDate}T00:00:00`);
    if (!Number.isNaN(date.getTime())) {
      date.setDate(date.getDate() + day);
      return `${WEEKDAYS[date.getDay()]} ${clock}`;
    }
  }

  return day === 0 ? clock : `D+${day} ${clock}`;
}

/** The day a time falls on, counted from the event's first, or null for the first day. */
export function eventDayOffset(totalSeconds: number): number {
  return Math.floor(Math.round(totalSeconds) / 86400);
}

/**
 * Just the day part of an event clock — "Sat", or "D+1" with no date to name it by.
 *
 * For the line under a time, where the time itself is shown separately because it is
 * typed into. Every day is named, the first included: a sheet where only the later rows
 * carry a day does not read as "the rest are day one", it reads as though someone
 * forgot, and on a race that runs three days that is the wrong thing to leave a crew
 * chief guessing at four in the morning.
 */
export function eventDayLabel(totalSeconds: number, raceDate?: string): string {
  const formatted = formatEventClock(totalSeconds, raceDate);
  const space = formatted.lastIndexOf(' ');
  if (space >= 0) return formatted.slice(0, space);
  return `Day ${eventDayOffset(totalSeconds) + 1}`;
}

/**
 * Seconds from the event's first midnight, from a clock time and the day it is on.
 *
 * The day is stated rather than worked out. A 100 miles starting 08:00 Friday and closing
 * 09:00 Sunday cannot be told apart from one closing 09:00 Saturday by looking at "09:00",
 * and a tool that guessed would be wrong about half of them by a whole day.
 */
export function eventSecondsFrom(clock: string, dayOffset = 0): number | null {
  const seconds = parseClockTimeToSeconds(clock);
  if (seconds === null) return null;
  return seconds + Math.max(0, Math.round(dayOffset)) * 86400;
}

/**
 * An elapsed limit as a race states it — "49:00", not "Sun 09:00" and not "2d 1h".
 *
 * Hours run past twenty-four rather than rolling over, because that is the number on the
 * entry page: a 100 miles is a 49-hour race, and calling it "1:01:00" would be describing
 * the same fact in a unit nobody uses. Minutes stay two digits so a column of these
 * sorts and reads straight down.
 */
export function formatElapsedClock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  return `${hours}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Reads a time limit as a race director would write one.
 *
 * "28:30" and "28" both mean twenty-eight and a half hours and twenty-eight hours — an
 * organizer copying from a card types the first, one answering "how long have they got?"
 * types the second, and refusing either would be pedantry. Anything else is refused
 * rather than guessed at, because a limit misread is a cut-off in the wrong place.
 */
export function parseElapsedClock(text: string): number | null {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return null;

  const parts = trimmed.split(':');
  if (parts.length > 2) return null;

  const hours = Number(parts[0]);
  const minutes = parts.length === 2 ? Number(parts[1]) : 0;
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || minutes < 0 || minutes >= 60) return null;
  // Whole minutes only: a cut-off is never published to the second.
  if (!Number.isInteger(minutes)) return null;

  return Math.round(hours * 3600 + minutes * 60);
}
