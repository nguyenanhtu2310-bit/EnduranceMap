import { describe, expect, it } from 'vitest';
import { buildCourse } from '../geo';
import { positionAtKm, timingStations, TIMING_FOLDER } from '../timingStations';
import type { TimingPoint } from '../timingPoints';

/** A straight north-south line, so a kilometre is easy to reason about. */
const line = (fromLat: number, toLat: number, lon = 103.84, steps = 400) =>
  buildCourse(
    Array.from({ length: steps + 1 }, (_, i) => ({
      lat: fromLat + ((toLat - fromLat) * i) / steps,
      lon,
    }))
  );

const point = (name: string, kmFromStart: number, mat = name, label = ''): TimingPoint => ({
  name,
  label: label || name,
  mat,
  backupMat: '',
  kmFromStart,
  sportCode: 100,
});

describe('positionAtKm', () => {
  const course = line(22.0, 22.9);

  it('gives the start and the finish at either end', () => {
    expect(positionAtKm(course, 0)!.lat).toBeCloseTo(22.0, 4);
    expect(positionAtKm(course, 1000)!.lat).toBeCloseTo(22.9, 4);
  });

  it('interpolates between vertices rather than snapping to one', () => {
    const total = course[course.length - 1].cumulativeKm;
    const middle = positionAtKm(course, total / 2)!;
    expect(middle.lat).toBeCloseTo(22.45, 3);
  });

  it('has nothing to say about an empty course', () => {
    expect(positionAtKm([], 5)).toBeNull();
  });
});

describe('timingStations', () => {
  const long = line(22.0, 22.9);
  const short = line(22.45, 22.9);
  const longKm = long[long.length - 1].cumulativeKm;
  const shortKm = short[short.length - 1].cumulativeKm;

  it('places a mat from its declared distance, with no map involved', () => {
    const out = timingStations(
      { long: [point('CP1', longKm / 2), point('Finish', longKm)] },
      new Map([['long', long]])
    );
    expect(out.placemarks.map((p) => p.name)).toEqual(['CP1', 'Finish']);
    expect(out.placemarks[0].coord.lat).toBeCloseTo(22.45, 2);
    expect(out.placemarks[0].folder).toBe(TIMING_FOLDER);
  });

  it('uses the timing system’s own label as the name', () => {
    const out = timingStations(
      { long: [point('CP_TEL', 10, 'CPTopas', 'CP Topas Ecolodge')] },
      new Map([['long', long]])
    );
    expect(out.placemarks[0].name).toBe('CP Topas Ecolodge');
  });

  it('makes one station of a mat a course reads twice, not two', () => {
    // An out-and-back is one tent visited twice; the crossing logic finds both passes
    // from one position, and two placemarks would make two crews out of one.
    const out = timingStations(
      { long: [point('WS_1', 20, 'WS Lech Mong'), point('WS_2', 80, 'WS Lech Mong')] },
      new Map([['long', long]])
    );
    expect(out.placemarks).toHaveLength(1);
  });

  it('agrees about a mat two courses both read, and says nothing', () => {
    // The same physical place — lat 22.855 — reached at 95% of the long course and at
    // 90% of the short one, which both start and finish at different points.
    const out = timingStations(
      {
        long: [point('CP7', longKm * 0.95), point('Finish', longKm)],
        short: [point('CP7', shortKm * 0.9), point('Finish', shortKm)],
      },
      new Map([
        ['long', long],
        ['short', short],
      ])
    );
    expect(out.placemarks.map((p) => p.name).sort()).toEqual(['CP7', 'Finish']);
    expect(out.warnings).toEqual([]);
  });

  it('reports two courses that place one mat somewhere different', () => {
    // Either a course moved or a declared distance is wrong, and a crew would otherwise
    // be sent to the average of the two — which is nowhere.
    const out = timingStations(
      {
        long: [point('CP7', longKm * 0.95), point('Finish', longKm)],
        short: [point('CP7', shortKm * 0.2), point('Finish', shortKm)],
      },
      new Map([
        ['long', long],
        ['short', short],
      ])
    );
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toContain('CP7');
    expect(out.warnings[0]).toMatch(/\d+ m apart/);
  });

  it('stretches declared distances onto the course’s own measurement', () => {
    // A timing system calling a 100 km course "101.6" puts its finish mat at 101.6; the
    // route measures 103.79 and the mat belongs at its end, not 2 km short of it.
    const declaredTotal = longKm * 0.98;
    const out = timingStations(
      { long: [point('Finish', declaredTotal)] },
      new Map([['long', long]])
    );
    expect(out.placemarks[0].coord.lat).toBeCloseTo(22.9, 3);
  });

  it('skips a course with no route loaded', () => {
    const out = timingStations({ missing: [point('CP1', 10)] }, new Map());
    expect(out.placemarks).toEqual([]);
  });
});
