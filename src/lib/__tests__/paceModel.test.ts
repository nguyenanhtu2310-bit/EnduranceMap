import { describe, expect, it } from 'vitest';
import {
  arrivalPercentilesFromPaceBand,
  modelPacePercentiles,
  samplePaceModelArrivals,
  type PaceBand,
} from '../paceModel';

const band: PaceBand = { fastestMinPerKm: 3, typicalMinPerKm: 6, slowestMinPerKm: 12 };

describe('modelPacePercentiles', () => {
  it('anchors P1/P50/P99 exactly to fastest/typical/slowest', () => {
    const results = modelPacePercentiles(band, [1, 50, 99]);
    expect(results[0].paceMinPerKm).toBeCloseTo(3, 6);
    expect(results[1].paceMinPerKm).toBeCloseTo(6, 6);
    expect(results[2].paceMinPerKm).toBeCloseTo(12, 6);
  });

  it('clamps below P1 and above P99 to the anchor values', () => {
    const results = modelPacePercentiles(band, [0, 100]);
    expect(results[0].paceMinPerKm).toBeCloseTo(3, 6);
    expect(results[1].paceMinPerKm).toBeCloseTo(12, 6);
  });

  it('produces a monotonically increasing pace as percentile increases (slower runners at higher percentiles)', () => {
    const results = modelPacePercentiles(band, [1, 10, 25, 50, 75, 90, 99]);
    for (let i = 1; i < results.length; i++) {
      expect(results[i].paceMinPerKm).toBeGreaterThanOrEqual(results[i - 1].paceMinPerKm);
    }
  });
});

describe('arrivalPercentilesFromPaceBand', () => {
  it('computes an arrival clock time from start + pace * distance', () => {
    const results = arrivalPercentilesFromPaceBand(band, { startTimeClock: '06:00:00', runnerCount: 500 }, 10, [50]);
    // typical pace 6 min/km over 10km = 60 minutes after the 06:00:00 start.
    expect(results[0].clockTime).toBe('07:00:00');
  });

  it('throws on an invalid start time', () => {
    expect(() => arrivalPercentilesFromPaceBand(band, { startTimeClock: 'nope', runnerCount: 10 }, 10)).toThrow();
  });
});

describe('samplePaceModelArrivals', () => {
  it('generates exactly runnerCount samples when it divides evenly by sampleSize', () => {
    const samples = samplePaceModelArrivals(band, { startTimeClock: '06:00:00', runnerCount: 1000 }, 10, 200);
    expect(samples).toHaveLength(1000);
  });

  it('returns no samples for a zero runner count', () => {
    expect(samplePaceModelArrivals(band, { startTimeClock: '06:00:00', runnerCount: 0 }, 10)).toEqual([]);
  });
});
