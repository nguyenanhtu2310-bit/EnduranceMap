import { describe, expect, it } from 'vitest';
import { formatDuration, maskClockInput, normalizeClockTime, parseClockTimeToSeconds, secondsToClockTime, windowSeconds } from '../time';

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
