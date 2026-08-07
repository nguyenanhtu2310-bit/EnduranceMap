import { describe, expect, it } from 'vitest';
import { routeForContest, seedRaceFromContest, ROUTE_TOLERANCE } from '../contestRace';
import type { ContestProfile } from '../results';

const routes = [
  { name: '100km', totalKm: 100.9 },
  { name: '21km', totalKm: 23.0 },
  { name: '10km', totalKm: 10.4 },
  { name: '5km', totalKm: 5.6 },
];

/** A contest with a field whose paces and start offsets are known. */
function contest(over: Partial<ContestProfile> = {}): ContestProfile {
  const samples = Array.from({ length: 100 }, (_, i) => ({
    // 5.0 to 9.95 min/km across the field.
    paceMinPerKm: 5 + i * 0.05,
    startOffsetSeconds: i * 6, // up to 594 s — just under ten minutes
    finishSeconds: 0,
  }));
  return {
    contest: '5K FAMILY',
    distanceKm: 5.58,
    distanceSource: 'pace',
    distanceNote: '',
    entrants: 400,
    finishers: 100,
    withStartTime: 100,
    samples,
    leaders: [],
    warnings: [],
    ...over,
  } as ContestProfile;
}

describe('choosing the route a contest ran', () => {
  it('takes the nearest length, not the first that fits', () => {
    // A 5.58 km contest sits inside tolerance of the 5 km and nowhere near the 10 km,
    // but a first-match rule that walked the list would still have to be told so.
    expect(routeForContest(5.58, routes)?.name).toBe('5km');
    expect(routeForContest(10.2, routes)?.name).toBe('10km');
    expect(routeForContest(22.4, routes)?.name).toBe('21km');
  });

  it('refuses rather than handing over the least-bad route', () => {
    // A 42 km contest on a card of 100/21/10/5 ran none of them. Pinning it to the 21 km
    // would report a field arriving at checkpoints it never passes.
    expect(routeForContest(42.2, routes)).toBeNull();
    expect(routeForContest(0, routes)).toBeNull();
    expect(routeForContest(5, [])).toBeNull();
  });

  it('measures the gap in proportion, not in kilometres', () => {
    // A kilometre out on a 100 km course is nothing; the same kilometre and a half out on
    // a 5.6 km one is a different route. Absolute distance cannot tell those apart.
    expect(routeForContest(101.9, routes)?.name).toBe('100km');
    expect(routeForContest(7.0, routes)).toBeNull();
  });

  it('accepts exactly at the tolerance and refuses past it', () => {
    const long = [{ name: 'course', totalKm: 100 }];
    const inside = 100 * (1 - ROUTE_TOLERANCE);
    expect(routeForContest(inside, long)?.name).toBe('course');
    expect(routeForContest(100 * (1 - ROUTE_TOLERANCE) - 1, long)).toBeNull();
  });
});

describe('building a race from a contest', () => {
  it('carries the field, the paces and the measured start spread', () => {
    const seed = seedRaceFromContest(contest(), routes)!;
    expect(seed.courseName).toBe('5K FAMILY');
    expect(seed.sourceCourseName).toBe('5km');
    // The route's own measured length, not the contest's derived one.
    expect(seed.measuredKm).toBe(5.6);
    expect(seed.runnerCountText).toBe('100');
    expect(seed.fastestMinPerKm).toBeCloseTo(5.0, 1);
    expect(seed.typicalMinPerKm).toBeCloseTo(7.5, 1);
    expect(seed.slowestMinPerKm).toBeCloseTo(9.9, 1);
    // Offsets run to 594 s; the p99 is a shade under ten minutes.
    expect(seed.startSpreadMinutes).toBe(10);
  });

  it('counts the finishers, not the entrants', () => {
    // The paces describe the people who finished. Using the larger number would put
    // runners on the course who left no trace of how fast they were.
    const seed = seedRaceFromContest(contest({ entrants: 400, finishers: 100 }), routes)!;
    expect(seed.runnerCountText).toBe('100');
  });

  it('takes the spread from the file rather than a default', () => {
    const waved = contest({
      samples: Array.from({ length: 100 }, (_, i) => ({
        paceMinPerKm: 6,
        // Three waves fifteen minutes apart — the shape a default of ten minutes cannot
        // express and always gets wrong.
        startOffsetSeconds: Math.floor(i / 34) * 900,
        finishSeconds: 0,
      })),
    });
    expect(seedRaceFromContest(waved, routes)!.startSpreadMinutes).toBe(30);
  });

  it('does not shadow a race that already has the name', () => {
    const seed = seedRaceFromContest(contest(), routes, ['5K FAMILY'])!;
    expect(seed.courseName).toBe('5K FAMILY (2)');
    expect(seedRaceFromContest(contest(), routes, ['5K FAMILY', '5K FAMILY (2)'])!.courseName).toBe(
      '5K FAMILY (3)'
    );
  });

  it('returns nothing where no route fits, so nothing is created', () => {
    expect(seedRaceFromContest(contest({ distanceKm: 42.2 }), routes)).toBeNull();
  });

  it('returns nothing where the contest has no runners to model', () => {
    expect(seedRaceFromContest(contest({ samples: [] }), routes)).toBeNull();
  });
});
