import { describe, expect, it } from 'vitest';
import { parsePlacemarkLabel } from '../labels';
import {
  buildCourses,
  groupCoincidentPlacemarks,
  matchCourseByDistance,
  snapPlacemarks,
  type SnappedPlacemark,
} from '../snap';
import type { RawCourse, RawPlacemark } from '../kml';

// Two courses share a road (both run north along lon=106.0) over different latitude
// ranges, the way a 10km and a longer distance often share a start/finish straight.
// A third course lives far away and should never match.
const courseA: RawCourse = {
  name: '10km',
  folder: 'RACE ROUTE',
  points: [
    { lat: 10.0, lon: 106.0 },
    { lat: 10.09, lon: 106.0 },
  ],
};
const courseB: RawCourse = {
  name: 'Half Marathon',
  folder: 'RACE ROUTE',
  points: [
    { lat: 9.95, lon: 106.0 },
    { lat: 10.06, lon: 106.0 },
  ],
};
const courseC: RawCourse = {
  name: 'Other Race',
  folder: 'RACE ROUTE',
  points: [
    { lat: 20.0, lon: 107.0 },
    { lat: 20.05, lon: 107.0 },
  ],
};

// An out-and-back: north along lon=106.0 to lat 10.09, then back south to the start.
const outAndBack: RawCourse = {
  name: 'Marathon',
  folder: 'RACE ROUTE',
  points: [
    { lat: 10.0, lon: 106.0 },
    { lat: 10.09, lon: 106.0 },
    { lat: 10.0, lon: 106.0 },
  ],
};

const courses = buildCourses([courseA, courseB, courseC]);

function placemark(name: string, lat: number, lon: number, folder = 'CUT-OFF TIME'): RawPlacemark {
  return { name, folder, coord: { lat, lon }, label: parsePlacemarkLabel(name) };
}

describe('matchCourseByDistance', () => {
  it('matches a labeled race distance to the course of that measured length', () => {
    expect(matchCourseByDistance(courses, 10)?.name).toBe('10km');
  });

  it('tolerates GPS-traced routes running slightly long', () => {
    // courseB measures ~12.2km, so a "/12" label should still find it.
    expect(matchCourseByDistance(courses, 12)?.name).toBe('Half Marathon');
  });

  it('returns undefined when no course is close enough', () => {
    expect(matchCourseByDistance(courses, 100)).toBeUndefined();
  });
});

describe('snapPlacemarks', () => {
  it('snaps a point on the shared road to both overlapping courses, at different km marks', () => {
    const [result] = snapPlacemarks([placemark('Shared Water Station KM3.3/10', 10.03, 106.0)], courses);

    const names = result.snaps.map((s) => s.courseName).sort();
    expect(names).toEqual(['10km', 'Half Marathon']);

    const onA = result.snaps.find((s) => s.courseName === '10km')!;
    const onB = result.snaps.find((s) => s.courseName === 'Half Marathon')!;
    expect(onA.kmFromStart).toBeCloseTo(3.34, 1);
    expect(onB.kmFromStart).toBeCloseTo(8.9, 1);
  });

  it('excludes courses that do not pass within the crossing threshold', () => {
    const [result] = snapPlacemarks([placemark('Solo Signage KM8.9/10', 10.08, 106.0)], courses);
    expect(result.snaps.map((s) => s.courseName)).toEqual(['10km']);
  });

  it('does not flag a mismatch when the labeled km is close to the computed position', () => {
    const [result] = snapPlacemarks([placemark('Solo Signage KM8.9/10', 10.08, 106.0)], courses);
    expect(result.labelMismatches).toEqual([]);
  });

  it('flags a mismatch when the labeled km diverges from the computed position', () => {
    const [result] = snapPlacemarks([placemark('Bad Label KM2/10', 10.08, 106.0)], courses);
    expect(result.labelMismatches).toHaveLength(1);
    expect(result.labelMismatches[0].labeledKm).toBe(2);
    expect(result.labelMismatches[0].courseName).toBe('10km');
    expect(result.labelMismatches[0].deltaKm).toBeGreaterThan(0.3);
  });

  it('validates a km label against the course its own distance suffix names, not the nearest line', () => {
    // At lat 10.03 the 10km course reads ~3.34km but the Half reads ~8.9km. A "/10"
    // label must be checked against the 10km course or it would falsely mismatch.
    const [result] = snapPlacemarks([placemark('CP KM3.3/10', 10.03, 106.0)], courses);
    expect(result.labelMismatches).toEqual([]);
  });

  it('returns no snaps for a placemark nowhere near any course', () => {
    const [result] = snapPlacemarks([placemark('Off Map', 0, 0)], courses);
    expect(result.snaps).toHaveLength(0);
    expect(result.labelMismatches).toEqual([]);
  });

  describe('out-and-back courses', () => {
    const obCourses = buildCourses([outAndBack]);

    it('reports both passes when a course crosses the same point twice', () => {
      const [result] = snapPlacemarks([placemark('Mid-course CP', 10.045, 106.0)], obCourses);

      expect(result.snaps).toHaveLength(2);
      expect(result.snaps.every((s) => s.passCount === 2)).toBe(true);

      const kms = result.snaps.map((s) => s.kmFromStart).sort((a, b) => a - b);
      expect(kms[0]).toBeCloseTo(5, 0); // outbound
      expect(kms[1]).toBeCloseTo(15, 0); // returning, on a ~20km total course
    });

    it('reports a single pass at the turnaround apex', () => {
      const [result] = snapPlacemarks([placemark('U-turn', 10.09, 106.0)], obCourses);
      expect(result.snaps).toHaveLength(1);
      expect(result.snaps[0].passCount).toBe(1);
    });

    it('satisfies a km label that matches the return-leg pass', () => {
      // ~15km is the return pass; the outbound pass is ~5km. Neither should mismatch.
      const [result] = snapPlacemarks([placemark('Return CP KM15/20', 10.045, 106.0)], obCourses);
      expect(result.labelMismatches).toEqual([]);
    });
  });
});

