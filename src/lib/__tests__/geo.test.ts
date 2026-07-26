import { describe, expect, it } from 'vitest';
import { buildCourse, haversineKm, snapToCourse } from '../geo';

describe('haversineKm', () => {
  it('returns ~0 for identical points', () => {
    const p = { lat: 10.0, lon: 106.0 };
    expect(haversineKm(p, p)).toBeCloseTo(0, 6);
  });

  it('computes the known distance along a meridian (1 degree latitude ~= 111.2km)', () => {
    const a = { lat: 10.0, lon: 106.0 };
    const b = { lat: 11.0, lon: 106.0 };
    const km = haversineKm(a, b);
    expect(km).toBeGreaterThan(110);
    expect(km).toBeLessThan(112);
  });

  it('is symmetric', () => {
    const a = { lat: 10.1, lon: 106.2 };
    const b = { lat: 9.8, lon: 105.9 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 9);
  });
});

describe('buildCourse', () => {
  it('returns an empty array for no points', () => {
    expect(buildCourse([])).toEqual([]);
  });

  it('assigns cumulativeKm=0 to the first vertex and increases monotonically', () => {
    const points = [
      { lat: 10.0, lon: 106.0 },
      { lat: 10.03, lon: 106.0 },
      { lat: 10.09, lon: 106.0 },
    ];
    const course = buildCourse(points);
    expect(course).toHaveLength(3);
    expect(course[0].cumulativeKm).toBe(0);
    expect(course[1].cumulativeKm).toBeGreaterThan(course[0].cumulativeKm);
    expect(course[2].cumulativeKm).toBeGreaterThan(course[1].cumulativeKm);
  });

  it('sums segment lengths for a straight 10km-ish course', () => {
    const points = [
      { lat: 10.0, lon: 106.0 },
      { lat: 10.09, lon: 106.0 },
    ];
    const course = buildCourse(points);
    expect(course[course.length - 1].cumulativeKm).toBeCloseTo(10, 0);
  });
});

describe('snapToCourse', () => {
  const course = buildCourse([
    { lat: 10.0, lon: 106.0 },
    { lat: 10.09, lon: 106.0 },
  ]);

  it('returns null for a degenerate (< 2 vertex) course', () => {
    expect(snapToCourse({ lat: 10, lon: 106 }, [])).toBeNull();
    expect(snapToCourse({ lat: 10, lon: 106 }, course.slice(0, 1))).toBeNull();
  });

  it('snaps a point exactly on the line to the correct km-from-start, with ~0 offset', () => {
    const result = snapToCourse({ lat: 10.045, lon: 106.0 }, course);
    expect(result).not.toBeNull();
    expect(result!.offsetKm).toBeLessThan(0.001);
    expect(result!.kmFromStart).toBeCloseTo(course[course.length - 1].cumulativeKm / 2, 1);
  });

  it('reports a nonzero offset for a point off the line', () => {
    const result = snapToCourse({ lat: 10.045, lon: 106.01 }, course);
    expect(result).not.toBeNull();
    expect(result!.offsetKm).toBeGreaterThan(0.5);
  });

  it('clamps to the start vertex for a point before the course begins', () => {
    const result = snapToCourse({ lat: 9.9, lon: 106.0 }, course);
    expect(result).not.toBeNull();
    expect(result!.kmFromStart).toBeCloseTo(0, 6);
  });

  it('clamps to the end vertex for a point past the course end', () => {
    const result = snapToCourse({ lat: 10.2, lon: 106.0 }, course);
    expect(result).not.toBeNull();
    expect(result!.kmFromStart).toBeCloseTo(course[course.length - 1].cumulativeKm, 6);
  });
});
