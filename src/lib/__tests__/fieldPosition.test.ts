import { describe, expect, it } from 'vitest';
import { fieldSnapshot, fieldWindow, positionAt, runnerPaces, runnerStateAt, type FieldInput } from '../fieldPosition';
import type { SpineMapping } from '../spine';

const band: FieldInput = {
  courseName: '42K',
  courseKm: 42,
  startTimeClock: '05:00',
  startSpreadMinutes: 0,
  runnerCount: 100,
  fastestMinPerKm: 4,
  typicalMinPerKm: 6,
  slowestMinPerKm: 9,
};

/** A course that lies on the spine one for one. */
const identity = (courseName: string, km: number): SpineMapping => ({
  courseName,
  coverage: 1,
  samples: Array.from({ length: 101 }, (_, i) => ({
    courseKm: (km * i) / 100,
    spineKm: (km * i) / 100,
  })),
});

describe('runnerPaces', () => {
  it('gives one runner per entrant', () => {
    expect(runnerPaces(band)).toHaveLength(100);
  });

  it('replays a real field when one has been loaded, rather than modelling it', () => {
    const samples = [
      { startOffsetSeconds: 0, finishSeconds: 3600, paceMinPerKm: 5 },
      { startOffsetSeconds: 60, finishSeconds: 7200, paceMinPerKm: 8 },
    ];
    const paces = runnerPaces({ ...band, runnerCount: 4, samples });
    expect(paces.map((p) => p.paceMinPerKm)).toEqual([5, 5, 8, 8]);
  });

  it('seeds the corral by expected finish, so the quick leave first', () => {
    const paces = runnerPaces({ ...band, startSpreadMinutes: 20, runnerCount: 50 });
    const first = paces[0];
    const last = paces[paces.length - 1];
    expect(first.startOffsetSeconds).toBeLessThan(last.startOffsetSeconds);
    expect(first.paceMinPerKm).toBeLessThan(last.paceMinPerKm);
  });

  it('gives nothing for an empty field', () => {
    expect(runnerPaces({ ...band, runnerCount: 0 })).toEqual([]);
  });
});

describe('positionAt', () => {
  const runner = { startOffsetSeconds: 0, paceMinPerKm: 6 };

  it('places a runner by how long they have been going', () => {
    // An hour at 6 min/km is 10 km.
    expect(positionAt(3600, 0, runner, 42)).toBeCloseTo(10, 6);
  });

  it('leaves a runner off the course before their own gun', () => {
    expect(positionAt(100, 0, { startOffsetSeconds: 600, paceMinPerKm: 6 }, 42)).toBeNull();
  });

  it('takes a runner off the course once they have finished', () => {
    expect(positionAt(42 * 6 * 60 + 1, 0, runner, 42)).toBeNull();
    expect(positionAt(42 * 6 * 60 - 1, 0, runner, 42)).not.toBeNull();
  });

  it('refuses a pace that cannot move anybody', () => {
    expect(positionAt(3600, 0, { startOffsetSeconds: 0, paceMinPerKm: 0 }, 42)).toBeNull();
  });
});

describe('fieldSnapshot', () => {
  const paces = new Map([['42K', runnerPaces(band)]]);
  const mappings = new Map([['42K', identity('42K', 42)]]);

  it('puts nobody on course before the gun', () => {
    const snap = fieldSnapshot(4 * 3600, [band], mappings, paces, { spineKm: 42, binKm: 1 });
    expect(snap.totalOnCourse).toBe(0);
  });

  it('puts the whole field on course shortly after it', () => {
    const snap = fieldSnapshot(5 * 3600 + 600, [band], mappings, paces, { spineKm: 42, binKm: 1 });
    expect(snap.totalOnCourse).toBe(100);
  });

  it('moves the field down the course as the clock runs', () => {
    const early = fieldSnapshot(5 * 3600 + 1800, [band], mappings, paces, { spineKm: 42, binKm: 1 });
    const later = fieldSnapshot(7 * 3600, [band], mappings, paces, { spineKm: 42, binKm: 1 });
    const centre = (bins: number[]) =>
      bins.reduce((sum, n, i) => sum + n * i, 0) / Math.max(1, bins.reduce((a, b) => a + b, 0));
    expect(centre(later.binsByCourse[0])).toBeGreaterThan(centre(early.binsByCourse[0]));
  });

  it('empties once the last runner is home', () => {
    const snap = fieldSnapshot(5 * 3600 + 42 * 9 * 60 + 60, [band], mappings, paces, {
      spineKm: 42,
      binKm: 1,
    });
    expect(snap.totalOnCourse).toBe(0);
  });

  it('counts runners on ground the spine never reaches, rather than dropping them', () => {
    // The real case: a third of a 10 km on its own roads.
    const offSpine: SpineMapping = {
      courseName: '42K',
      coverage: 0,
      samples: [
        { courseKm: 0, spineKm: null },
        { courseKm: 42, spineKm: null },
      ],
    };
    const snap = fieldSnapshot(6 * 3600, [band], new Map([['42K', offSpine]]), paces, {
      spineKm: 42,
      binKm: 1,
    });
    expect(snap.offSpineByCourse[0]).toBeGreaterThan(0);
    expect(snap.offSpineByCourse[0]).toBe(snap.onCourseByCourse[0]);
    expect(snap.binsByCourse[0].every((n) => n === 0)).toBe(true);
  });

  it('keeps each distance in its own row', () => {
    const half: FieldInput = { ...band, courseName: '21K', courseKm: 21, runnerCount: 40 };
    const snap = fieldSnapshot(
      6 * 3600,
      [band, half],
      new Map([...mappings, ['21K', identity('21K', 21)]]),
      new Map([...paces, ['21K', runnerPaces(half)]]),
      { spineKm: 42, binKm: 1 }
    );
    expect(snap.binsByCourse).toHaveLength(2);
    expect(snap.onCourseByCourse[0] + snap.onCourseByCourse[1]).toBe(snap.totalOnCourse);
  });
});

