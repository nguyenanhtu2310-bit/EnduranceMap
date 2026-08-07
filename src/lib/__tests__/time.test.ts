import { describe, expect, it } from 'vitest';
import { eventDayLabel, eventDayOffset, eventSecondsFrom, formatDuration, formatElapsedClock, formatEventClock, maskClockInput, normalizeClockTime, parseClockTimeToSeconds, parseElapsedClock, secondsToClockTime, windowSeconds } from '../time';

describe('parseClockTimeToSeconds', () => {
  it('parses 24-hour HH:MM and HH:MM:SS', () => {
    expect(parseClockTimeToSeconds('03:00')).toBe(3 * 3600);
    expect(parseClockTimeToSeconds('09:30:15')).toBe(9 * 3600 + 30 * 60 + 15);
  });

  it('parses AM times as written in real cut-off labels', () => {
    expect(parseClockTimeToSeconds('4:10 AM')).toBe(4 * 3600 + 10 * 60);
    expect(parseClockTimeToSeconds('9:10 AM')).toBe(9 * 3600 + 10 * 60);
  });

  it('parses PM times into the afternoon', () => {
    expect(parseClockTimeToSeconds('1:30 PM')).toBe(13 * 3600 + 30 * 60);
  });

  it('treats 12 AM as midnight and 12 PM as noon', () => {
    expect(parseClockTimeToSeconds('12:00 AM')).toBe(0);
    expect(parseClockTimeToSeconds('12:00 PM')).toBe(12 * 3600);
  });

  it('accepts lowercase and dotted meridiems', () => {
    expect(parseClockTimeToSeconds('4:10 am')).toBe(4 * 3600 + 10 * 60);
    expect(parseClockTimeToSeconds('4:10 a.m.')).toBe(4 * 3600 + 10 * 60);
  });

  it('rejects out-of-range and unparseable values', () => {
    expect(parseClockTimeToSeconds('25:00')).toBeNull();
    expect(parseClockTimeToSeconds('10:75')).toBeNull();
    expect(parseClockTimeToSeconds('13:00 PM')).toBeNull();
    expect(parseClockTimeToSeconds('nope')).toBeNull();
    expect(parseClockTimeToSeconds('')).toBeNull();
  });
});

describe('secondsToClockTime', () => {
  it('formats seconds since midnight', () => {
    expect(secondsToClockTime(0)).toBe('00:00:00');
    expect(secondsToClockTime(9 * 3600 + 5 * 60 + 3)).toBe('09:05:03');
  });

  it('wraps past-midnight values back onto a 24h clock', () => {
    expect(secondsToClockTime(25 * 3600)).toBe('01:00:00');
  });

  it('handles negative values (an open time before midnight)', () => {
    expect(secondsToClockTime(-3600)).toBe('23:00:00');
  });

  it('round-trips with the parser', () => {
    const seconds = parseClockTimeToSeconds('4:10 AM')!;
    expect(secondsToClockTime(seconds)).toBe('04:10:00');
  });
});

describe('windowSeconds', () => {
  it('measures a window inside one day', () => {
    expect(windowSeconds('05:30:00', '11:05:00')).toBe(5 * 3600 + 35 * 60);
  });

  it('carries a window that closes after midnight into the next day', () => {
    // A night stage opening at 22:00 and closing at 02:30 stands open four and a half
    // hours, not minus nineteen and a half.
    expect(windowSeconds('22:00:00', '02:30:00')).toBe(4 * 3600 + 30 * 60);
  });

  it('returns null when either time is unreadable', () => {
    expect(windowSeconds('dawn', '11:00:00')).toBeNull();
    expect(windowSeconds('05:00:00', '')).toBeNull();
  });
});

describe('formatDuration', () => {
  it.each([
    [45 * 60, '45m'],
    [3600, '1h'],
    [6 * 3600 + 20 * 60, '6h 20m'],
    [0, '0m'],
  ])('formats %i seconds as %s', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });

  it('rounds to the nearest minute', () => {
    expect(formatDuration(3600 + 29)).toBe('1h');
    expect(formatDuration(3600 + 31)).toBe('1h 1m');
  });
});

describe('maskClockInput', () => {
  it.each([
    ['0', '0'],
    ['07', '07'],
    ['073', '07:3'],
    ['0730', '07:30'],
    ['07:30', '07:30'],
    ['073055', '07:30'],
    ['abc', ''],
  ])('shapes %s as %s', (raw, expected) => {
    expect(maskClockInput(raw)).toBe(expected);
  });
});

describe('normalizeClockTime', () => {
  it.each([
    ['7:5', '07:05'],
    ['0705', '07:05'],
    ['07:05', '07:05'],
    ['7.05', '07:05'],
    ['23:59', '23:59'],
    ['000', '00:00'],
  ])('settles %s as %s', (raw, expected) => {
    expect(normalizeClockTime(raw)).toBe(expected);
  });

  it.each(['', '  ', '7', '24:00', '12:60', 'noon', '99:99'])('rejects %s', (raw) => {
    expect(normalizeClockTime(raw)).toBeNull();
  });

  it('never stores a half-typed entry as though it were a time', () => {
    // "07" alone is two digits — an hour with no minutes, not 07:00.
    expect(normalizeClockTime('07')).toBeNull();
  });
});

