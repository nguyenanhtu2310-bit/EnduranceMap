import { describe, expect, it } from 'vitest';
import { computeArrivalPercentiles, computePercentile } from '../percentiles';

describe('computePercentile', () => {
  it('throws on an empty array', () => {
    expect(() => computePercentile([], 50)).toThrow();
  });

  it('returns the single value for a one-element array', () => {
    expect(computePercentile([42], 90)).toBe(42);
  });

  it('computes the median of an odd-length sorted array', () => {
    expect(computePercentile([1, 2, 3, 4, 5], 50)).toBe(3);
  });

  it('interpolates between two values for a fractional rank', () => {
    // rank = 0.5 * (4-1) = 1.5 -> halfway between index 1 (20) and index 2 (30)
    expect(computePercentile([10, 20, 30, 40], 50)).toBe(25);
  });

  it('returns the min/max for P0/P100', () => {
    const values = [5, 8, 13, 21];
    expect(computePercentile(values, 0)).toBe(5);
    expect(computePercentile(values, 100)).toBe(21);
  });
});

describe('computeArrivalPercentiles', () => {
  it('returns an empty array for no arrivals', () => {
    expect(computeArrivalPercentiles([])).toEqual([]);
  });

  it('computes clock times for the default percentile set, sorted ascending by seconds', () => {
    const arrivals = Array.from({ length: 101 }, (_, i) => 6 * 3600 + i * 60); // 06:00 to 07:40, 1 min apart
    const results = computeArrivalPercentiles(arrivals);

    expect(results.map((r) => r.percentile)).toEqual([1, 5, 10, 25, 50, 75, 90, 95, 99]);
    for (let i = 1; i < results.length; i++) {
      expect(results[i].seconds).toBeGreaterThanOrEqual(results[i - 1].seconds);
    }

    const p50 = results.find((r) => r.percentile === 50)!;
    expect(p50.clockTime).toBe('06:50:00');
  });

  it('ignores non-finite values', () => {
    const results = computeArrivalPercentiles([100, NaN, 200, Infinity], [50]);
    expect(results[0].seconds).toBe(150);
  });
});
