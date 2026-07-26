import { describe, expect, it } from 'vitest';
import { parsePlacemarkLabel } from '../labels';
import { buildCourses, groupCoincidentPlacemarks, snapPlacemarks, type SnappedPlacemark } from '../snap';
import type { RawCourse, RawPlacemark } from '../kml';

// Two courses share a physical road (both run north along lon=106.0) but cover
// different latitude ranges, the way a 10km and a longer distance often share a
// start/finish straight. A third course lives far away and should never match.
const courseA: RawCourse = {
  name: '10km',
  points: [
    { lat: 10.0, lon: 106.0 },
    { lat: 10.09, lon: 106.0 },
  ],
};
const courseB: RawCourse = {
  name: 'Half Marathon',
  points: [
    { lat: 9.95, lon: 106.0 },
    { lat: 10.06, lon: 106.0 },
  ],
};
const courseC: RawCourse = {
  name: 'Other Race',
  points: [
    { lat: 20.0, lon: 107.0 },
    { lat: 20.05, lon: 107.0 },
  ],
};

const courses = buildCourses([courseA, courseB, courseC]);

function placemark(name: string, lat: number, lon: number, folder = 'CUT-OFF TIME'): RawPlacemark {
  return { name, folder, coord: { lat, lon }, label: parsePlacemarkLabel(name) };
}

describe('snapPlacemarks', () => {
  it('snaps a point on the shared road to both overlapping courses, at different km marks', () => {
    const [result] = snapPlacemarks([placemark('Shared Water Station KM3.3/10', 10.03, 106.0)], courses);

    expect(result.snaps.map((s) => s.courseName).sort()).toEqual(['10km', 'Half Marathon'].sort());

    const onA = result.snaps.find((s) => s.courseName === '10km')!;
    const onB = result.snaps.find((s) => s.courseName === 'Half Marathon')!;
    expect(onA.kmFromStart).toBeCloseTo(3.34, 1);
    expect(onB.kmFromStart).toBeCloseTo(8.9, 1);
    expect(onA.kmFromStart).not.toBeCloseTo(onB.kmFromStart, 0);
  });

  it('only keeps the closest course when the point is far from every other course', () => {
    const [result] = snapPlacemarks([placemark('Solo Signage KM8.9/10', 10.08, 106.0)], courses);
    expect(result.snaps.map((s) => s.courseName)).toEqual(['10km']);
  });

  it('does not flag a mismatch when the labeled km is close to the computed position', () => {
    const [result] = snapPlacemarks([placemark('Solo Signage KM8.9/10', 10.08, 106.0)], courses);
    expect(result.labelMismatch).toBeUndefined();
  });

  it('flags a mismatch when the labeled km diverges from the computed position', () => {
    const [result] = snapPlacemarks([placemark('Bad Label KM2/10', 10.08, 106.0)], courses);
    expect(result.labelMismatch).toBeDefined();
    expect(result.labelMismatch!.labeledKm).toBe(2);
    expect(result.labelMismatch!.deltaKm).toBeGreaterThan(0.3);
  });

  it('returns no snaps for a placemark nowhere near any course', () => {
    const [result] = snapPlacemarks([placemark('Off Map', 0, 0)], courses);
    expect(result.snaps).toHaveLength(0);
    expect(result.labelMismatch).toBeUndefined();
  });
});

describe('groupCoincidentPlacemarks', () => {
  it('merges placemarks within tolerance into one station, deduping snaps per course', () => {
    const members: SnappedPlacemark[] = [
      { ...placemark('Marathon CP', 10.03, 106.0), snaps: [{ courseName: '10km', kmFromStart: 3.34, offsetKm: 0 }] },
      {
        ...placemark('Half CP', 10.0301, 106.0), // ~11m away
        snaps: [{ courseName: 'Half Marathon', kmFromStart: 8.9, offsetKm: 0 }],
      },
    ];

    const groups = groupCoincidentPlacemarks(members);
    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(2);
    expect(groups[0].snaps.map((s) => s.courseName).sort()).toEqual(['10km', 'Half Marathon'].sort());
  });

  it('keeps distant placemarks as separate stations', () => {
    const members: SnappedPlacemark[] = [
      { ...placemark('Station 1', 10.03, 106.0), snaps: [] },
      { ...placemark('Station 2', 10.08, 106.0), snaps: [] }, // ~5.5km away
    ];

    const groups = groupCoincidentPlacemarks(members);
    expect(groups).toHaveLength(2);
  });
});