describe('formatEventClock', () => {
  it('names the weekday when the event has a date', () => {
    // 2026-09-25 is a Friday.
    expect(formatEventClock(8 * 3600, '2026-09-25')).toBe('Fri 08:00');
    expect(formatEventClock(2 * 86400 + 9 * 3600, '2026-09-25')).toBe('Sun 09:00');
  });

  it('counts days when there is no date to name them by', () => {
    expect(formatEventClock(6 * 3600 + 31 * 60)).toBe('06:31');
    expect(formatEventClock(86400 + 6 * 3600 + 49 * 60)).toBe('D+1 06:49');
  });

  it('tells a short shift from a day-long one', () => {
    // The case this exists for: 06:31 to 06:49 is either 18 minutes or 24h 18m.
    const open = 6 * 3600 + 31 * 60;
    const close = 86400 + 6 * 3600 + 49 * 60;
    expect(formatEventClock(open, '2026-09-25')).toBe('Fri 06:31');
    expect(formatEventClock(close, '2026-09-25')).toBe('Sat 06:49');
  });

  it('ignores a date it cannot read rather than printing nonsense', () => {
    expect(formatEventClock(86400 + 3600, 'not a date')).toBe('D+1 01:00');
  });

  it('rolls a time past midnight into the next day', () => {
    expect(formatEventClock(86400 - 1, '2026-09-25')).toBe('Fri 23:59');
    expect(formatEventClock(86400, '2026-09-25')).toBe('Sat 00:00');
  });
});

describe('eventSecondsFrom', () => {
  it('adds whole days to a clock time', () => {
    expect(eventSecondsFrom('08:00', 0)).toBe(8 * 3600);
    expect(eventSecondsFrom('05:00', 1)).toBe(86400 + 5 * 3600);
    expect(eventSecondsFrom('09:00', 2)).toBe(2 * 86400 + 9 * 3600);
  });

  it('defaults to the first day', () => {
    expect(eventSecondsFrom('03:00')).toBe(3 * 3600);
  });

  it('refuses a clock time it cannot read', () => {
    expect(eventSecondsFrom('nope', 1)).toBeNull();
  });

  it('never counts backwards', () => {
    expect(eventSecondsFrom('08:00', -3)).toBe(8 * 3600);
  });
});

describe('eventDayOffset', () => {
  it('counts the days an elapsed time spans', () => {
    expect(eventDayOffset(3600)).toBe(0);
    expect(eventDayOffset(86400)).toBe(1);
    expect(eventDayOffset(2 * 86400 + 9 * 3600)).toBe(2);
  });
});

describe('a time limit, as a race states one', () => {
  it('runs hours past twenty-four rather than rolling them over', () => {
    // A 100 miles is a 49-hour race. "1:01:00" describes the same fact in a unit that
    // appears on no entry page and no race card.
    expect(formatElapsedClock(49 * 3600)).toBe('49:00');
    expect(formatElapsedClock(28 * 3600 + 30 * 60)).toBe('28:30');
    expect(formatElapsedClock(6 * 3600 + 30 * 60)).toBe('6:30');
  });

  it('reads a limit typed either way an organizer types one', () => {
    expect(parseElapsedClock('28:30')).toBe(28 * 3600 + 30 * 60);
    expect(parseElapsedClock('28')).toBe(28 * 3600);
    expect(parseElapsedClock(' 49:00 ')).toBe(49 * 3600);
  });

  it('refuses what it cannot read rather than guessing', () => {
    // A limit misread is a cut-off in the wrong place, which is worse than an empty box.
    expect(parseElapsedClock('')).toBeNull();
    expect(parseElapsedClock('abc')).toBeNull();
    expect(parseElapsedClock('28:75')).toBeNull();
    expect(parseElapsedClock('1:02:03')).toBeNull();
    expect(parseElapsedClock('-5')).toBeNull();
  });

  it('round-trips every limit on the VMM card', () => {
    for (const hours of [49, 28, 21, 18.5, 13, 6.5]) {
      expect(parseElapsedClock(formatElapsedClock(hours * 3600))).toBe(hours * 3600);
    }
  });

  it('turns a start and a limit into the cut-off the card prints', () => {
    // The 100 miles: Friday 08:00 plus 49 hours is Sunday 09:00, not Saturday 09:00.
    const start = eventSecondsFrom('08:00', 0)!;
    const cutoff = start + parseElapsedClock('49:00')!;
    expect(formatEventClock(cutoff, '2026-09-18')).toBe('Sun 09:00');
    expect(eventDayOffset(cutoff)).toBe(2);
    expect(eventDayLabel(cutoff, '2026-09-18')).toBe('Sun');
  });
});