describe('a station that says what it is', () => {
  /** Same helper, with an identity asserted by whatever produced the placemark. */
  const identified = (name: string, lat: number, lon: number, stationId: string): RawPlacemark => ({
    ...placemark(name, lat, lon),
    stationId,
  });

  it('joins two points far apart when both claim one identity', () => {
    // Typed once per distance from a published table: the two kilometres land hundreds of
    // metres apart once each course has been measured, and no proximity rule can join
    // them without also joining stations that merely sit near each other.
    const members = snapPlacemarks(
      [identified('WS', 10.03, 106.0, 'ws'), identified('WS', 10.035, 106.0, 'ws')],
      courses
    );
    const groups = groupCoincidentPlacemarks(members);
    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(2);
  });

  it('keeps two points apart when they claim different identities, however close', () => {
    // A mat and a water station a few metres apart are two crews and two positions.
    const members = snapPlacemarks(
      [identified('CP7 mat', 10.03, 106.0, 'mat'), identified('WS Sử Pán', 10.0301, 106.0, 'ws')],
      courses
    );
    expect(groupCoincidentPlacemarks(members)).toHaveLength(2);
  });

  it('still lets an identified station merge with a plain pin beside it', () => {
    // Somebody with both a map and a distance table must not get two stations at one
    // tent — which is this whole mechanism's own failure, arriving from the other side.
    const members = snapPlacemarks(
      [placemark('Marathon CP', 10.03, 106.0), identified('Marathon CP', 10.0301, 106.0, 'typed')],
      courses
    );
    expect(groupCoincidentPlacemarks(members)).toHaveLength(1);
  });
});

describe('groupCoincidentPlacemarks', () => {
  it('merges placemarks within tolerance into one station', () => {
    const members = snapPlacemarks(
      [placemark('Marathon CP', 10.03, 106.0), placemark('Half CP', 10.0301, 106.0)],
      courses
    );

    const groups = groupCoincidentPlacemarks(members);
    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(2);
    expect(groups[0].snaps.map((s) => s.courseName).sort()).toEqual(['10km', 'Half Marathon']);
  });

  it('keeps distinct passes of the same course as separate entries', () => {
    const obCourses = buildCourses([outAndBack]);
    const members = snapPlacemarks([placemark('Two-pass CP', 10.045, 106.0)], obCourses);

    const groups = groupCoincidentPlacemarks(members);
    expect(groups).toHaveLength(1);
    expect(groups[0].snaps).toHaveLength(2);
    expect(groups[0].snaps.every((s) => s.courseName === 'Marathon')).toBe(true);
  });

  it('keeps distant placemarks as separate stations', () => {
    const members: SnappedPlacemark[] = [
      { ...placemark('Station 1', 10.03, 106.0), snaps: [], labelMismatches: [] },
      { ...placemark('Station 2', 10.08, 106.0), snaps: [], labelMismatches: [] },
    ];

    expect(groupCoincidentPlacemarks(members)).toHaveLength(2);
  });
});