describe('fieldWindow', () => {
  it('runs from the first gun to the last runner home', () => {
    const paces = new Map([['42K', runnerPaces(band)]]);
    const window = fieldWindow([band], paces);
    expect(window.startSeconds).toBe(5 * 3600);
    expect(window.endSeconds).toBeCloseTo(5 * 3600 + 42 * 9 * 60, -1);
  });

  it('takes the earliest gun when distances start on different days', () => {
    const friday: FieldInput = { ...band, courseName: '100M', courseKm: 160, startTimeClock: '08:00' };
    const saturday: FieldInput = { ...band, startDayOffset: 1 };
    const paces = new Map([
      ['100M', runnerPaces(friday)],
      ['42K', runnerPaces(saturday)],
    ]);
    expect(fieldWindow([friday, saturday], paces).startSeconds).toBe(8 * 3600);
  });
});

describe('how many are home', () => {
  const paces = new Map([[band.courseName, runnerPaces(band)]]);
  const mappings = new Map([[band.courseName, identity('42K', 42)]]);
  const at = (seconds: number) =>
    fieldSnapshot(seconds, [band], mappings, paces, { spineKm: 42, binKm: 1 });

  it('tells a runner still in the pen from one already showered', () => {
    // Both have no kilometre on the course, and they are not the same problem: one needs
    // a start line and the other needs a bag drop.
    const runner = { startOffsetSeconds: 0, paceMinPerKm: 6 };
    expect(runnerStateAt(0, 3600, runner, 42).state).toBe('waiting');
    expect(runnerStateAt(3600 + 60 * 60, 3600, runner, 42).state).toBe('racing');
    expect(runnerStateAt(3600 + 42 * 6 * 60 + 1, 3600, runner, 42).state).toBe('finished');
  });

  it('has nobody home before the gun', () => {
    const before = at(4 * 3600);
    expect(before.finished).toBe(0);
    expect(before.totalOnCourse).toBe(0);
  });

  it('has the whole field home once the slowest is in', () => {
    // The slowest runs 9 min/km over 42 km — nine hours from a five o'clock gun.
    const after = at(5 * 3600 + 42 * 9 * 60 + 60);
    expect(after.finished).toBe(100);
    expect(after.totalOnCourse).toBe(0);
  });

  it('never reports more finishers than the field holds', () => {
    for (let hour = 3; hour <= 16; hour++) {
      const snap = at(hour * 3600);
      expect(snap.finished).toBeLessThanOrEqual(snap.fieldSize);
      expect(snap.finished + snap.totalOnCourse).toBeLessThanOrEqual(snap.fieldSize);
      expect(snap.fieldSize).toBe(100);
    }
  });

  it('counts everyone on the spine or off it, never twice', () => {
    const mid = at(8 * 3600);
    const binned = mid.binsByCourse[0].reduce((sum, n) => sum + n, 0);
    expect(binned + mid.offSpineByCourse[0]).toBe(mid.totalOnCourse);
  });

  it('finishes people gradually rather than all at once', () => {
    const midRace = at(5 * 3600 + 6 * 3600);
    expect(midRace.finished).toBeGreaterThan(0);
    expect(midRace.totalOnCourse).toBeGreaterThan(0);
  });
});

describe('several races at once', () => {
  // The reason the count is kept per distance: a short race can be packed up while a long
  // one has not reached its first checkpoint, and one aggregate describes neither.
  const short: FieldInput = { ...band, courseName: '10K', courseKm: 10, runnerCount: 40 };
  const long: FieldInput = { ...band, courseName: '100K', courseKm: 100, runnerCount: 60 };
  const paces = new Map([
    [short.courseName, runnerPaces(short)],
    [long.courseName, runnerPaces(long)],
  ]);
  const mappings = new Map([
    [short.courseName, identity('10K', 10)],
    [long.courseName, identity('100K', 100)],
  ]);
  const at = (seconds: number) =>
    fieldSnapshot(seconds, [short, long], mappings, paces, { spineKm: 100, binKm: 1 });

  it('keeps a finisher count per distance, in the order given', () => {
    const snap = at(5 * 3600 + 2 * 3600);
    expect(snap.finishedByCourse).toHaveLength(2);
    expect(snap.fieldSizeByCourse).toEqual([40, 60]);
  });

  it('has the short race done while the long one is barely started', () => {
    // Two hours in: the 10 km is home at every pace in the band, the 100 km at none.
    const snap = at(5 * 3600 + 2 * 3600);
    expect(snap.finishedByCourse[0]).toBe(40);
    expect(snap.finishedByCourse[1]).toBe(0);

    // The aggregate this replaced would have called that "40% finished", which is true of
    // neither race — one is over and the other has ninety kilometres to run.
    expect(snap.finished / snap.fieldSize).toBeCloseTo(0.4, 2);
  });

  it('totals the per-course counts exactly', () => {
    for (let hour = 4; hour <= 20; hour++) {
      const snap = at(hour * 3600);
      expect(snap.finishedByCourse.reduce((a, b) => a + b, 0)).toBe(snap.finished);
      expect(snap.fieldSizeByCourse.reduce((a, b) => a + b, 0)).toBe(snap.fieldSize);
    }
  });
});
