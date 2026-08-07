import { describe, expect, it } from 'vitest';
import { axisTicks, axisTickSeconds, MAX_TICK_SECONDS } from '../axisTicks';

const H = (hours: number) => hours * 3600;

describe('how often to write a time on an axis', () => {
  it('keeps the labels inside the budget it is given', () => {
    for (const hours of [1, 3, 8, 21, 28, 49, 72]) {
      const step = axisTickSeconds(H(hours), 12);
      expect(H(hours) / step).toBeLessThanOrEqual(12);
    }
  });

  it('takes the finest interval that still fits', () => {
    // Never coarser than it needs to be: a short race keeps its quarter hours.
    expect(axisTickSeconds(H(2), 12)).toBe(15 * 60);
    expect(axisTickSeconds(H(6), 12)).toBe(30 * 60);
    expect(axisTickSeconds(H(12), 12)).toBe(3600);
  });

  it('coarsens a trail race instead of writing forty-nine labels', () => {
    // The case this exists for: an hourly tick on a 49-hour course merges into a grey
    // band on paper.
    expect(axisTickSeconds(H(49), 12)).toBe(6 * 3600);
    expect(H(49) / axisTickSeconds(H(49), 12)).toBeLessThanOrEqual(12);
  });

  it('gives a narrow chart fewer labels than a wide one, from the same race', () => {
    const wide = axisTickSeconds(H(28), 14);
    const narrow = axisTickSeconds(H(28), 5);
    expect(narrow).toBeGreaterThan(wide);
  });

  it('stops at a day rather than inventing an interval nobody thinks in', () => {
    expect(axisTickSeconds(H(400), 4)).toBe(MAX_TICK_SECONDS);
  });

  it('refuses to divide by nothing', () => {
    expect(axisTickSeconds(0, 12)).toBe(15 * 60);
    expect(axisTickSeconds(H(5), 0)).toBe(15 * 60);
  });
});

describe('where the labels go', () => {
  it('aligns to the interval, not to the gun', () => {
    // A 05:37 start on a four-hourly axis must not read 05:37, 09:37, 13:37 — true, and
    // nothing a crew chief can navigate by.
    const start = H(5) + 37 * 60;
    const ticks = axisTicks(start, start + H(20), 6);
    expect(ticks[0].step).toBe(4 * 3600);
    for (const tick of ticks) expect(tick.seconds % (4 * 3600)).toBe(0);
    expect(ticks[0].seconds).toBe(H(8));
  });

  it('stays inside the range at both ends', () => {
    const ticks = axisTicks(H(5), H(29), 12);
    for (const tick of ticks) {
      expect(tick.seconds).toBeGreaterThanOrEqual(H(5));
      expect(tick.seconds).toBeLessThanOrEqual(H(29));
    }
  });

  it('spans a race that runs past midnight without restarting its count', () => {
    // Friday 08:00 to Sunday 09:00 — the real 100 miles. Ticks keep climbing past 24 h
    // rather than wrapping, so each one is a distinct moment.
    const ticks = axisTicks(H(8), H(57), 12);
    const seconds = ticks.map((t) => t.seconds);
    expect(seconds).toEqual([...seconds].sort((a, b) => a - b));
    expect(new Set(seconds).size).toBe(seconds.length);
    expect(Math.max(...seconds)).toBeGreaterThan(86400);
  });

  it('produces nothing rather than looping on an empty range', () => {
    expect(axisTicks(H(5), H(5), 12).length).toBeLessThanOrEqual(1);
  });
});
