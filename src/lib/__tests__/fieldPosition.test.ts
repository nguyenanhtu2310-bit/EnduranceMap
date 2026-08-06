import { describe, expect, it } from 'vitest';
import { fieldSnapshot, fieldWindow, positionAt, runnerPaces, type FieldInput } from '../fieldPosition';
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
