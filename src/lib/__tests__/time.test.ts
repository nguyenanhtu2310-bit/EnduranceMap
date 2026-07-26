import { describe, expect, it } from 'vitest';
import { parseClockTimeToSeconds, secondsToClockTime } from '../time';

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
