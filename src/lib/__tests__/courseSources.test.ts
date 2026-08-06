import { describe, expect, it } from 'vitest';
import { mergeCourseSources } from '../courseSources';
import type { Course } from '../snap';

const course = (name: string, totalKm: number): Course => ({
  name,
  totalKm,
  vertices: [
    { lat: 22.3, lon: 103.8, cumulativeKm: 0 },
    { lat: 22.4, lon: 103.9, cumulativeKm: totalKm },
  ],
});

describe('mergeCourseSources', () => {
  it('keeps the KML courses when there is no GPX at all', () => {
    const merged = mergeCourseSources([course('100km', 100), course('21km', 21)], []);
    expect(merged.courses.map((c) => c.name)).toEqual(['100km', '21km']);
    expect(merged.sources.every((s) => s.origin === 'kml')).toBe(true);
  });

  it('keeps the GPX courses when the map holds none', () => {
    // The case that matters: a KML of station layers only, with the routes coming from
    // the per-distance GPX every timing provider hands out.
    const merged = mergeCourseSources([], [course('VMM2025_100K', 103.79)]);
    expect(merged.courses.map((c) => c.name)).toEqual(['VMM2025_100K']);
    expect(merged.sources[0].origin).toBe('gpx');
  });

  it('prefers the GPX where both describe the same distance', () => {
    // A GPX carries elevation on every point; a KML of the same route usually does not,
    // and a schedule built on a profile-less course cannot warn anybody about a climb.
    const merged = mergeCourseSources([course('100km', 100.71)], [course('VMM2025_100K', 103.79)]);
    expect(merged.courses).toHaveLength(1);
    expect(merged.courses[0].name).toBe('VMM2025_100K');
    expect(merged.replaced).toHaveLength(1);
    expect(merged.replaced[0].kml.name).toBe('100km');
    expect(merged.replaced[0].gpx.name).toBe('VMM2025_100K');
  });

  it('reports what it stood in for, so the screen can say so in any language', () => {
    const merged = mergeCourseSources([course('100km', 100.71)], [course('VMM2025_100K', 103.79)]);
    expect(merged.replaced[0].kml.totalKm).toBe(100.71);
    expect(merged.replaced[0].gpx.totalKm).toBe(103.79);
  });

  it('keeps a KML course no GPX covers', () => {
    const merged = mergeCourseSources(
      [course('100km', 100.71), course('10km', 10.02)],
      [course('VMM2025_100K', 103.79)]
    );
    expect(merged.courses.map((c) => c.name)).toEqual(['VMM2025_100K', '10km']);
  });

  it('does not merge two genuinely different distances', () => {
    // 70 km and 50 km are 30% apart. Nothing should collapse them.
    const merged = mergeCourseSources([course('50km', 48.72)], [course('70K', 71.89)]);
    expect(merged.courses).toHaveLength(2);
  });

  it('tolerates the few percent a drawn route and a surveyed one disagree by', () => {
    // Real pair: the same 100 km measured 100.71 km in the map and 103.79 km in the GPX.
    const merged = mergeCourseSources([course('100km', 100.71)], [course('100K', 103.79)]);
    expect(merged.courses).toHaveLength(1);
  });

  it('lists the longest course first', () => {
    const merged = mergeCourseSources(
      [course('10km', 10)],
      [course('100K', 103.79), course('21K', 22.14), course('70K', 71.89)]
    );
    expect(merged.courses.map((c) => c.totalKm)).toEqual([103.79, 71.89, 22.14, 10]);
  });

  it('returns nothing when neither source holds a course', () => {
    const merged = mergeCourseSources([], []);
    expect(merged.courses).toEqual([]);
    expect(merged.replaced).toEqual([]);
  });

  it('never matches a zero-length course', () => {
    const merged = mergeCourseSources([course('empty', 0)], [course('also empty', 0)]);
    expect(merged.courses).toHaveLength(2);
  });
});
