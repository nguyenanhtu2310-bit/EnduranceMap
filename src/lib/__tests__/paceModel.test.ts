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
  it('computes an arrival clock time from start + corral offset + pace * distance', () => {
    const results = arrivalPercentilesFromPaceBand(
      band,
      { startTimeClock: '06:00:00', runnerCount: 500, startSpreadMinutes: 10 },
      10,
      [50]
    );
    // Typical pace 6 min/km over 10km = 60 min, plus the P50 runner crossing the start
    // line 5 min after the gun (halfway through a 10-minute corral release).
    expect(results[0].clockTime).toBe('07:05:00');
  });

  it('puts the fastest runners across the start line at the gun', () => {
    const results = arrivalPercentilesFromPaceBand(
      band,
      { startTimeClock: '06:00:00', runnerCount: 500, startSpreadMinutes: 10 },
      10,
      [0]
    );
    // P0: 3 min/km over 10km = 30 min, with no corral delay.
    expect(results[0].clockTime).toBe('06:30:00');
  });

  it('collapses to a pure pace calculation when the field starts together', () => {
    const results = arrivalPercentilesFromPaceBand(
      band,
      { startTimeClock: '06:00:00', runnerCount: 500, startSpreadMinutes: 0 },
      10,
      [50]
    );
    expect(results[0].clockTime).toBe('07:00:00');
  });

  it('throws on an invalid start time', () => {
    expect(() => arrivalPercentilesFromPaceBand(band, { startTimeClock: 'nope', runnerCount: 10 }, 10)).toThrow();
  });
});

describe('start spread and peak load', () => {
  it('spreads arrivals near the start instead of piling the field into one instant', () => {
    const start = { startTimeClock: '06:00:00', runnerCount: 1000, startSpreadMinutes: 10 };
    // 0.5 km in, the field is still bunched but must not all share one timestamp.
    const samples = samplePaceModelArrivals(band, start, 0.5, 200);
    const distinct = new Set(samples);
    expect(distinct.size).toBeGreaterThan(50);
  });

  it('produces a single arrival instant at km 0 when there is no start spread', () => {
    const start = { startTimeClock: '06:00:00', runnerCount: 1000, startSpreadMinutes: 0 };
    const samples = samplePaceModelArrivals(band, start, 0, 200);
    expect(new Set(samples).size).toBe(1);
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
