import { describe, expect, it } from 'vitest';
import {
  RAW_THRESHOLD_M,
  elevationCharacter,
  elevationTotals,
  flatEquivalentKm,
  segmentClimbs,
  type ProfilePoint,
} from '../elevation';

/** A profile that reverses direction on almost every step — a sensor recording. */
function noisy(count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(1000 + i * 0.05 + (i % 2 === 0 ? 0.4 : -0.4));
  return out;
}

/** A profile that climbs and descends in long runs — already filtered. */
function smooth(count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(1000 + Math.sin((i / count) * Math.PI * 4) * 200);
  return out;
}

describe('elevationCharacter', () => {
  it('calls a jittery profile raw and asks for smoothing', () => {
    const result = elevationCharacter(noisy(1000));
    expect(result.character).toBe('raw');
    expect(result.flipRate).toBeGreaterThan(0.05);
    expect(result.thresholdMetres).toBe(RAW_THRESHOLD_M);
  });

  it('calls an already-filtered profile smoothed and leaves it alone', () => {
    // Applying a threshold to a file that arrives de-noised smooths it twice and
    // silently deletes real climbing, so the threshold must fall to zero here.
    const result = elevationCharacter(smooth(2000));
    expect(result.character).toBe('smoothed');
    expect(result.flipRate).toBeLessThan(0.05);
    expect(result.thresholdMetres).toBe(0);
  });

  it('declines to judge a profile with too few steps', () => {
    expect(elevationCharacter([1000, 1010, 1005]).character).toBe('unknown');
  });

  it('ignores flat steps when judging', () => {
    // A quantised sensor repeats its last reading often. Counting repeats as "no
    // reversal" would make every noisy file look smooth.
    const withRepeats: number[] = [];
    for (const value of noisy(1000)) {
      withRepeats.push(value, value, value);
    }
    expect(elevationCharacter(withRepeats).character).toBe('raw');
  });
});

describe('elevationTotals', () => {
  it('sums every rise and fall at a zero threshold', () => {
    const totals = elevationTotals([100, 150, 120, 200], 0);
    expect(totals.gainMetres).toBe(130);
    expect(totals.lossMetres).toBe(30);
    expect(totals.minMetres).toBe(100);
    expect(totals.maxMetres).toBe(200);
  });

  it('ignores movements below the threshold', () => {
    const totals = elevationTotals([100, 101, 102, 103], 5);
    expect(totals.gainMetres).toBe(0);
  });

  it('measures a long climb against the last counted point, not the previous one', () => {
    // Each step here is under the threshold, but together they are a 12 m climb. Comparing
    // neighbours would report nothing and lose every gradual ascent on a course.
    const totals = elevationTotals([100, 102, 104, 106, 108, 110, 112], 5);
    expect(totals.gainMetres).toBeGreaterThan(9);
  });

  it('reports the threshold it used, so a published figure can be compared', () => {
    expect(elevationTotals([100, 200], 3).thresholdMetres).toBe(3);
  });

  it('smoothing strips the noise out of a jittery profile', () => {
    // The point of the threshold: a sawtooth that reverses on every step reports 849 m of
    // climbing when every wobble is counted, and 90 m once they are not.
    const profile = noisy(2000);
    const raw = elevationTotals(profile, 0).gainMetres;
    const smoothed = elevationTotals(profile, 10).gainMetres;
    expect(smoothed).toBeLessThan(raw * 0.2);
  });

  it('is broadly but not strictly decreasing as the threshold rises', () => {
    // Each threshold leaves its own residual at the point the reference last reset, so
    // neighbouring thresholds can differ by about one threshold's worth in either
    // direction. The trend is what matters and is an order of magnitude larger.
    const profile = noisy(2000);
    const at = (t: number) => elevationTotals(profile, t).gainMetres;
    expect(at(10)).toBeLessThan(at(1));
    expect(Math.abs(at(3) - at(2))).toBeLessThan(5);
  });

  it('handles an empty profile', () => {
    expect(elevationTotals([], 3).gainMetres).toBe(0);
  });
});

function profile(pairs: [number, number][]): ProfilePoint[] {
  return pairs.map(([cumulativeKm, ele]) => ({ cumulativeKm, ele }));
}

describe('segmentClimbs', () => {
  it('finds a single sustained climb', () => {
    const climbs = segmentClimbs(profile([
      [0, 1000], [1, 1100], [2, 1200], [3, 1300], [4, 1400],
    ]));
    expect(climbs).toHaveLength(1);
    expect(climbs[0].changeMetres).toBe(400);
    expect(climbs[0].startKm).toBe(0);
    expect(climbs[0].endKm).toBe(4);
  });

  it('computes gradient as rise over run', () => {
    // 400 m over 4 km is 10%.
    const climbs = segmentClimbs(profile([[0, 1000], [2, 1200], [4, 1400]]));
    expect(climbs[0].gradientPercent).toBeCloseTo(10, 5);
  });

  it('separates a climb from the descent that follows', () => {
    const climbs = segmentClimbs(profile([
      [0, 1000], [2, 1400], [4, 1000],
    ]));
    expect(climbs).toHaveLength(2);
    expect(climbs[0].changeMetres).toBe(400);
    expect(climbs[1].changeMetres).toBe(-400);
  });

  it('does not split one climb around a small dip', () => {
    // A 10 m dip inside a 400 m ascent is a switchback, not the end of the climb.
    const climbs = segmentClimbs(profile([
      [0, 1000], [1, 1200], [1.5, 1190], [3, 1400],
    ]));
    expect(climbs).toHaveLength(1);
    expect(climbs[0].changeMetres).toBe(400);
  });

  it('splits where the ground genuinely reverses further than the prominence', () => {
    const climbs = segmentClimbs(
      profile([[0, 1000], [1, 1200], [2, 1100], [3, 1300]]),
      { prominenceMetres: 25, minChangeMetres: 50 }
    );
    expect(climbs).toHaveLength(3);
  });

  it('starts with a descent when the course drops first', () => {
    const climbs = segmentClimbs(profile([[0, 1400], [2, 1000], [4, 1400]]));
    expect(climbs[0].changeMetres).toBe(-400);
    expect(climbs[1].changeMetres).toBe(400);
  });

  it('drops changes below the reporting minimum', () => {
    const climbs = segmentClimbs(profile([[0, 1000], [1, 1050], [2, 1000]]), {
      minChangeMetres: 150,
    });
    expect(climbs).toHaveLength(0);
  });

  it('returns nothing for a profile too short to segment', () => {
    expect(segmentClimbs(profile([[0, 1000]]))).toEqual([]);
  });

  it('reports climbs in the order they are run', () => {
    const climbs = segmentClimbs(profile([
      [0, 1000], [2, 1400], [4, 1000], [6, 1600],
    ]));
    const starts = climbs.map((c) => c.startKm);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });
});

describe('flatEquivalentKm', () => {
  it('counts flat ground at its own length', () => {
    expect(flatEquivalentKm(profile([[0, 1000], [10, 1000]]))).toBeCloseTo(10, 6);
  });

  it('charges a kilometre for every hundred metres climbed', () => {
    expect(flatEquivalentKm(profile([[0, 1000], [1, 1100]]))).toBeCloseTo(2, 6);
  });

  it('does not credit the descent back', () => {
    // Running down does not give the time back that running up cost.
    const out = flatEquivalentKm(profile([[0, 1000], [1, 1100], [2, 1000]]));
    expect(out).toBeCloseTo(3, 6);
  });
});
